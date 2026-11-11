// Edge cases for the engine features: mid-beat setting changes, trainer combinations, hostile apply() input.
import { describe, expect, it } from 'vitest'
import { MetronomeCore, type Beat, type Level, type Settings } from './core'

const SR = 1000

function make(settings: Partial<Settings> = {}) {
  const m = new MetronomeCore(SR, { bpm: 60, ...settings })
  m.buffers = { accent: Float32Array.of(1), normal: Float32Array.of(0.5), sub: Float32Array.of(0.25) }
  return m
}

function run(m: MetronomeCore, frames: number, block = 128, t0 = 0) {
  const signal = new Float32Array(frames)
  const beats: Beat[] = []
  for (let at = 0; at < frames; at += block) {
    const out = new Float32Array(Math.min(block, frames - at))
    beats.push(...m.render(out, t0 + at / SR))
    signal.set(out, at)
  }
  return { signal, beats }
}

const onsets = (a: Float32Array, offset = 0) =>
  Object.fromEntries([...a.keys()].filter((i) => a[i] !== 0).map((i) => [i + offset, a[i]]))

describe('mid-beat setting changes', () => {
  it('raising swing before the offbeat is played moves the offbeat', () => {
    const m = make({ subdivision: 2, swing: 0.5 })
    const a = run(m, 300).signal
    m.swing = 0.75
    const b = run(m, 1600).signal
    expect(onsets(a)).toEqual({ 0: 1 })
    expect(onsets(b, 300)).toEqual({ 750: 0.25, 1000: 0.5, 1750: 0.25 })
  })

  it('lowering swing after the old offbeat position passed does not crash or double-play', () => {
    const m = make({ subdivision: 2, swing: 0.75 })
    const a = run(m, 600).signal // offbeat (750) still pending
    m.swing = 0.5 // new position 500 is in the past
    const b = run(m, 1000).signal
    expect(onsets(a)).toEqual({ 0: 1 })
    const all = onsets(b, 600)
    expect(all[1000]).toBe(0.5)
    expect(Object.keys(all).length).toBeLessThanOrEqual(3)
    for (const v of Object.values(all)) expect(Number.isFinite(v)).toBe(true)
  })

  it('growing the subdivision mid-beat continues with the remaining ticks, no extra downbeat', () => {
    const m = make({ subdivision: 1 })
    const a = run(m, 1200)
    m.subdivision = 4
    const b = run(m, 1500)
    expect(a.beats.map((x) => x.beatInBar)).toEqual([0, 1])
    expect(b.beats.map((x) => x.beatInBar)).toEqual([2]) // render already queued beat 2 at 2000
    const o = onsets(b.signal, 1200)
    expect(o).toEqual({ 2000: 0.5, 2250: 0.25, 2500: 0.25 })
    expect(Object.keys(o).map(Number).filter((i) => i < 1200)).toEqual([])
  })

  it('shrinking the subdivision to 1 mid-beat never repeats the downbeat', () => {
    const m = make({ subdivision: 4 })
    run(m, 1100)
    m.subdivision = 1
    const { beats } = run(m, 2000, 128, 1.1)
    expect(beats.map((b) => b.beatInBar)).toEqual([2, 3, 0].slice(0, beats.length))
    expect(beats[0].time).toBeCloseTo(2, 2)
  })

  it('a bpm change applies from the next beat, not mid-beat', () => {
    const m = make({ bpm: 60 })
    run(m, 500)
    m.bpm = 120
    const { beats } = run(m, 2000, 128, 0.5)
    expect(beats[0].time).toBeCloseTo(1, 3) // current beat latched at 60
    expect(beats[1].time).toBeCloseTo(1.5, 3)
  })
})

