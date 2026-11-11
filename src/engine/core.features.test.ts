// Subdivisions, swing, accent patterns, volume, sounds and the practice trainers
// (port of the Python app's tests/test_engine_features.py).
import { describe, expect, it } from 'vitest'
import { MetronomeCore, type Beat, type Settings } from './core'
import { SOUNDS, SOUND_NAMES } from './sound'

const SR = 1000

/** One-sample stand-in clicks, so onsets are easy to read. */
function make(settings: Partial<Settings> = {}) {
  const m = new MetronomeCore(SR, { bpm: 60, ...settings })
  m.buffers = { accent: Float32Array.of(1), normal: Float32Array.of(0.5), sub: Float32Array.of(0.25) }
  return m
}

/** Render `frames` samples in 128-frame blocks; return the signal and the beats. */
function run(m: MetronomeCore, frames: number, block = 128) {
  const signal = new Float32Array(frames)
  const beats: Beat[] = []
  for (let at = 0; at < frames; at += block) {
    const out = new Float32Array(Math.min(block, frames - at))
    beats.push(...m.render(out, at / SR))
    signal.set(out, at)
  }
  return { signal, beats }
}

const onsets = (a: Float32Array) => Object.fromEntries([...a.keys()].filter((i) => a[i] !== 0).map((i) => [i, a[i]]))

describe('subdivisions & swing', () => {
  it.each([
    [2, { 0: 1, 500: 0.25, 1000: 0.5, 1500: 0.25 }],
    [3, { 0: 1, 333: 0.25, 666: 0.25, 1000: 0.5, 1333: 0.25, 1666: 0.25 }],
    [4, { 0: 1, 250: 0.25, 500: 0.25, 750: 0.25, 1000: 0.5, 1250: 0.25, 1500: 0.25, 1750: 0.25 }],
  ])('places %i ticks per beat', (subdivision, expected) => {
    expect(onsets(run(make({ subdivision }), 2000).signal)).toEqual(expected)
  })

  it('does not report subdivision ticks as beats', () => {
    expect(run(make({ subdivision: 4 }), 2000).beats.map((b) => b.beatInBar)).toEqual([0, 1])
  })

  it('swing delays the offbeat eighth', () => {
    expect(onsets(run(make({ subdivision: 2, swing: 0.66 }), 2000).signal)).toEqual({
      0: 1,
      660: 0.25,
      1000: 0.5,
      1660: 0.25,
    })
  })

  it('clamps swing and ignores it for other subdivisions', () => {
    expect(onsets(run(make({ subdivision: 2, swing: 5 }), 1000).signal)).toHaveProperty('750')
    expect(Object.keys(onsets(run(make({ subdivision: 3, swing: 0.7 }), 1000).signal))).toEqual(['0', '333', '666'])
  })

  it('treats invalid subdivisions as quarter notes', () => {
    for (const subdivision of [0, 5, 2.5, Number.NaN]) {
      expect(Object.keys(onsets(run(make({ subdivision }), 2000).signal))).toEqual(['0', '1000'])
    }
  })

  it('keeps the beat grid when the subdivision changes mid-beat', () => {
    const m = make({ subdivision: 4 })
    const a = run(m, 1600).signal // mid-beat 2: ticks at 1000, 1250, 1500 played
    m.subdivision = 1
    const b = run(m, 2400).signal
    expect(Object.keys(onsets(b)).map((i) => Number(i) + 1600)).toEqual([2000, 3000]) // no stray subs
    expect(onsets(a)[1000]).toBe(0.5)
  })

  it('does not drift with subdivisions over a long run', () => {
    const sr = 44100
    const bpm = 97
    const m = new MetronomeCore(sr, { bpm, subdivision: 3 })
    const interval = (sr * 60) / bpm
    const out = new Float32Array(128)
    const times: number[] = []
    for (let i = 0; i < 12000; i++) times.push(...m.render(out, (i * 128) / sr).map((b) => b.time))
    times.forEach((t, k) => expect(Math.abs(t * sr - k * interval)).toBeLessThan(1 + 1e-6))
  })
})

describe('accent pattern', () => {
  it('accents beat 0 by default', () => {
    const { beats } = run(make({ bpm: 300, beatsPerBar: 3 }), 1000)
    expect(beats.map((b) => b.level)).toEqual(['accent', 'normal', 'normal', 'accent', 'normal'])
  })

  it('uses a custom pattern, padding missing beats with normal', () => {
    const { signal, beats } = run(make({ bpm: 300, accents: ['normal', 'accent'] }), 800)
    expect(beats.map((b) => b.level)).toEqual(['normal', 'accent', 'normal', 'normal'])
    expect(onsets(signal)).toEqual({ 0: 0.5, 200: 1, 400: 0.5, 600: 0.5 })
  })

  it('silences a muted beat with its subdivisions but still reports it', () => {
    const { signal, beats } = run(make({ beatsPerBar: 2, subdivision: 2, accents: ['accent', 'mute'] }), 2000)
    expect(onsets(signal)).toEqual({ 0: 1, 500: 0.25 })
    expect(beats.map((b) => [b.beatInBar, b.level])).toEqual([
      [0, 'accent'],
      [1, 'mute'],
    ])
  })
})

