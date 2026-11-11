// configure() before/after start, between starts, and while a start is loading.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../engine/core'
import { MetronomeController } from './MetronomeController'

class FakeNode {
  port = { onmessage: null as unknown, postMessage: vi.fn() }
  connect = vi.fn()
  disconnect = vi.fn()
  options: { processorOptions: Settings }
  constructor(_ctx: unknown, _name: string, options: { processorOptions: Settings }) {
    this.options = options
    nodes.push(this)
  }
}

class FakeContext {
  destination = {}
  currentTime = 0
  outputLatency = 0
  resume = vi.fn(() => Promise.resolve())
  suspend = vi.fn(() => Promise.resolve())
  addModule = vi.fn((_url: string): Promise<void> => gate ?? Promise.resolve())
  audioWorklet = { addModule: (url: string) => this.addModule(url) }
  getOutputTimestamp = () => ({ contextTime: 0 })
}

let nodes: FakeNode[]
let gate: Promise<void> | null

beforeEach(() => {
  nodes = []
  gate = null
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
})
afterEach(() => vi.unstubAllGlobals())

const make = () => new MetronomeController('worklet.js')

describe('MetronomeController.configure', () => {
  it('settings configured before the first start become the node processorOptions', async () => {
    const c = make()
    c.configure({ subdivision: 3, sound: 'Wood', volume: 0.3, accents: ['mute', 'normal'] })
    c.setBpm(90)
    c.setBeatsPerBar(7)
    c.configure({ gap: { play: 1, mute: 2 }, speed: { step: 3, every: 2, target: 150 } })
    await c.start()
    expect(nodes[0].options.processorOptions).toMatchObject({
      bpm: 90,
      beatsPerBar: 7,
      subdivision: 3,
      sound: 'Wood',
      volume: 0.3,
      accents: ['mute', 'normal'],
      gap: { play: 1, mute: 2 },
      speed: { step: 3, every: 2, target: 150 },
    })
    expect(nodes[0].port.postMessage).not.toHaveBeenCalled()
  })

  it('defaults are used for anything never configured', async () => {
    const c = make()
    await c.start()
    expect(nodes[0].options.processorOptions).toEqual(DEFAULT_SETTINGS)
  })

  it('configure after start posts exactly the patch to the live node', async () => {
    const c = make()
    await c.start()
    c.configure({ swing: 0.7 })
    c.configure({ gap: null })
    expect(nodes[0].port.postMessage.mock.calls).toEqual([[{ swing: 0.7 }], [{ gap: null }]])
  })

  it('configure while stopped is remembered for the next start, not posted to the old node', async () => {
    const c = make()
    await c.start()
    c.stop()
    c.configure({ volume: 0.1, subdivision: 4 })
    expect(nodes[0].port.postMessage).not.toHaveBeenCalled()
    await c.start()
    expect(nodes).toHaveLength(2)
    expect(nodes[1].options.processorOptions).toMatchObject({ volume: 0.1, subdivision: 4 })
  })

  it('settings changed while running carry over to the node of the next start', async () => {
    const c = make()
    await c.start()
    c.configure({ sound: 'Hi-hat' })
    c.setBpm(77)
    c.stop()
    await c.start()
    expect(nodes[1].options.processorOptions).toMatchObject({ sound: 'Hi-hat', bpm: 77 })
  })

  it('configure while a start is still loading lands in the node created afterwards', async () => {
    let release!: () => void
    gate = new Promise<void>((r) => (release = r))
    const c = make()
    const started = c.start()
    c.configure({ subdivision: 2, swing: 0.66 })
    release()
    await started
    expect(nodes[0].options.processorOptions).toMatchObject({ subdivision: 2, swing: 0.66 })
  })

  it('configure after a cancelled start does not post to anything and survives to the next start', async () => {
    let release!: () => void
    gate = new Promise<void>((r) => (release = r))
    const c = make()
    const first = c.start()
    c.stop()
    c.configure({ volume: 0.2 })
    release()
    await first
    expect(nodes).toHaveLength(0)
    gate = null
    await c.start()
    expect(nodes[0].options.processorOptions.volume).toBe(0.2)
  })

  it('processorOptions is a snapshot: later configure does not mutate it', async () => {
    const c = make()
    await c.start()
    const snap = nodes[0].options.processorOptions
    c.configure({ volume: 0.5 })
    expect(snap.volume).toBe(DEFAULT_SETTINGS.volume)
  })

  it('does not mutate the shared DEFAULT_SETTINGS or leak between controllers', async () => {
    const before = JSON.stringify(DEFAULT_SETTINGS)
    const a = make()
    a.configure({ volume: 0.1, bpm: 200 })
    expect(JSON.stringify(DEFAULT_SETTINGS)).toBe(before)
    const b = make()
    await b.start()
    expect(nodes[0].options.processorOptions).toEqual(DEFAULT_SETTINGS)
  })

  it('the last configure wins when the same key is set repeatedly', async () => {
    const c = make()
    for (const v of [0.1, 0.9, 0.4]) c.configure({ volume: v })
    await c.start()
    expect(nodes[0].options.processorOptions.volume).toBe(0.4)
  })

  it('a null trainer clears a previously configured one for the next start', async () => {
    const c = make()
    c.configure({ gap: { play: 1, mute: 1 } })
    c.configure({ gap: null })
    await c.start()
    expect(nodes[0].options.processorOptions.gap).toBeNull()
  })

  it('stop() then configure() does not throw when no context exists yet', () => {
    const c = make()
    expect(() => {
      c.stop()
      c.configure({ volume: 0.5 })
    }).not.toThrow()
  })
})
