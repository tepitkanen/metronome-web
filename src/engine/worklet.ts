// AudioWorklet entry point. Runs on the audio rendering thread, not the main thread.
// Bundled separately and loaded via `import url from './engine/worklet.ts?worker&url'`.
import { MetronomeCore, PROCESSOR_NAME, type Settings } from './core'

// Globals of AudioWorkletGlobalScope (not part of TypeScript's DOM lib).
declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: AudioWorkletNodeOptions)
}
declare function registerProcessor(
  name: string,
  ctor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void

class MetronomeProcessor extends AudioWorkletProcessor {
  private core: MetronomeCore

  constructor(options?: AudioWorkletNodeOptions) {
    super(options)
    // Initial settings arrive with the node, so the very first block is already correct.
    this.core = new MetronomeCore(sampleRate, options?.processorOptions as Partial<Settings>)
    // Later changes arrive as settings patches; the core ignores fields of the wrong type.
    this.port.onmessage = (e: MessageEvent<Partial<Settings>>) => this.core.apply(e.data)
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const channels = outputs[0]
    const first = channels?.[0]
    if (!first) return true
    const beats = this.core.render(first, currentTime)
    for (let c = 1; c < channels.length; c++) channels[c].set(first)
    if (beats.length) this.port.postMessage(beats)
    return true // keep the processor alive until the node is disconnected
  }
}

registerProcessor(PROCESSOR_NAME, MetronomeProcessor)
