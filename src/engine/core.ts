import { beepBank, type SoundBank } from './sound'
import { clampBpm } from './tempo'

/** Name the worklet registers under (shared so the main thread never imports worklet.ts). */
export const PROCESSOR_NAME = 'metronome'

export interface Beat {
  /** Position in the bar, 0 = downbeat. */
  beatInBar: number
  /** AudioContext time at which this click is rendered. */
  time: number
}

export interface Settings {
  bpm: number
  beatsPerBar: number
}

/**
 * Sample-accurate metronome engine (port of the Python app's engine.py).
 *
 * `render()` mixes clicks into each audio block at exact sample offsets, so timing
 * never depends on JS timers. It is pure apart from its own state, so it runs both
 * inside the AudioWorklet and in unit tests.
 */
export class MetronomeCore {
  readonly sampleRate: number
  buffers: SoundBank
  beatsPerBar: number
  private _bpm = 120
  private beatStart = 0 // next beat's position, in samples from the current block start
  private beatInBar = 0 // index the next beat will get
  private tails: Float32Array[] = [] // unplayed ends of clicks that crossed a block

  constructor(sampleRate: number, { bpm = 120, beatsPerBar = 4 }: Partial<Settings> = {}) {
    this.sampleRate = sampleRate
    this.bpm = bpm
    this.beatsPerBar = beatsPerBar
    this.buffers = beepBank(sampleRate)
  }

  get bpm(): number {
    return this._bpm
  }

  set bpm(value: number) {
    this._bpm = clampBpm(value)
  }

  reset(): void {
    this.beatStart = 0
    this.beatInBar = 0
    this.tails = []
  }

  /** Fill `out` with the next block of samples; return the beats that start in it. */
  render(out: Float32Array, startTime = 0): Beat[] {
    out.fill(0)
    const tails: Float32Array[] = []
    for (const buf of this.tails) mix(out, tails, buf, 0)

    const frames = out.length
    const bpb = Math.max(1, Math.trunc(this.beatsPerBar) || 1)
    const interval = (this.sampleRate * 60) / this._bpm // read once per block
    const beats: Beat[] = []
    while (this.beatStart < frames) {
      const pos = Math.floor(this.beatStart)
      const idx = this.beatInBar < bpb ? this.beatInBar : 0
      mix(out, tails, idx === 0 ? this.buffers.accent : this.buffers.normal, pos)
      beats.push({ beatInBar: idx, time: startTime + pos / this.sampleRate })
      this.beatInBar = idx + 1
      this.beatStart += interval
    }
    this.beatStart -= frames
    this.tails = tails
    return beats
  }
}

function mix(out: Float32Array, tails: Float32Array[], buf: Float32Array, pos: number): void {
  const n = Math.min(buf.length, out.length - pos)
  for (let i = 0; i < n; i++) out[pos + i] += buf[i]
  if (buf.length > n) tails.push(buf.subarray(n))
}
