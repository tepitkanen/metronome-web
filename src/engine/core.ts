import { SOUNDS, isSoundName, type SoundBank, type SoundName } from './sound'
import { clampBpm } from './tempo'

/** Name the worklet registers under (shared so the main thread never imports worklet.ts). */
export const PROCESSOR_NAME = 'metronome'

/** Per-beat level. A muted beat also silences its subdivisions. */
export type Level = 'accent' | 'normal' | 'mute'
export const LEVELS: readonly Level[] = ['accent', 'normal', 'mute']

/** Ticks per beat: quarter notes, eighths, triplets, sixteenths. */
export const SUBDIVISIONS = [1, 2, 3, 4] as const
export const MIN_SWING = 0.5 // offbeat eighth exactly halfway: straight
export const MAX_SWING = 0.75 // offbeat on the last sixteenth: hard swing

/** Level of a beat that has no entry in `accents`: beat 0 is accented. */
export const defaultLevel = (beat: number): Level => (beat === 0 ? 'accent' : 'normal')

export interface Beat {
  /** Position in the bar, 0 = downbeat. */
  beatInBar: number
  /** AudioContext time at which this click is rendered. */
  time: number
  level: Level
  /** False inside a muted gap-trainer bar. */
  audible: boolean
  /** Tempo of this beat. */
  bpm: number
  /** True when the speed trainer raised the tempo on this beat. */
  bumped: boolean
}

export interface GapTrainer {
  /** Bars played, then bars muted, repeating. */
  play: number
  mute: number
}

export interface SpeedTrainer {
  /** Add `step` BPM every `every` bars until `target` is reached. */
  step: number
  every: number
  target: number
}

export interface Settings {
  bpm: number
  beatsPerBar: number
  subdivision: number
  /** Position of the offbeat eighth within the beat (eighths only), MIN_SWING..MAX_SWING. */
  swing: number
  /** Per-beat levels; beats beyond the end use defaultLevel(). */
  accents: readonly Level[]
  /** Output gain, 0..1. */
  volume: number
  sound: SoundName
  gap: GapTrainer | null
  speed: SpeedTrainer | null
}

export const DEFAULT_SETTINGS: Settings = {
  bpm: 120,
  beatsPerBar: 4,
  subdivision: 1,
  swing: MIN_SWING,
  accents: [],
  volume: 1,
  sound: 'Beep',
  gap: null,
  speed: null,
}

