import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Beat } from '../engine/core'
import { MetronomeController } from './MetronomeController'

class FakePort {
  onmessage: ((e: { data: Beat[] }) => void) | null = null
  postMessage = vi.fn()
}

class FakeNode {
  port = new FakePort()
  connect = vi.fn()
  disconnect = vi.fn()
  ctx: FakeContext
  name: string
  options: { processorOptions: { bpm: number; beatsPerBar: number } }
  constructor(
    ctx: FakeContext,
    name: string,
    options: { processorOptions: { bpm: number; beatsPerBar: number } },
  ) {
    this.ctx = ctx
    this.name = name
    this.options = options
    nodes.push(this)
  }
}

interface Deferred {
  promise: Promise<void>
  resolve(): void
  reject(e: Error): void
}
function defer(): Deferred {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class FakeContext {
  destination = {}
  currentTime = 0
  outputLatency: number | undefined = 0
  timestamp: { contextTime?: number } | undefined = { contextTime: 0 }
  resume = vi.fn(() => Promise.resolve())
  suspend = vi.fn(() => Promise.resolve())
  addModule = vi.fn((_url: string): Promise<void> => Promise.resolve())
  audioWorklet = { addModule: (url: string) => this.addModule(url) }
  getOutputTimestamp: (() => { contextTime?: number }) | undefined = () => this.timestamp ?? {}
  options?: unknown
  constructor(options?: unknown) {
    this.options = options
    contexts.push(this)
  }
}

let nodes: FakeNode[]
let contexts: FakeContext[]

beforeEach(() => {
  nodes = []
  contexts = []
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('AudioWorkletNode', FakeNode)
})
afterEach(() => vi.unstubAllGlobals())

const make = () => new MetronomeController('worklet.js')

describe('MetronomeController start/stop', () => {
  it('creates the context once and reuses it across starts', async () => {
    const c = make()
    await c.start()
    c.stop()
    await c.start()
    expect(contexts).toHaveLength(1)
    expect(contexts[0].options).toEqual({ latencyHint: 'interactive' })
    expect(contexts[0].resume).toHaveBeenCalledTimes(2)
  })

  it('loads the module once, with the given url', async () => {
    const c = make()
    await c.start()
    c.stop()
    await c.start()
    expect(contexts[0].addModule).toHaveBeenCalledTimes(1)
    expect(contexts[0].addModule).toHaveBeenCalledWith('worklet.js')
  })

  it('a failed addModule rejects start, leaves no node, and can be retried', async () => {
    const c = make()
    // the context is created inside start(); make its first addModule fail
    let failNext = true
    vi.stubGlobal(
      'AudioContext',
      class extends FakeContext {
        constructor(o?: unknown) {
          super(o)
          this.addModule.mockImplementation(() =>
            failNext ? Promise.reject(new Error('boom')) : Promise.resolve(),
          )
        }
      },
    )
    await expect(c.start()).rejects.toThrow('boom')
    expect(nodes).toHaveLength(0)
    expect(c.now()).toBeNull()
    failNext = false
    await c.start()
    expect(contexts[0].addModule).toHaveBeenCalledTimes(2)
    expect(nodes).toHaveLength(1)
  })

  it('creates a mono, input-less node connected to the destination', async () => {
    const c = make()
    await c.start()
    const [node] = nodes
    expect(node.name).toBe('metronome')
    expect(node.options).toMatchObject({
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    expect(node.connect).toHaveBeenCalledWith(contexts[0].destination)
  })

  it('stop during a pending start cancels it: no node is created or connected', async () => {
    const gate = defer()
    const c = make()
    vi.stubGlobal(
      'AudioContext',
      class extends FakeContext {
        constructor(o?: unknown) {
          super(o)
          this.addModule.mockImplementation(() => gate.promise)
        }
      },
    )
    const started = c.start()
    c.stop()
    gate.resolve()
    await started
    expect(nodes).toHaveLength(0)
    expect(c.now()).toBeNull()
  })

  it('a start that is stopped and restarted while loading yields exactly one node', async () => {
    const gate = defer()
    const c = make()
    vi.stubGlobal(
      'AudioContext',
      class extends FakeContext {
        constructor(o?: unknown) {
          super(o)
          this.addModule.mockImplementation(() => gate.promise)
        }
      },
    )
    const first = c.start()
    c.stop()
    const second = c.start()
    gate.resolve()
    await Promise.all([first, second])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].connect).toHaveBeenCalledOnce()
  })

  it('double start is a no-op once running', async () => {
    const c = make()
    await c.start()
    await c.start()
    expect(nodes).toHaveLength(1)
    expect(contexts[0].resume).toHaveBeenCalledOnce()
  })

  it('stop disconnects the node, clears onmessage and suspends the context', async () => {
    const c = make()
    await c.start()
    const [node] = nodes
    c.stop()
    expect(node.disconnect).toHaveBeenCalledOnce()
    expect(node.port.onmessage).toBeNull()
    expect(contexts[0].suspend).toHaveBeenCalledOnce()
    expect(c.now()).toBeNull()
  })

  it('stop when not running does nothing', () => {
    const c = make()
    expect(() => c.stop()).not.toThrow()
    expect(contexts).toHaveLength(0)
  })

  it('each start makes a fresh node', async () => {
    const c = make()
    await c.start()
    c.stop()
    await c.start()
    expect(nodes).toHaveLength(2)
  })
})

const beat = (beatInBar: number, time: number): Beat => ({
  beatInBar,
  time,
  level: 'normal',
  audible: true,
  bpm: 120,
  bumped: false,
})

describe('MetronomeController settings', () => {
  it('uses defaults 120 / 4 when nothing was set', async () => {
    const c = make()
    await c.start()
    expect(nodes[0].options.processorOptions).toMatchObject({ bpm: 120, beatsPerBar: 4 })
  })

  it('setBpm/setBeatsPerBar before start go into processorOptions', async () => {
    const c = make()
    c.setBpm(90)
    c.setBeatsPerBar(7)
    await c.start()
    expect(nodes[0].options.processorOptions).toMatchObject({ bpm: 90, beatsPerBar: 7 })
    expect(nodes[0].port.postMessage).not.toHaveBeenCalled()
  })

  it('settings changed after start are posted to the port', async () => {
    const c = make()
    await c.start()
    c.setBpm(150)
    c.setBeatsPerBar(3)
    expect(nodes[0].port.postMessage).toHaveBeenNthCalledWith(1, { bpm: 150 })
    expect(nodes[0].port.postMessage).toHaveBeenNthCalledWith(2, { beatsPerBar: 3 })
  })

  it('settings persist into the next start', async () => {
    const c = make()
    await c.start()
    c.setBpm(77)
    c.stop()
    await c.start()
    expect(nodes[1].options.processorOptions.bpm).toBe(77)
  })

  it('settings changed while a start is pending reach the new node', async () => {
    const gate = defer()
    const c = make()
    vi.stubGlobal(
      'AudioContext',
      class extends FakeContext {
        constructor(o?: unknown) {
          super(o)
          this.addModule.mockImplementation(() => gate.promise)
        }
      },
    )
    const started = c.start()
    c.setBpm(200)
    gate.resolve()
    await started
    expect(nodes[0].options.processorOptions.bpm).toBe(200)
  })

  it('does not post after stop', async () => {
    const c = make()
    await c.start()
    c.stop()
    c.setBpm(100)
    expect(nodes[0].port.postMessage).not.toHaveBeenCalled()
  })
})

describe('MetronomeController beats', () => {
  it('delivers beats from the port to all listeners', async () => {
    const c = make()
    const a = vi.fn()
    const b = vi.fn()
    c.subscribe(a)
    c.subscribe(b)
    await c.start()
    const beats: Beat[] = [
      beat(0, 1), beat(1, 1.5),
    ]
    nodes[0].port.onmessage?.({ data: beats })
    expect(a.mock.calls.map((x) => x[0])).toEqual(beats)
    expect(b).toHaveBeenCalledTimes(2)
  })

  it('unsubscribe stops delivery to that listener only', async () => {
    const c = make()
    const a = vi.fn()
    const b = vi.fn()
    const off = c.subscribe(a)
    c.subscribe(b)
    await c.start()
    off()
    nodes[0].port.onmessage?.({ data: [beat(0, 1)] })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledOnce()
  })

  it('listeners subscribed before and after start both work; empty batch is harmless', async () => {
    const c = make()
    await c.start()
    const late = vi.fn()
    c.subscribe(late)
    nodes[0].port.onmessage?.({ data: [] })
    expect(late).not.toHaveBeenCalled()
    nodes[0].port.onmessage?.({ data: [beat(2, 3)] })
    expect(late).toHaveBeenCalledWith(beat(2, 3))
  })
})

describe('MetronomeController.now()', () => {
  it('is null before start', () => {
    expect(make().now()).toBeNull()
  })

  it('uses getOutputTimestamp().contextTime when positive', async () => {
    const c = make()
    await c.start()
    contexts[0].currentTime = 10
    contexts[0].timestamp = { contextTime: 4.25 }
    expect(c.now()).toBe(4.25)
  })

  it('falls back to currentTime - outputLatency when contextTime is 0', async () => {
    const c = make()
    await c.start()
    contexts[0].currentTime = 10
    contexts[0].outputLatency = 0.05
    contexts[0].timestamp = { contextTime: 0 }
    expect(c.now()).toBeCloseTo(9.95)
  })

  it('falls back when contextTime is missing', async () => {
    const c = make()
    await c.start()
    contexts[0].currentTime = 10
    contexts[0].outputLatency = 0.1
    contexts[0].timestamp = {}
    expect(c.now()).toBeCloseTo(9.9)
  })

  it('falls back when getOutputTimestamp does not exist', async () => {
    const c = make()
    await c.start()
    contexts[0].getOutputTimestamp = undefined
    contexts[0].currentTime = 3
    contexts[0].outputLatency = undefined
    expect(c.now()).toBe(3)
  })

  it('is null again after stop', async () => {
    const c = make()
    await c.start()
    c.stop()
    expect(c.now()).toBeNull()
  })
})
