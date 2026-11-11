import { describe, expect, it } from 'vitest'
import { MetronomeCore } from './core'
import { makeClick } from './sound'

const SR = 1000 // tiny sample rate keeps the arithmetic readable

function make({ bpm = 60, beatsPerBar = 4, clickLen = 5 } = {}) {
  const m = new MetronomeCore(SR, { bpm, beatsPerBar })
  // Simple stand-in clicks so the output is easy to inspect.
  m.buffers = {
    accent: new Float32Array(clickLen).fill(1),
    normal: new Float32Array(clickLen).fill(0.5),
  }
  return m
}

function render(m: MetronomeCore, frames: number, startTime = 0) {
  const out = new Float32Array(frames)
  const beats = m.render(out, startTime)
  return { out, beats }
}

function concat(parts: Float32Array[]) {
  const total = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    total.set(p, offset)
    offset += p.length
  }
  return total
}

const nonzero = (a: Float32Array) => [...a.keys()].filter((i) => a[i] !== 0)

describe('MetronomeCore.render', () => {
  it('places clicks at exact sample offsets', () => {
    const m = make({ bpm: 120 }) // one beat every 500 samples
    const parts = Array.from({ length: 8 }, () => render(m, 256).out) // 2048 samples
    const expected = [0, 500, 1000, 1500, 2000].flatMap((s) => [0, 1, 2, 3, 4].map((k) => s + k))
    expect(nonzero(concat(parts))).toEqual(expected)
  })

  it('reports beat times on the stream clock', () => {
    const m = make({ bpm: 120 })
    expect(render(m, 1000, 10).beats.map((b) => b.time)).toEqual([10, 10.5])
  })

  it('accents the first beat of each bar', () => {
    const m = make({ bpm: 300, beatsPerBar: 3 }) // beat every 200 samples
    const { out, beats } = render(m, 1000)
    expect(beats.map((b) => b.beatInBar)).toEqual([0, 1, 2, 0, 1])
    expect([0, 200, 400, 600, 800].map((i) => out[i])).toEqual([1, 0.5, 0.5, 1, 0.5])
  })

  it('keeps a click continuous across a block boundary', () => {
    const whole = render(make(), 100).out
    const m = make()
    expect(concat([render(m, 2).out, render(m, 98).out])).toEqual(whole)
  })

  it('applies a BPM change from the next beat', () => {
    const m = make({ bpm: 60 }) // beat at 0, next already scheduled at 1000
    const a = render(m, 500, 0).beats
    m.bpm = 120
    const b = render(m, 2000, 0.5).beats
    expect([...a, ...b].map((x) => x.time)).toEqual([0, 1, 1.5, 2])
  })

  it('wraps to the downbeat when beats per bar shrinks mid-bar', () => {
    const m = make({ bpm: 300, beatsPerBar: 4 })
    const a = render(m, 600).beats // 0, 1, 2
    m.beatsPerBar = 2
    const b = render(m, 400).beats
    expect([...a, ...b].map((x) => x.beatInBar)).toEqual([0, 1, 2, 0, 1])
  })

  it('continues the count when beats per bar grows', () => {
    const m = make({ bpm: 300, beatsPerBar: 2 })
    const a = render(m, 400).beats
    m.beatsPerBar = 4
    const b = render(m, 600).beats
    expect([...a, ...b].map((x) => x.beatInBar)).toEqual([0, 1, 2, 3, 0])
  })

  it('treats beats per bar of 0 or NaN as 1', () => {
    for (const bpb of [0, Number.NaN]) {
      const m = make({ bpm: 300, beatsPerBar: bpb })
      expect(render(m, 600).beats.map((x) => x.beatInBar)).toEqual([0, 0, 0])
    }
  })

  it('clamps BPM', () => {
    const m = make()
    m.bpm = 5
    expect(m.bpm).toBe(30)
  })

  it('handles an empty block', () => {
    const m = make()
    const { out, beats } = render(m, 0)
    expect(out.length).toBe(0)
    expect(beats).toEqual([])
    expect([...render(m, 10).out.slice(0, 5)]).toEqual([1, 1, 1, 1, 1])
  })

  it('gives the same output for 1-frame blocks as for one big block', () => {
    const whole = render(make({ bpm: 300 }), 1000).out
    const m = make({ bpm: 300 })
    expect(concat(Array.from({ length: 1000 }, () => render(m, 1).out))).toEqual(whole)
  })

  it('mixes overlapping clicks additively, also across blocks', () => {
    const whole = render(make({ bpm: 300, clickLen: 300 }), 1000).out // interval 200, click 300
    expect(whole[0]).toBe(1)
    expect(whole[200]).toBeCloseTo(1.5) // accent tail + click 1
    expect(whole[300]).toBeCloseTo(0.5)
    const m = make({ bpm: 300, clickLen: 300 })
    const split = concat([1, 7, 100, 3, 389, 500].map((n) => render(m, n).out))
    expect(split).toEqual(whole)
  })

  it('reset restarts the bar, the clock and drops pending tails', () => {
    const m = make({ bpm: 30 }) // interval 2000
    render(m, 450)
    m.reset()
    const { out, beats } = render(m, 10)
    expect(beats).toEqual([{ beatInBar: 0, time: 0 }])
    expect([...out.slice(0, 6)]).toEqual([1, 1, 1, 1, 1, 0]) // no leftover tail on top
  })

  it('does not drift over a long run with 128-frame blocks', () => {
    const sr = 44100
    const bpm = 97
    const block = 128 // AudioWorklet render quantum
    const m = new MetronomeCore(sr, { bpm })
    const interval = (sr * 60) / bpm
    const times: number[] = []
    const blocks = 25000 // ~72 s of audio
    const out = new Float32Array(block)
    for (let i = 0; i < blocks; i++) {
      times.push(...m.render(out, (i * block) / sr).map((b) => b.time))
    }
    expect(times.length).toBe(Math.ceil((blocks * block) / interval))
    times.forEach((t, k) => {
      // one sample of truncation is fine; a growing error is not
      expect(Math.abs(t * sr - k * interval)).toBeLessThan(1 + 1e-6)
    })
  })
})

describe('makeClick', () => {
  it('produces a short, bounded, silent-start click', () => {
    for (const sr of [8000, 44100, 48000]) {
      const c = makeClick(1000, sr, { ms: 30, volume: 0.6 })
      expect(c).toBeInstanceOf(Float32Array)
      expect(c.length).toBe(Math.floor((sr * 30) / 1000))
      expect(Math.max(...c.map(Math.abs))).toBeLessThanOrEqual(0.6 + 1e-6)
      expect(Math.abs(c[0])).toBeLessThan(1e-3)
      expect(c.every(Number.isFinite)).toBe(true)
    }
  })

  it('handles tiny durations', () => {
    expect(makeClick(1000, 44100, { ms: 0 }).length).toBe(0)
    expect(makeClick(1000, 1000, { ms: 1 }).length).toBe(1)
  })
})