describe('beats per bar with accents, gap and speed', () => {
  it('shrinking the bar mid-bar wraps to a downbeat and keeps levels by index', () => {
    const accents: Level[] = ['accent', 'normal', 'mute', 'accent']
    const m = make({ accents, beatsPerBar: 4 })
    const a = run(m, 3500).beats // beats 0..3 started
    m.beatsPerBar = 2
    const b = run(m, 3000, 128, 3.5).beats
    expect(a.map((x) => x.beatInBar)).toEqual([0, 1, 2, 3])
    expect(b.map((x) => x.beatInBar)).toEqual([0, 1, 0, 1, 0, 1].slice(0, b.length))
    expect(b.map((x) => x.level).slice(0, 2)).toEqual(['accent', 'normal'])
  })

  it('shrinking the bar advances the bar counter for the gap trainer', () => {
    const m = make({ gap: { play: 1, mute: 1 }, beatsPerBar: 4 })
    run(m, 2500) // beats 0,1,2 in bar 0
    m.beatsPerBar = 2
    const { beats } = run(m, 4000, 128, 2.5)
    // beat 3 of the old bar is replaced by a new bar 1 (muted), then bar 2 audible...
    expect(beats.map((b) => [b.beatInBar, b.audible])).toEqual([
      [0, false],
      [1, false],
      [0, true],
      [1, true],
    ])
  })

  it('growing the bar mid-bar extends it', () => {
    const m = make({ beatsPerBar: 2 })
    run(m, 1500) // beats 0,1
    m.beatsPerBar = 4
    const { beats } = run(m, 3000, 128, 1.5)
    expect(beats.map((b) => b.beatInBar)).toEqual([2, 3, 0, 1].slice(0, beats.length))
  })

  it('beatsPerBar 1 accents every beat', () => {
    const { beats } = run(make({ beatsPerBar: 1 }), 3000)
    expect(beats.map((b) => [b.beatInBar, b.level])).toEqual(Array(3).fill([0, 'accent']))
  })
})

describe('speed trainer edges', () => {
  const bpms = (beats: Beat[]) => beats.map((b) => b.bpm)

  it('bumps every N bars up to the target and then stops', () => {
    const m = make({ bpm: 60, beatsPerBar: 1, speed: { step: 10, every: 4, target: 90 } })
    const beats: Beat[] = []
    const out = new Float32Array(128)
    for (let i = 0; i < 4000 && beats.length < 24; i++) beats.push(...m.render(out, i * 0.128))
    expect(bpms(beats)).toEqual([...Array(4).fill(60), ...Array(4).fill(70), ...Array(4).fill(80), ...Array(12).fill(90)])
    expect(beats.map((b) => b.bumped).flatMap((x, i) => (x ? [i] : []))).toEqual([4, 8, 12])
  })

  it('every larger than the run never bumps', () => {
    const m = make({ beatsPerBar: 2, speed: { step: 10, every: 100, target: 200 } })
    const { beats } = run(m, 30000)
    expect(beats.every((b) => !b.bumped && b.bpm === 60)).toBe(true)
  })

  it('never exceeds the target when the step overshoots', () => {
    const m = make({ beatsPerBar: 1, speed: { step: 50, every: 1, target: 80 } })
    const { beats } = run(m, 6000)
    expect(Math.max(...bpms(beats))).toBe(80)
    expect(beats.filter((b) => b.bumped).map((b) => b.bpm)).toEqual([80])
  })

  it('does nothing when already at or above the target', () => {
    const m = make({ bpm: 120, beatsPerBar: 1, speed: { step: 5, every: 1, target: 100 } })
    const { beats } = run(m, 4000)
    expect(beats.every((b) => !b.bumped && b.bpm === 120)).toBe(true)
  })

  it('every of 0 or negative behaves like 1', () => {
    for (const every of [0, -3]) {
      const m = make({ beatsPerBar: 1, speed: { step: 10, every, target: 100 } })
      const { beats } = run(m, 4000)
      expect(beats.slice(0, 3).map((b) => b.bpm)).toEqual([60, 70, 80])
    }
  })

  it('a step of 0 does not report bumps that change nothing', () => {
    const m = make({ beatsPerBar: 1, speed: { step: 0, every: 1, target: 100 } })
    const { beats } = run(m, 5000)
    expect(beats.filter((b) => b.bumped)).toEqual([])
  })

  it('reset() restarts the bar count but keeps the ramped bpm', () => {
    const m = make({ beatsPerBar: 1, speed: { step: 10, every: 2, target: 200 } })
    run(m, 5000)
    const ramped = m.bpm
    m.reset()
    const { beats } = run(m, 100)
    expect(beats[0].bpm).toBe(ramped)
    expect(beats[0].bumped).toBe(false)
  })
})

