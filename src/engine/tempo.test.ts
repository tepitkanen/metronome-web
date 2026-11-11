import { describe, expect, it } from 'vitest'
import { MAX_BPM, MIN_BPM, TapTempo, clampBpm } from './tempo'

describe('clampBpm', () => {
  it('clamps and rounds', () => {
    expect(clampBpm(10)).toBe(MIN_BPM)
    expect(clampBpm(1000)).toBe(MAX_BPM)
    expect(clampBpm(120.4)).toBe(120)
    expect(clampBpm(29.5)).toBe(30)
    expect(clampBpm(-5)).toBe(30)
  })

  it('handles infinity and NaN', () => {
    expect(clampBpm(Infinity)).toBe(300)
    expect(clampBpm(-Infinity)).toBe(30)
    expect(clampBpm(Number.NaN)).toBe(30)
  })
})

describe('TapTempo', () => {
  it('returns null on the first tap', () => {
    expect(new TapTempo().tap(0)).toBeNull()
  })

  it('averages the intervals', () => {
    const t = new TapTempo()
    let bpm = null
    for (const now of [0, 0.5, 1]) bpm = t.tap(now)
    expect(bpm).toBe(120)
  })

  it('keeps only the most recent taps', () => {
    const t = new TapTempo(4)
    let bpm = null
    for (const now of [0, 1, 2, 2.25, 2.5, 2.75]) bpm = t.tap(now)
    expect(bpm).toBe(240)
  })

  it('resets after a gap longer than the timeout', () => {
    const t = new TapTempo(4, 2)
    t.tap(0)
    t.tap(0.5)
    expect(t.tap(10)).toBeNull()
    expect(t.tap(11)).toBe(60)
  })

  it('does not reset at exactly the timeout', () => {
    const t = new TapTempo(4, 2)
    t.tap(0)
    expect(t.tap(2)).toBe(30)
  })

  it('returns null for identical or backwards timestamps', () => {
    const t = new TapTempo()
    t.tap(1)
    expect(t.tap(1)).toBeNull()
    const u = new TapTempo()
    u.tap(5)
    expect(u.tap(4)).toBeNull()
  })

  it('clamps very fast and very slow taps', () => {
    const fast = new TapTempo()
    fast.tap(0)
    expect(fast.tap(0.05)).toBe(MAX_BPM)
    const slow = new TapTempo()
    slow.tap(0)
    expect(slow.tap(1.9)).toBe(32)
  })

  it('uses the injected clock', () => {
    let now = 0
    const t = new TapTempo(4, 2, () => now)
    t.tap()
    now = 0.25
    expect(t.tap()).toBe(240)
  })
})
