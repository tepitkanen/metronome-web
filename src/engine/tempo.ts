export const MIN_BPM = 30
export const MAX_BPM = 300

/** Clamp to MIN_BPM..MAX_BPM and round to a whole BPM. NaN maps to MIN_BPM. */
export function clampBpm(bpm: number): number {
  if (Number.isNaN(bpm)) return MIN_BPM
  return Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)))
}

/** Average the intervals between the most recent taps into a BPM. */
export class TapTempo {
  private taps: number[] = []
  readonly maxTaps: number
  readonly timeout: number
  readonly clock: () => number

  constructor(
    maxTaps = 4,
    timeout = 2, // seconds
    clock: () => number = () => performance.now() / 1000,
  ) {
    this.maxTaps = maxTaps
    this.timeout = timeout
    this.clock = clock
  }

  /** Register a tap (time in seconds); return the BPM once there are at least two taps. */
  tap(now: number = this.clock()): number | null {
    const last = this.taps.at(-1)
    if (last !== undefined && now - last > this.timeout) this.taps = []
    this.taps = [...this.taps, now].slice(-this.maxTaps)
    if (this.taps.length < 2) return null
    const interval = (now - this.taps[0]) / (this.taps.length - 1)
    if (!(interval > 0)) return null
    return clampBpm(60 / interval)
  }
}