describe('gap trainer edges', () => {
  it('gap and muted beats combine: muted beats stay silent in audible bars, all silent in gap bars', () => {
    const m = make({ beatsPerBar: 2, accents: ['accent', 'mute'], gap: { play: 1, mute: 1 }, subdivision: 2 })
    const { signal, beats } = run(m, 4000)
    expect(onsets(signal)).toEqual({ 0: 1, 500: 0.25 })
    expect(beats.map((b) => [b.beatInBar, b.level, b.audible])).toEqual([
      [0, 'accent', true],
      [1, 'mute', true],
      [0, 'accent', false],
      [1, 'mute', false],
    ])
  })

  it('a muted beat also silences its subdivisions', () => {
    const m = make({ beatsPerBar: 2, accents: ['accent', 'mute'], subdivision: 4 })
    const o = onsets(run(m, 2000).signal)
    expect(Object.keys(o).map(Number)).toEqual([0, 250, 500, 750])
  })

  it('gap bars silence subdivisions too and the audible bars resume on schedule', () => {
    const m = make({ beatsPerBar: 1, subdivision: 2, gap: { play: 1, mute: 2 } })
    const o = onsets(run(m, 6000).signal)
    expect(Object.keys(o).map(Number)).toEqual([0, 500, 3000, 3500])
  })

  it('gap with play 0 never sounds; with mute 0 always sounds', () => {
    const silent = run(make({ gap: { play: 0, mute: 2 } }), 5000)
    expect(Object.keys(onsets(silent.signal))).toEqual([])
    expect(silent.beats.every((b) => !b.audible)).toBe(true)
    const loud = run(make({ gap: { play: 2, mute: 0 } }), 5000)
    expect(loud.beats.every((b) => b.audible)).toBe(true)
  })

  it('turning the gap trainer off mid-run restores sound', () => {
    const m = make({ beatsPerBar: 1, gap: { play: 1, mute: 5 } })
    run(m, 2500) // bar 0 audible, 1 and 2 muted
    m.apply({ gap: null })
    const { beats } = run(m, 2000, 128, 2.5)
    expect(beats.every((b) => b.audible)).toBe(true)
  })

  it('still ramps tempo during muted gap bars', () => {
    const m = make({ beatsPerBar: 1, gap: { play: 1, mute: 3 }, speed: { step: 10, every: 1, target: 100 } })
    const { beats } = run(m, 5000)
    expect(beats.slice(0, 3).map((b) => b.bpm)).toEqual([60, 70, 80])
  })
})

