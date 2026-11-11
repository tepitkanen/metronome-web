import type { Level } from '../engine/core'
import { keepFocus } from './keepFocus'

interface Props {
  beatsPerBar: number
  activeBeat: number | null
  /** False when the lit beat is inside a muted gap-trainer bar. */
  activeAudible: boolean
  levelOf(beat: number): Level
  onCycle(beat: number): void
}

const IDLE: Record<Level, string> = {
  accent: 'bg-red-200 dark:bg-red-950',
  normal: 'bg-zinc-300 dark:bg-zinc-700',
  mute: 'bg-transparent',
}

/** One dot per beat; the lit dot follows what you hear. Click a dot to cycle accent → normal → mute. */
export function BeatDots({ beatsPerBar, activeBeat, activeAudible, levelOf, onCycle }: Props) {
  return (
    <div className="flex flex-wrap justify-center gap-2" aria-label="Beat indicator">
      {Array.from({ length: beatsPerBar }, (_, i) => {
        const level = levelOf(i)
        const lit = i === activeBeat
        const color = !lit
          ? IDLE[level]
          : !activeAudible || level === 'mute'
            ? 'bg-indigo-200 dark:bg-indigo-400/40' // lit, but makes no sound
            : level === 'accent'
              ? 'bg-red-500'
              : 'bg-blue-500'
        const border = level === 'mute' ? 'border-zinc-400 dark:border-zinc-500' : 'border-transparent'
        return (
          <button
            key={i}
            type="button"
            data-testid="beat-dot"
            data-lit={lit}
            data-level={level}
            aria-label={`Beat ${i + 1}: ${level}`}
            onMouseDown={keepFocus}
            onClick={() => onCycle(i)}
            className={`size-7 rounded-full border-2 transition-colors duration-75 focus:outline-none
              focus-visible:ring-2 focus-visible:ring-blue-500 ${color} ${border}`}
          />
        )
      })}
    </div>
  )
}
