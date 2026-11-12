import type { Level } from '../engine/core'
import { HEIGHT } from './beatHeights'
import { keepFocus } from './keepFocus'

interface Props {
  beatsPerBar: number
  activeBeat: number | null
  /** False when the lit beat is inside a muted gap-trainer bar. */
  activeAudible: boolean
  levelOf(beat: number): Level
  onCycle(beat: number): void
}

// Idle colours keep at least 3:1 contrast against the card in both themes.
const IDLE: Record<Level, string> = {
  accent: 'bg-red-800 dark:bg-red-600',
  normal: 'bg-zinc-500',
  mute: 'bg-transparent',
}


/** One bar per beat; the lit bar follows what you hear. Click a bar to cycle accent → normal → mute. */
export function BeatDots({ beatsPerBar, activeBeat, activeAudible, levelOf, onCycle }: Props) {
  return (
    <div role="group" className="flex flex-wrap justify-center gap-2" aria-label="Beat indicator">
      {Array.from({ length: beatsPerBar }, (_, i) => {
        const level = levelOf(i)
        const lit = i === activeBeat
        const color = !lit
          ? IDLE[level]
          : !activeAudible || level === 'mute'
            ? 'bg-indigo-200 dark:bg-indigo-400/40' // lit, but makes no sound
            : level === 'accent'
              ? 'bg-red-500 dark:bg-red-400'
              : 'bg-blue-500 dark:bg-blue-400'
        const border = level === 'mute' ? 'border-zinc-500 dark:border-zinc-400' : 'border-transparent'
        // Outline as a second, non-colour cue for the lit beat.
        const outline = lit ? 'outline-2 outline-offset-2 outline-zinc-900 dark:outline-white' : ''
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
            className="flex h-12 w-10 items-end rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span
              data-testid="beat-bar"
              className={`w-full rounded-md border-2 transition-colors duration-75 ${HEIGHT[level]} ${color} ${border} ${outline}`}
            />
          </button>
        )
      })}
    </div>
  )
}