describe('apply() with hostile values', () => {
  const finite = (a: Float32Array) => [...a].every(Number.isFinite)

  it('clamps non-finite and huge bpm', () => {
    const m = make()
    m.apply({ bpm: Infinity })
    expect(m.bpm).toBe(300)
    m.apply({ bpm: -Infinity })
    expect(m.bpm).toBe(30)
    m.apply({ bpm: 1e300 })
    expect(m.bpm).toBe(300)
    m.apply({ bpm: -5 })
    expect(m.bpm).toBe(30)
    m.apply({ bpm: Number.NaN })
    expect(m.bpm).toBe(30)
  })

  it('infinite volume yields finite, clipped output', () => {
    const m = make({ volume: Infinity })
    const { signal } = run(m, 2000)
    expect(finite(signal)).toBe(true)
    expect(Math.max(...signal)).toBeLessThanOrEqual(1)
  })

  it('huge, negative and NaN volume stay finite and within [-1, 1]', () => {
    for (const volume of [1e308, -1, Number.NaN, -Infinity, 5]) {
      const { signal } = run(make({ volume }), 2000)
      expect(finite(signal)).toBe(true)
      expect(Math.max(...signal.map(Math.abs))).toBeLessThanOrEqual(1)
    }
  })

  it('volume 0 is silent but still reports beats', () => {
    const { signal, beats } = run(make({ volume: 0 }), 2000)
    expect(onsets(signal)).toEqual({})
    expect(beats).toHaveLength(2)
  })

  it('non-finite swing falls back to a sensible position', () => {
    for (const swing of [Infinity, -Infinity, Number.NaN, -3]) {
      const o = Object.keys(onsets(run(make({ subdivision: 2, swing }), 1000).signal)).map(Number)
      expect(o).toHaveLength(2)
      expect(o[1]).toBeGreaterThanOrEqual(500)
      expect(o[1]).toBeLessThanOrEqual(750)
    }
  })

  it('weird beatsPerBar values do not hang or crash', () => {
    for (const beatsPerBar of [0, -4, Number.NaN, 2.9, 1e9, Infinity]) {
      const { beats } = run(make({ beatsPerBar }), 3000)
      expect(beats).toHaveLength(3)
      expect(beats[0].beatInBar).toBe(0)
    }
  })

  it('fractional beatsPerBar truncates', () => {
    const { beats } = run(make({ beatsPerBar: 2.9 }), 3000)
    expect(beats.map((b) => b.beatInBar)).toEqual([0, 1, 0])
  })

  it('gap trainer with NaN or Infinity bars does not silence the metronome forever', () => {
    for (const gap of [
      { play: Number.NaN, mute: Number.NaN },
      { play: Infinity, mute: Infinity },
    ]) {
      const { beats } = run(make({ gap }), 3000)
      expect(beats.some((b) => b.audible)).toBe(true)
    }
  })

  it('speed trainer with NaN/Infinity fields keeps bpm valid', () => {
    for (const speed of [
      { step: Number.NaN, every: 1, target: 100 },
      { step: 5, every: Number.NaN, target: 100 },
      { step: 5, every: 1, target: Number.NaN },
      { step: Infinity, every: 1, target: Infinity },
    ]) {
      const m = make({ beatsPerBar: 1, speed })
      const { beats } = run(m, 4000)
      for (const b of beats) {
        expect(Number.isFinite(b.bpm)).toBe(true)
        expect(b.bpm).toBeGreaterThanOrEqual(30)
        expect(b.bpm).toBeLessThanOrEqual(300)
      }
      expect(beats.length).toBeGreaterThan(2)
    }
  })

  it('ignores wrongly typed fields and keeps the previous values', () => {
    const m = make({ subdivision: 2, volume: 0.5 })
    m.apply({
      subdivision: '3',
      volume: null,
      accents: ['accent', 'loud'],
      sound: 'Kazoo',
      gap: { play: 1 },
      speed: 'fast',
    } as unknown as Partial<Settings>)
    expect(m.subdivision).toBe(2)
    expect(m.volume).toBe(0.5)
    expect(m.accents).toEqual([])
    expect(m.gap).toBeNull()
    expect(m.speed).toBeNull()
  })

  it('apply(null/undefined/primitive) is a no-op', () => {
    const m = make()
    for (const v of [null, undefined, 5, 'x', true]) m.apply(v as unknown as Partial<Settings>)
    expect(m.bpm).toBe(60)
  })

  it('accents are copied, so later mutation of the source array has no effect', () => {
    const src: Level[] = ['mute']
    const m = make({ accents: src })
    src[0] = 'accent'
    expect(m.levelOf(0)).toBe('mute')
  })

  it('an empty accents array restores default levels', () => {
    const m = make({ accents: ['mute', 'mute'] })
    m.apply({ accents: [] })
    expect([m.levelOf(0), m.levelOf(1)]).toEqual(['accent', 'normal'])
  })

  it('a sound change is picked up by the next render', () => {
    const m = new MetronomeCore(44100, { bpm: 60 })
    const a = new Float32Array(2000)
    m.render(a)
    m.apply({ sound: 'Hi-hat' })
    m.reset()
    const b = new Float32Array(2000)
    m.render(b)
    expect([...a].some((v, i) => v !== b[i])).toBe(true)
  })
})

describe('combined long run', () => {
  it('stays on grid with swing, speed trainer and gap together over many blocks', () => {
    const sr = 44100
    const m = new MetronomeCore(sr, {
      bpm: 100,
      subdivision: 2,
      swing: 0.66,
      beatsPerBar: 3,
      gap: { play: 1, mute: 1 },
      speed: { step: 7, every: 2, target: 140 },
    })
    const out = new Float32Array(128)
    const beats: Beat[] = []
    for (let i = 0; i < 20000; i++) beats.push(...m.render(out, (i * 128) / sr))
    let expected = 0
    for (const b of beats) {
      expect(Math.abs(b.time * sr - expected)).toBeLessThan(1 + 1e-6)
      expected += (sr * 60) / b.bpm
    }
    expect(beats.at(-1)?.bpm).toBe(140)
    expect(beats.filter((b) => !b.audible).length).toBeGreaterThan(0)
  })
})
