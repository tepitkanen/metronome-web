// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface Processor {
  port: FakePort
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}
type Ctor = new (options?: unknown) => Processor

class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null
  postMessage = vi.fn()
}

let registered: { name: string; ctor: Ctor } | undefined

beforeEach(async () => {
  registered = undefined
  vi.stubGlobal('sampleRate', 1000)
  vi.stubGlobal('currentTime', 0)
  vi.stubGlobal(
    'AudioWorkletProcessor',
    class {
      port = new FakePort()
    },
  )
  vi.stubGlobal('registerProcessor', (name: string, ctor: Ctor) => {
    registered = { name, ctor }
  })
  vi.resetModules()
  await import('./worklet')
})
afterEach(() => vi.unstubAllGlobals())

const make = (processorOptions?: object) => {
  if (!registered) throw new Error('not registered')
  return new registered.ctor({ processorOptions })
}
const out = (channels: number, frames = 128) => [Array.from({ length: channels }, () => new Float32Array(frames))]
const send = (p: Processor, data: unknown) => p.port.onmessage?.({ data })

describe('worklet processor', () => {
  it('registers under the shared processor name', () => {
    expect(registered?.name).toBe('metronome')
  })

  it('process() returns true and fills all channels identically', () => {
    const p = make()
    const outputs = out(3, 64)
    expect(p.process([], outputs)).toBe(true)
    const [a, b, c] = outputs[0]
    expect(a.some((x) => x !== 0)).toBe(true) // downbeat click at offset 0
    expect(Array.from(b)).toEqual(Array.from(a))
    expect(Array.from(c)).toEqual(Array.from(a))
  })

  it('works with undefined options', () => {
    expect(() => new registered!.ctor().process([], out(1))).not.toThrow()
  })

  it('posts beats only when there are some', () => {
    const p = make({ bpm: 60 }) // one beat per 1000 frames at sampleRate 1000
    p.process([], out(1, 128)) // beat 0 at frame 0
    expect(p.port.postMessage).toHaveBeenCalledTimes(1)
    expect(p.port.postMessage).toHaveBeenCalledWith([expect.objectContaining({ beatInBar: 0, time: 0 })])
    p.process([], out(1, 128))
    p.process([], out(1, 128))
    expect(p.port.postMessage).toHaveBeenCalledTimes(1)
  })

  it('beat time uses currentTime of the block', () => {
    vi.stubGlobal('currentTime', 2.5)
    const p = make({ bpm: 60 })
    p.process([], out(1, 128))
    expect(p.port.postMessage).toHaveBeenCalledWith([expect.objectContaining({ beatInBar: 0, time: 2.5 })])
  })

  it('applies bpm and beatsPerBar from processorOptions', () => {
    const p = make({ bpm: 300, beatsPerBar: 2 }) // 200 frames/beat
    const beats: { beatInBar: number; time: number }[] = []
    for (let i = 0; i < 8; i++) {
      p.process([], out(1, 100))
      for (const call of p.port.postMessage.mock.calls.splice(0)) beats.push(...(call[0] as typeof beats))
    }
    expect(beats.map((b) => b.beatInBar)).toEqual([0, 1, 0, 1])
  })

  it('applies settings from port messages', () => {
    const p = make({ bpm: 60, beatsPerBar: 4 })
    p.process([], out(1, 128))
    p.port.postMessage.mockClear()
    send(p, { bpm: 300, beatsPerBar: 2 }) // next-beat interval is read per block
    const beats: number[] = []
    for (let i = 0; i < 40; i++) {
      p.process([], out(1, 100))
      for (const call of p.port.postMessage.mock.calls.splice(0))
        beats.push(...(call[0] as { beatInBar: number }[]).map((b) => b.beatInBar))
    }
    expect(beats.length).toBeGreaterThan(3)
    expect(Math.max(...beats)).toBeLessThanOrEqual(1)
  })

  it('ignores non-number fields in messages', () => {
    const p = make({ bpm: 300, beatsPerBar: 3 })
    send(p, { bpm: '60', beatsPerBar: null })
    send(p, { bpm: undefined, beatsPerBar: {} })
    send(p, {})
    const beats: number[] = []
    for (let i = 0; i < 10; i++) {
      p.process([], out(1, 100))
      for (const call of p.port.postMessage.mock.calls.splice(0))
        beats.push(...(call[0] as { beatInBar: number }[]).map((b) => b.beatInBar))
    }
    // still 300 BPM (200 frames per beat) and 3 beats per bar
    expect(beats).toEqual([0, 1, 2, 0, 1])
  })

  it('passes the other settings through processorOptions and messages', () => {
    // Noise sound: a sine click at the stubbed 1000 Hz sample rate would render as zeros.
    const p = make({ bpm: 60, sound: 'Hi-hat', accents: ['mute'], gap: { play: 1, mute: 1 } })
    const outputs = out(1, 1000)
    const heard = (from: number, to: number) => outputs[0][0].subarray(from, to).some((x) => x !== 0)
    p.process([], outputs)
    expect(heard(0, 1000)).toBe(false) // beat 0 muted
    expect(p.port.postMessage).toHaveBeenLastCalledWith([
      { beatInBar: 0, time: 0, level: 'mute', audible: true, bpm: 60, bumped: false },
    ])
    send(p, { subdivision: 2, volume: 0.5 })
    p.process([], outputs) // beat 1 at frame 0, its eighth at 500
    expect(heard(0, 100)).toBe(true)
    expect(heard(500, 600)).toBe(true)
  })

  it('does not crash on empty outputs', () => {
    const p = make()
    expect(p.process([], [])).toBe(true)
    expect(p.process([], [[]])).toBe(true)
    expect(p.process([], [undefined as unknown as Float32Array[]])).toBe(true)
    expect(p.port.postMessage).not.toHaveBeenCalled()
  })

  it('a zero-frame block does not post or crash', () => {
    const p = make()
    expect(p.process([], [[new Float32Array(0)]])).toBe(true)
  })

  it('clamps out-of-range bpm from messages (via core)', () => {
    const p = make({ bpm: 120 })
    expect(() => send(p, { bpm: 99999 })).not.toThrow()
    expect(() => send(p, { bpm: NaN })).not.toThrow()
    expect(p.process([], out(1))).toBe(true)
  })
})
