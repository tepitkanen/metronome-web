import { useCallback, useEffect, useRef, useState } from 'react'
import type { MetronomeLike } from '../audio/MetronomeController'
import type { Beat } from '../engine/core'
import { TapTempo, clampBpm } from '../engine/tempo'

export const MIN_BEATS = 1
export const MAX_BEATS = 12

export function clampBeats(n: number): number {
  if (Number.isNaN(n)) return MIN_BEATS
  return Math.round(Math.min(MAX_BEATS, Math.max(MIN_BEATS, n)))
}

/** React state for the metronome, wired to the audio controller. */
export function useMetronome(controller: MetronomeLike) {
  const [bpm, setBpmState] = useState(120)
  const [beatsPerBar, setBeatsState] = useState(4)
  const [running, setRunning] = useState(false)
  const [activeBeat, setActiveBeat] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const bpmRef = useRef(bpm) // latest value for callbacks (nudge, tap) without stale closures
  const runningRef = useRef(false)
  const pending = useRef<Beat[]>([])
  const tapper = useRef<TapTempo | null>(null)

  const setBpm = useCallback(
    (value: number) => {
      const v = clampBpm(value)
      bpmRef.current = v
      setBpmState(v)
      controller.setBpm(v)
    },
    [controller],
  )

  const setBeatsPerBar = useCallback(
    (value: number) => {
      const v = clampBeats(value)
      setBeatsState(v)
      controller.setBeatsPerBar(v)
    },
    [controller],
  )

  const nudge = useCallback((delta: number) => setBpm(bpmRef.current + delta), [setBpm])

  const tap = useCallback(() => {
    tapper.current ??= new TapTempo()
    const v = tapper.current.tap()
    if (v !== null) setBpm(v)
  }, [setBpm])

  const toggle = useCallback(async () => {
    if (runningRef.current) {
      runningRef.current = false
      controller.stop()
      pending.current = []
      setRunning(false)
      setActiveBeat(null)
      return
    }
    runningRef.current = true
    pending.current = []
    setRunning(true)
    setError(null)
    try {
      await controller.start()
    } catch (err) {
      runningRef.current = false
      setRunning(false)
      setError(`Could not start audio: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [controller])

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
        while (queue.length && queue[0].time <= now) last = queue.shift()
        if (last) setActiveBeat(last.beatInBar)
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

  return { bpm, beatsPerBar, running, activeBeat, error, setBpm, setBeatsPerBar, nudge, tap, toggle }
}