describe('volume & sounds', () => {
  it('scales the output by volume', () => {
    expect(onsets(run(make({ volume: 0.5 }), 10).signal)).toEqual({ 0: 0.5 })
    expect(onsets(run(make({ volume: 0 }), 10).signal)).toEqual({})
    expect(onsets(run(make({ volume: Number.NaN }), 10).signal)).toEqual({})
  })

  it('clips the output to [-1, 1]', () => {
    const m = make({ volume: 4 })
    expect(run(m, 10).signal[0]).toBe(1)
  })

  it.each(SOUND_NAMES)('%s has valid, audible, bounded buffers', (name) => {
    const bank = SOUNDS[name](44100)
    expect(Object.keys(bank).sort()).toEqual(['accent', 'normal', 'sub'])
    for (const buf of Object.values(bank)) {
      expect(buf).toBeInstanceOf(Float32Array)
      expect(buf.length).toBeGreaterThan(0)
      expect(buf.every(Number.isFinite)).toBe(true)
      const peak = Math.max(...buf.map(Math.abs))
      expect(peak).toBeLessThanOrEqual(1)
      expect(peak).toBeGreaterThan(0.01)
    }
  })

  it('the noise burst is deterministic', () => {
    expect(SOUNDS['Hi-hat'](44100).normal).toEqual(SOUNDS['Hi-hat'](44100).normal)
  })

  it('setting a sound replaces the buffers', () => {
    const m = new MetronomeCore(44100)
    const before = m.buffers
    m.apply({ sound: 'Hi-hat' })
    expect(m.buffers).not.toBe(before)
    const out = new Float32Array(2000)
    m.render(out)
    expect(out.some((x) => x !== 0)).toBe(true)
  })
})

describe('gap trainer', () => {
  it('mutes the off bars but still reports them', () => {
    const { signal, beats } = run(make({ bpm: 300, beatsPerBar: 2, gap: { play: 1, mute: 2 } }), 2400) // 6 bars
    expect(Object.keys(onsets(signal)).map(Number)).toEqual([0, 200, 1200, 1400])
    expect(beats.map((b) => b.audible)).toEqual([true, true, false, false, false, false, true, true, false, false, false, false])
  })

  it('plays everything when off', () => {
    expect(run(make({ bpm: 300, beatsPerBar: 2 }), 800).beats.every((b) => b.audible)).toBe(true)
  })
})

describe('speed trainer', () => {
  it('bumps every n bars up to the target', () => {
    const m = make({ beatsPerBar: 1, speed: { step: 20, every: 2, target: 120 } })
    const { beats } = run(m, 10000, 250)
    expect(beats.slice(0, 8).map((b) => b.bpm)).toEqual([60, 60, 80, 80, 100, 100, 120, 120])
    expect(beats.slice(0, 8).map((b) => b.bumped)).toEqual([false, false, true, false, true, false, true, false])
    expect(new Set(beats.slice(6).map((b) => b.bpm))).toEqual(new Set([120]))
    expect(m.bpm).toBe(120)
  })

  it('does not overshoot the target or lower the tempo', () => {
    const up = run(make({ bpm: 110, beatsPerBar: 1, speed: { step: 25, every: 1, target: 120 } }), 2000).beats
    expect(up.slice(0, 3).map((b) => b.bpm)).toEqual([110, 120, 120])
    const above = run(make({ bpm: 200, beatsPerBar: 1, speed: { step: 10, every: 1, target: 120 } }), 2000).beats
    expect(new Set(above.map((b) => b.bpm))).toEqual(new Set([200]))
    expect(above.some((b) => b.bumped)).toBe(false)
  })

  it('changes tempo on the downbeat', () => {
    const { beats } = run(make({ beatsPerBar: 2, speed: { step: 60, every: 1, target: 120 } }), 4000)
    // bar 0 at 60 BPM: 0, 1; bar 1 starts at 2 at 120 BPM: 2, 2.5; bar 2 at 3
    expect(beats.slice(0, 5).map((b) => b.time)).toEqual([0, 1, 2, 2.5, 3])
  })

  it('reset restarts the bar count', () => {
    const m = make({ beatsPerBar: 1, speed: { step: 10, every: 2, target: 200 } })
    run(m, 1500) // bars 0, 1
    m.reset()
    m.bpm = 60
    expect(run(m, 1500).beats.map((b) => b.bpm)).toEqual([60, 60]) // bar 0 again: no bump
  })
})

describe('apply()', () => {
  it('ignores fields of the wrong type', () => {
    const m = make({ beatsPerBar: 3 })
    const bad = {
      bpm: '90',
      subdivision: null,
      accents: ['loud'],
      sound: 'toString', // inherited key, not a sound
      gap: { play: 1 },
      speed: 'fast',
      volume: undefined,
    } as unknown as Partial<Settings>
    m.apply(bad)
    m.apply(null)
    m.apply(undefined)
    const { beats } = run(m, 3000)
    expect(beats.map((b) => [b.beatInBar, b.level, b.audible, b.bpm])).toEqual([
      [0, 'accent', true, 60],
      [1, 'normal', true, 60],
      [2, 'normal', true, 60],
    ])
  })

  it('null turns a trainer off', () => {
    const m = make({ bpm: 300, beatsPerBar: 1, gap: { play: 1, mute: 1 } })
    m.apply({ gap: null })
    expect(run(m, 1000).beats.every((b) => b.audible)).toBe(true)
  })

  it('copies the accents array, so later mutation of the message cannot reach the engine', () => {
    const accents: Settings['accents'][number][] = ['mute']
    const m = make()
    m.apply({ accents })
    accents[0] = 'accent'
    expect(m.levelOf(0)).toBe('mute')
  })
})
