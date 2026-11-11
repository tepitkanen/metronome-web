# Metronome (web)

A sample-accurate metronome that runs in the browser. The click engine runs in an
AudioWorklet on the audio thread, so the timing never depends on JavaScript timers.

It's a web port of a Python/tkinter desktop metronome, with the same features and
the same engine design.

## Features

- **Tempo** 30–300 BPM: slider, text field, ↑/↓ keys (Shift for ±10), or tap tempo
- **Beats per bar** 1–12, with a beat indicator that lights up in sync with what you hear
- **Accents:** click a beat dot to cycle it between accent, normal and mute
- **Subdivisions:** quarter notes, eighths, triplets or sixteenths, with adjustable swing (50–75%) on eighths
- **Sounds:** Beep, Wood, Hi-hat or Click, plus a volume slider
- **Gap trainer:** plays *n* bars, then mutes *m* bars, so you can check whether you're keeping time on your own
- **Speed trainer:** adds *n* BPM every *m* bars up to a target tempo. Stop returns to the tempo you started from.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Start / stop |
| ↑ / ↓ | Tempo ±1 BPM |
| Shift + ↑ / ↓ | Tempo ±10 BPM |
| T | Tap tempo |

The shortcuts are ignored while you're typing in a field.

## How it works

- **`src/engine/core.ts`:** `MetronomeCore.render()` mixes the click sounds into each
  128-sample audio block at exact sample offsets. It's plain TypeScript with no Web Audio
  dependencies, so it's unit-tested directly, including a long-run drift test.
- **`src/engine/worklet.ts`:** the `AudioWorkletProcessor` that runs the engine on the
  audio thread. It receives settings as messages and reports each beat with its
  AudioContext time.
- **`src/audio/MetronomeController.ts`:** the main-thread side. It owns the
  `AudioContext` and the worklet node.
- **`src/hooks/useMetronome.ts`:** the React state. A dot lights up only once the
  output clock reaches the beat's time, so the visual matches the sound despite
  output latency.

## Development

Requires Node 22.

```sh
npm install
npm run dev        # dev server; open the printed URL
npm test           # Vitest + Testing Library
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm run build      # static site in dist/
```

The build is a static site with no backend, so `dist/` can be hosted anywhere.

Built with Vite, React 19, TypeScript and Tailwind CSS 4.
