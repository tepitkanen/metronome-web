import { useCallback, useEffect, useRef, useState } from 'react'
import type { MetronomeLike } from '../audio/MetronomeController'
import { MIN_SWING, defaultLevel, type Beat, type Level } from '../engine/core'
import type { SoundName } from '../engine/sound'
import { TapTempo, clampBpm } from '../engine/tempo'

export const MIN_BEATS = 1
export const MAX_BEATS = 12

export function clampBeats(n: number): number {
  if (Number.isNaN(n)) return MIN_BEATS
  return Math.round(Math.min(MAX_BEATS, Math.max(MIN_BEATS, n)))
}

const NEXT_LEVEL: Record<Level, Level> = { accent: 'normal', normal: 'mute', mute: 'accent' }

export interface GapSettings {
  on: boolean
  play: number
  mute: number
}

export interface SpeedSettings {
  on: boolean
  step: number
  every: number
  target: number
}

/** React state for the metronome, wired to the audio controller. */
export function useMetronome(controller: MetronomeLike) {
  const [bpm, setBpmState] = useState(120)
  const [beatsPerBar, setBeatsState] = useState(4)
  const [subdivision, setSubdivision] = useState(1)
  const [swing, setSwing] = useState(Math.round(MIN_SWING * 100)) // percent
  const [sound, setSound] = useState<SoundName>('Beep')
  const [volume, setVolume] = useState(100) // percent
  const [accents, setAccents] = useState<Level[]>([])
  const [gap, setGapState] = useState<GapSettings>({ on: false, play: 2, mute: 2 })
  const [speed, setSpeedState] = useState<SpeedSettings>({ on: false, step: 5, every: 4, target: 160 })
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState<Beat | null>(null) // beat currently heard
  const [error, setError] = useState<string | null>(null)
  // Screen-reader text for tempo changes the user didn't make (speed-trainer bumps).
  const [announcement, setAnnouncement] = useState('')

  const bpmRef = useRef(bpm) // latest value for callbacks (nudge, tap) without stale closures
  const baseBpm = useRef(bpm) // last tempo the user set; Stop returns to it after a speed-trainer ramp
  const runningRef = useRef(false)
  const toggleId = useRef(0) // identifies the latest toggle; older start() results are ignored
  const pending = useRef<Beat[]>([])
  const tapper = useRef<TapTempo | null>(null)

  const setBpm = useCallback(
    (value: number) => {
      const v = clampBpm(value)
      bpmRef.current = v
      baseBpm.current = v
      setBpmState(v)
      controller.setBpm(v)
    },
    [controller],
  )

  const setBeatsPerBar = useCallback(
    (value: number) => {
      const v = clampBeats(value)
      setBeatsState(v)
      setActive((a) => (a !== null && a.beatInBar >= v ? null : a)) // lit dot no longer exists
      controller.setBeatsPerBar(v)
    },
    [controller],
  )

  const levelOf = useCallback((beat: number): Level => accents[beat] ?? defaultLevel(beat), [accents])

  /** Accent → normal → mute → accent. */
  const cycleAccent = useCallback((beat: number) => {
    setAccents((prev) => {
      // Keep levels beyond beatsPerBar, in case beats per bar grows again.
      const levels = Array.from({ length: Math.max(beat + 1, prev.length) }, (_, i) => prev[i] ?? defaultLevel(i))
      levels[beat] = NEXT_LEVEL[levels[beat]]
      return levels
    })
  }, [])

  const setGap = useCallback((patch: Partial<GapSettings>) => setGapState((g) => ({ ...g, ...patch })), [])
  const setSpeed = useCallback((patch: Partial<SpeedSettings>) => setSpeedState((s) => ({ ...s, ...patch })), [])

  // Push the remaining settings to the engine whenever they change.
  useEffect(() => controller.configure({ subdivision }), [controller, subdivision])
  useEffect(() => controller.configure({ swing: swing / 100 }), [controller, swing])
  useEffect(() => controller.configure({ sound }), [controller, sound])
  useEffect(() => controller.configure({ volume: volume / 100 }), [controller, volume])
  useEffect(() => controller.configure({ accents }), [controller, accents])
  useEffect(
    () => controller.configure({ gap: gap.on ? { play: gap.play, mute: gap.mute } : null }),
    [controller, gap],
  )
  useEffect(
    () =>
      controller.configure({
        speed: speed.on ? { step: speed.step, every: speed.every, target: speed.target } : null,
      }),
    [controller, speed],
  )

  const nudge = useCallback((delta: number) => setBpm(bpmRef.current + delta), [setBpm])

  const tap = useCallback(() => {
    tapper.current ??= new TapTempo()
    const v = tapper.current.tap()
    if (v !== null) setBpm(v)
  }, [setBpm])

  const toggle = useCallback(async () => {
    const id = ++toggleId.current
    if (runningRef.current) {
      runningRef.current = false
      controller.stop()
      pending.current = []
      setRunning(false)
      setActive(null)
      setAnnouncement('')
      if (bpmRef.current !== baseBpm.current) setBpm(baseBpm.current) // undo the speed trainer's ramp
      return
    }
    runningRef.current = true
    pending.current = []
    setRunning(true)
    setError(null)
    try {
      await controller.start()
    } catch (err) {
      if (id !== toggleId.current) return // user already stopped or restarted; not this start's UI
      runningRef.current = false
      setRunning(false)
      setError(`Could not start audio: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [controller, setBpm])

  // Beats arrive slightly ahead of the speakers; light each dot when its sound is heard.
  useEffect(
    () =>
      controller.subscribe((beat) => {
        pending.current.push(beat)
      }),
    [controller],
  )

  useEffect(() => {
    if (!running) return
    let frame = 0
    const poll = () => {
      const now = controller.now()
      if (now !== null) {
        const queue = pending.current
        let last: Beat | undefined
        let bumped = false
        while (queue.length && queue[0].time <= now) {
          last = queue.shift()
          bumped ||= last?.bumped === true
        }
        if (last) {
          setActive(last)
          // Follow the engine's tempo only on a speed-trainer bump: syncing on every beat
          // would let stale queued beats undo the user's own tempo edits.
          if (bumped) {
            bpmRef.current = last.bpm
            setBpmState(last.bpm)
            setAnnouncement(`Tempo ${last.bpm} BPM`)
          }
        }
      }
      frame = requestAnimationFrame(poll)
    }
    frame = requestAnimationFrame(poll)
    return () => cancelAnimationFrame(frame)
  }, [running, controller])

  // Stop the audio if the component goes away while playing.
  useEffect(
    () => () => {
      if (runningRef.current) controller.stop()
    },
    [controller],
  )

  return {
    bpm,
    beatsPerBar,
    subdivision,
    swing,
    sound,
    volume,
    gap,
    speed,
    running,
    activeBeat: active?.beatInBar ?? null,
    activeAudible: active?.audible ?? true,
    error,
    announcement,
    levelOf,
    setBpm,
    setBeatsPerBar,
    setSubdivision,
    setSwing,
    setSound,
    setVolume,
    cycleAccent,
    setGap,
    setSpeed,
    nudge,
    tap,
    toggle,
  }
}