const isNum = (v: unknown): v is number => typeof v === 'number'
const isFiniteNum = (v: unknown): v is number => Number.isFinite(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function validGap(v: unknown): GapTrainer | null | undefined {
  if (v === null) return null
  if (isRecord(v) && isFiniteNum(v.play) && isFiniteNum(v.mute)) return { play: v.play, mute: v.mute }
  return undefined
}

function validSpeed(v: unknown): SpeedTrainer | null | undefined {
  if (v === null) return null
  if (isRecord(v) && isFiniteNum(v.step) && isFiniteNum(v.every) && isFiniteNum(v.target))
    return { step: v.step, every: v.every, target: v.target }
  return undefined
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
  beatsPerBar = DEFAULT_SETTINGS.beatsPerBar
  subdivision = DEFAULT_SETTINGS.subdivision
  swing = DEFAULT_SETTINGS.swing
  accents: readonly Level[] = DEFAULT_SETTINGS.accents
  volume = DEFAULT_SETTINGS.volume
  gap: GapTrainer | null = null
  speed: SpeedTrainer | null = null
  private _bpm = DEFAULT_SETTINGS.bpm

  private beatStart = 0 // current beat's position, in samples from the current block start
  private beatInterval = 0 // latched when the beat starts
  private tick = 0 // next subdivision tick within the current beat
  private beatInBar = 0 // index the next beat will get
  private bar = -1 // bars since start; becomes 0 on the first downbeat
  private beatSounds = true // whether the current beat (and its subs) is heard
  private tails: Float32Array[] = [] // unplayed ends of clicks that crossed a block

  constructor(sampleRate: number, settings: Partial<Settings> = {}) {
    this.sampleRate = sampleRate
    this.buffers = SOUNDS[DEFAULT_SETTINGS.sound](sampleRate)
    this.apply(settings)
  }

  get bpm(): number {
    return this._bpm
  }

  set bpm(value: number) {
    this._bpm = clampBpm(value)
  }

  setSound(name: SoundName): void {
    this.buffers = SOUNDS[name](this.sampleRate)
  }

  /** Apply a settings patch, e.g. a port message. Fields of the wrong type are ignored. */
  apply(patch: Partial<Settings> | null | undefined): void {
    if (!isRecord(patch)) return
    const p = patch as Record<string, unknown>
    if (isNum(p.bpm)) this.bpm = p.bpm
    if (isNum(p.beatsPerBar)) this.beatsPerBar = p.beatsPerBar
    if (isNum(p.subdivision)) this.subdivision = p.subdivision
    if (isNum(p.swing)) this.swing = p.swing
    if (isNum(p.volume) && p.volume !== Infinity) this.volume = p.volume // Infinity would turn silence into NaN
    if (Array.isArray(p.accents) && p.accents.every((l) => LEVELS.includes(l))) this.accents = [...p.accents]
    if (isSoundName(p.sound)) this.setSound(p.sound)
    const gap = validGap(p.gap)
    if (gap !== undefined) this.gap = gap
    const speed = validSpeed(p.speed)
    if (speed !== undefined) this.speed = speed
  }

  levelOf(beat: number): Level {
    return this.accents[beat] ?? defaultLevel(beat)
  }

  reset(): void {
    this.beatStart = 0
    this.beatInterval = 0
    this.tick = 0
    this.beatInBar = 0
    this.bar = -1
    this.beatSounds = true
    this.tails = []
  }

  /** Advance the bar/beat counters for a new beat and apply both trainers. */
  private startBeat(bpb: number, time: number): Beat {
    const idx = this.beatInBar < bpb ? this.beatInBar : 0
    let bumped = false
    if (idx === 0) {
      this.bar++
      const speed = this.speed
      if (speed && this.bar > 0 && this.bar % Math.max(1, speed.every) === 0 && this._bpm < speed.target) {
        const before = this._bpm
        this.bpm = Math.min(speed.target, this._bpm + speed.step)
        bumped = this._bpm !== before // a step of 0 (or a negative one) changes nothing
      }
    }
    this.beatInterval = (this.sampleRate * 60) / this._bpm
    this.beatInBar = idx + 1

    const gap = this.gap
    const audible = !gap || this.bar % Math.max(1, gap.play + gap.mute) < gap.play
    const level = this.levelOf(idx)
    this.beatSounds = audible && level !== 'mute'
    return { beatInBar: idx, time, level, audible, bpm: this._bpm, bumped }
  }

  /** Fill `out` with the next block of samples; return the beats that start in it. */
  render(out: Float32Array, startTime = 0): Beat[] {
    out.fill(0)
    const tails: Float32Array[] = []
    for (const buf of this.tails) mix(out, tails, buf, 0)

    const frames = out.length
    const sub = (SUBDIVISIONS as readonly number[]).includes(this.subdivision) ? this.subdivision : 1
    const swing = Math.min(MAX_SWING, Math.max(MIN_SWING, this.swing)) || MIN_SWING
    const bpb = Math.max(1, Math.trunc(this.beatsPerBar) || 1)
    const buffers = this.buffers
    const beats: Beat[] = []
    for (;;) {
      if (this.tick >= sub) {
        // beat finished (also if the subdivision just shrank)
        this.beatStart += this.beatInterval
        this.tick = 0
      }
      const frac = this.tick === 0 ? 0 : sub === 2 ? swing : this.tick / sub
      const posF = this.beatStart + this.beatInterval * frac
      if (posF >= frames) break
      if (posF < 0) {
        // tick made late by a subdivision/swing change: skip it
        this.tick++
        continue
      }
      const pos = Math.floor(posF)
      let buf = buffers.sub
      if (this.tick === 0) {
        const beat = this.startBeat(bpb, startTime + pos / this.sampleRate)
        beats.push(beat)
        if (beat.level !== 'mute') buf = buffers[beat.level]
      }
      if (this.beatSounds) mix(out, tails, buf, pos)
      this.tick++
    }
    this.beatStart -= frames
    this.tails = tails

    const vol = this.volume > 0 ? this.volume : 0 // also maps NaN to silence
    for (let i = 0; i < frames; i++) out[i] = Math.min(1, Math.max(-1, out[i] * vol))
    return beats
  }
}

function mix(out: Float32Array, tails: Float32Array[], buf: Float32Array, pos: number): void {
  const n = Math.min(buf.length, out.length - pos)
  for (let i = 0; i < n; i++) out[pos + i] += buf[i]
  if (buf.length > n) tails.push(buf.subarray(n))
}
