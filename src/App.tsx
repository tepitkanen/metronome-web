import type { MouseEvent } from 'react'
import type { MetronomeLike } from './audio/MetronomeController'
import { BeatDots } from './components/BeatDots'
import { IntInput } from './components/IntInput'
import { MAX_BEATS, MIN_BEATS, useMetronome } from './hooks/useMetronome'
import { useShortcuts } from './hooks/useShortcuts'
import { MAX_BPM, MIN_BPM } from './engine/tempo'

// Clicking a button shouldn't move focus to it, or Space would then both press the
// focused button and trigger the Space shortcut. Keyboard (Tab) focus still works.
const keepFocus = (e: MouseEvent) => e.preventDefault()

const button =
  'w-28 rounded-lg px-4 py-2 font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

export default function App({ controller }: { controller: MetronomeLike }) {
  const m = useMetronome(controller)
  useShortcuts(m)

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <section className="w-full max-w-md space-y-6 rounded-2xl bg-white p-6 shadow-lg dark:bg-zinc-800/60">
        <h1 className="text-center text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Metronome
        </h1>

        <div className="text-center">
          <span className="text-6xl font-bold tabular-nums" data-testid="bpm-display">
            {m.bpm}
          </span>
          <span className="ml-2 text-zinc-500">BPM</span>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            value={m.bpm}
            onChange={(e) => m.setBpm(Number(e.target.value))}
            aria-label="Tempo slider"
            className="w-full accent-blue-500"
          />
          <IntInput label="BPM" value={m.bpm} min={MIN_BPM} max={MAX_BPM} onChange={m.setBpm} />
        </div>

        <div className="flex items-center justify-between">
          <span>Beats per bar</span>
          <IntInput
            label="Beats per bar"
            value={m.beatsPerBar}
            min={MIN_BEATS}
            max={MAX_BEATS}
            onChange={m.setBeatsPerBar}
          />
        </div>

        <BeatDots beatsPerBar={m.beatsPerBar} activeBeat={m.activeBeat} />

        <div className="flex justify-center gap-3">
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={() => void m.toggle()}
            className={`${button} ${m.running ? 'bg-zinc-700 text-white hover:bg-zinc-600' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
          >
            {m.running ? 'Stop' : 'Start'}
          </button>
          <button
            type="button"
            onMouseDown={keepFocus}
            onClick={m.tap}
            className={`${button} bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600`}
          >
            Tap
          </button>
        </div>

        {m.error && (
          <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
            {m.error}
          </p>
        )}

        <p className="text-center text-xs text-zinc-500">
          Space start/stop · ↑/↓ ±1 · Shift+↑/↓ ±10 · T tap
        </p>
      </section>
    </main>
  )
}
