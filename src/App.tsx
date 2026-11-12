import type { ReactNode } from 'react'
import type { MetronomeLike } from './audio/MetronomeController'
import { BeatDots } from './components/BeatDots'
import { PercentSlider, Segmented, Switch } from './components/Controls'
import { IntInput } from './components/IntInput'
import { keepFocus } from './components/keepFocus'
import { MAX_SWING, MIN_SWING } from './engine/core'
import { SOUND_NAMES } from './engine/sound'
import { MAX_BPM, MIN_BPM } from './engine/tempo'
import { MAX_BEATS, MIN_BEATS, useMetronome } from './hooks/useMetronome'
import { TEMPO_SLIDER_ATTR, useShortcuts } from './hooks/useShortcuts'

const button =
  'w-28 rounded-lg px-4 py-2 font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

const nudgeButton =
  'size-11 rounded-full bg-zinc-200 text-2xl hover:bg-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-zinc-700 dark:hover:bg-zinc-600'

const SUBDIVISION_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: 'Quarter' },
  { value: 2, label: 'Eighths' },
  { value: 3, label: 'Triplets' },
  { value: 4, label: '16ths' },
]

const SOUND_OPTIONS = SOUND_NAMES.map((name) => ({ value: name, label: name }))

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3">
      <span className="text-sm text-zinc-600 dark:text-zinc-400">{label}</span>
      <div>{children}</div>
    </div>
  )
}

export default function App({ controller }: { controller: MetronomeLike }) {
  const m = useMetronome(controller)
  useShortcuts(m)

  // Live trainer status, from the beat currently heard (like the desktop app's status line).
  const status: string[] = []
  if (m.running && m.activeBeat !== null) {
    if (m.gap.on) status.push(m.activeAudible ? 'Playing' : 'Silent bar')
    if (m.speed.on) status.push(`${m.bpm} → ${m.speed.target} BPM`)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-4 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
      <section className="w-full max-w-md space-y-6 rounded-2xl bg-white p-6 shadow-lg dark:bg-zinc-800/60">
        <h1 className="text-center text-sm font-semibold uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
          Metronome
        </h1>

        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label="Decrease tempo"
            onMouseDown={keepFocus}
            onClick={() => m.nudge(-1)}
            className={nudgeButton}
          >
            −
          </button>
          {/* Not a live region: the slider and field already announce the user's own changes,
              and announcing every step while dragging would flood a screen reader. */}
          <div className="text-center">
            <span className="text-6xl font-bold tabular-nums" data-testid="bpm-display">
              {m.bpm}
            </span>
            <span className="ml-2 text-zinc-500 dark:text-zinc-400">BPM</span>
          </div>
          <button
            type="button"
            aria-label="Increase tempo"
            onMouseDown={keepFocus}
            onClick={() => m.nudge(1)}
            className={nudgeButton}
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={MIN_BPM}
            max={MAX_BPM}
            value={m.bpm}
            onChange={(e) => m.setBpm(Number(e.target.value))}
            aria-label="Tempo slider"
            {...{ [TEMPO_SLIDER_ATTR]: '' }}
            className="w-full accent-blue-500"
          />
          <IntInput label="BPM" value={m.bpm} min={MIN_BPM} max={MAX_BPM} onChange={m.setBpm} />
        </div>

        <Row label="Beats per bar">
          <IntInput
            label="Beats per bar"
            value={m.beatsPerBar}
            min={MIN_BEATS}
            max={MAX_BEATS}
            onChange={m.setBeatsPerBar}
          />
        </Row>

        <BeatDots
          beatsPerBar={m.beatsPerBar}
          activeBeat={m.activeBeat}
          activeAudible={m.activeAudible}
          levelOf={m.levelOf}
          onCycle={m.cycleAccent}
        />

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

        {/* Speed-trainer bumps only: tempo changes the user didn't make themselves. */}
        <p className="sr-only" aria-live="polite" data-testid="tempo-announcement">
          {m.announcement}
        </p>

        {/* Always rendered with a fixed height, so the layout doesn't jump when it fills. */}
        <p data-testid="trainer-status" className="h-5 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {status.join(' · ')}
        </p>

        {m.error && (
          <p role="alert" className="text-center text-sm text-red-600 dark:text-red-400">
            {m.error}
          </p>
        )}

        <div className="space-y-3">
          <Row label="Subdivision">
            <Segmented label="Subdivision" options={SUBDIVISION_OPTIONS} value={m.subdivision} onChange={m.setSubdivision} />
          </Row>
          <Row label="Swing">
            <PercentSlider
              label="Swing"
              value={m.swing}
              min={Math.round(MIN_SWING * 100)}
              max={Math.round(MAX_SWING * 100)}
              onChange={m.setSwing}
              disabled={m.subdivision !== 2}
              describedBy={m.subdivision !== 2 ? 'swing-hint' : undefined}
            />
            {m.subdivision !== 2 && (
              <p id="swing-hint" className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                Eighths only
              </p>
            )}
          </Row>
          <Row label="Sound">
            <Segmented label="Sound" options={SOUND_OPTIONS} value={m.sound} onChange={m.setSound} />
          </Row>
          <Row label="Volume">
            <PercentSlider label="Volume" value={m.volume} min={0} max={100} onChange={m.setVolume} />
          </Row>
        </div>

        <fieldset className="space-y-3 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-700">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Practice
          </legend>
          <div className="flex flex-wrap items-center gap-2">
            <Switch label="Gap trainer" checked={m.gap.on} onChange={(on) => m.setGap({ on })} />
            {/* Dimmed while the trainer is off; still editable, to set it up before switching on. */}
            <div data-off={!m.gap.on} className={`ml-auto flex flex-wrap items-center gap-2 ${m.gap.on ? '' : 'opacity-60'}`}>
              <span>play</span>
              <IntInput label="Gap bars played" value={m.gap.play} min={1} max={16} onChange={(play) => m.setGap({ play })} />
              <span>bars, mute</span>
              <IntInput label="Gap bars muted" value={m.gap.mute} min={1} max={16} onChange={(mute) => m.setGap({ mute })} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Switch label="Speed trainer" checked={m.speed.on} onChange={(on) => m.setSpeed({ on })} />
            <div data-off={!m.speed.on} className={`ml-auto flex flex-wrap items-center gap-2 ${m.speed.on ? '' : 'opacity-60'}`}>
              <span>+</span>
              <IntInput label="Speed step" value={m.speed.step} min={1} max={50} onChange={(step) => m.setSpeed({ step })} />
              <span>BPM every</span>
              <IntInput label="Speed every bars" value={m.speed.every} min={1} max={32} onChange={(every) => m.setSpeed({ every })} />
              <span>bars, up to</span>
              <IntInput
                label="Speed target BPM"
                value={m.speed.target}
                min={MIN_BPM}
                max={MAX_BPM}
                onChange={(target) => m.setSpeed({ target })}
              />
            </div>
          </div>
        </fieldset>

        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          {/* Keyboard hints only where there's likely a keyboard (a hovering pointer). */}
          <span className="hidden [@media(hover:hover)]:block">Space start/stop · ↑/↓ ±1 · Shift+↑/↓ ±10 · T tap</span>
          <span className="block">Click a beat to cycle accent → normal → mute</span>
        </p>
      </section>
    </main>
  )
}
