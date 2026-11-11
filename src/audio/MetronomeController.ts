import { DEFAULT_SETTINGS, PROCESSOR_NAME, type Beat, type Settings } from '../engine/core'

/** What the UI needs from the audio side; tests substitute a fake. */
export interface MetronomeLike {
  /** Call `listener` for every beat; returns an unsubscribe function. */
  subscribe(listener: (beat: Beat) => void): () => void
  start(): Promise<void>
  stop(): void
  setBpm(bpm: number): void
  setBeatsPerBar(beatsPerBar: number): void
  /** Change any other engine settings (subdivision, accents, sound, trainers, ...). */
  configure(patch: Partial<Settings>): void
  /** AudioContext time of the sound currently reaching the speakers, or null when stopped. */
  now(): number | null
}

/**
 * Main-thread side of the metronome: owns the AudioContext and one AudioWorkletNode
 * per Start (so each start resets the engine). Settings go to the worklet by message;
 * beats come back by message with their AudioContext time.
 */
export class MetronomeController implements MetronomeLike {
  private readonly listeners = new Set<(beat: Beat) => void>()
  private readonly workletUrl: string
  private ctx: AudioContext | null = null
  private moduleLoaded: Promise<void> | null = null
  private node: AudioWorkletNode | null = null
  private startToken = 0
  private settings: Settings = DEFAULT_SETTINGS

  constructor(workletUrl: string) {
    this.workletUrl = workletUrl
  }

  subscribe(listener: (beat: Beat) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<void> {
    if (this.node) return
    const token = ++this.startToken
    // Created/resumed inside the Start click, which satisfies the browser autoplay policy.
    const ctx = (this.ctx ??= new AudioContext({ latencyHint: 'interactive' }))
    const resumed = ctx.resume()
    this.moduleLoaded ??= ctx.audioWorklet.addModule(this.workletUrl).catch((err: unknown) => {
      this.moduleLoaded = null // allow a retry
      throw err
    })
    await Promise.all([this.moduleLoaded, resumed])
    if (token !== this.startToken) return // stopped (or restarted) while loading

    const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { ...this.settings },
    })
    node.port.onmessage = (e: MessageEvent<Beat[]>) => {
      for (const beat of e.data) for (const listener of this.listeners) listener(beat)
    }
    node.connect(ctx.destination)
    this.node = node
  }

  stop(): void {
    this.startToken++ // cancels a start that is still loading
    const node = this.node
    this.node = null
    void this.ctx?.suspend() // nothing is playing (also after a cancelled start); let the device idle
    if (!node) return
    node.port.onmessage = null
    node.disconnect()
  }

  setBpm(bpm: number): void {
    this.configure({ bpm })
  }

  setBeatsPerBar(beatsPerBar: number): void {
    this.configure({ beatsPerBar })
  }

  configure(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch } // remembered for the next Start's node
    this.node?.port.postMessage(patch)
  }

  now(): number | null {
    const ctx = this.ctx
    if (!ctx || !this.node) return null
    const heard = ctx.getOutputTimestamp?.().contextTime
    return heard !== undefined && heard > 0 ? heard : ctx.currentTime - (ctx.outputLatency || 0)
  }
}
