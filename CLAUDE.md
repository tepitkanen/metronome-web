# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Web version of the desktop metronome in `E:\koodit\Python\metronome` (Python/tkinter). Vite 8 + React 19 + TypeScript 7 + Tailwind 4, with oxlint for linting and Vitest + Testing Library (jsdom) for tests. It's a static app with no backend. Windows, Node 22.

## Commands
```powershell
npm install
npm run dev          # dev server
npm test             # all tests (vitest run)
npx vitest run src/engine/core.test.ts -t "drift"   # one file / one test by name
npm run test:watch
npm run lint         # oxlint
npm run typecheck    # tsc -b
npm run build        # tsc -b && vite build → dist/ (includes dist/assets/worklet-*.js)
```

## Architecture
Timing is sample-accurate and must stay that way. Never schedule clicks with `setTimeout`, `setInterval` or `requestAnimationFrame`.

- **`src/engine/core.ts`, `MetronomeCore.render(out, startTime)`:** a port of the Python `engine.py`. It mixes click buffers into each audio block at exact sample offsets, using a float `beatStart`. Each beat is split into `subdivision` ticks (1–4) at `beatStart + beatInterval * frac`, where `frac` is `tick/sub`, or `swing` for the offbeat eighth. `startBeat()` runs on each beat's first tick: it latches `beatInterval` (so a BPM change applies from the next beat), advances `bar` and applies the gap and speed trainers. `tails` holds clicks that cross a block boundary. Output is scaled by `volume` and clipped to [-1, 1]. It is pure apart from its own state, so it's unit-tested directly (`core.test.ts`, which includes a long-run drift test at 128-frame blocks, and `core.features.test.ts`).
  - All settings come in through `apply(patch)`, which ignores fields of the wrong type, and copies arrays so the sender can't mutate them later.
  - Levels are `'accent' | 'normal' | 'mute'`, per beat in `accents`; missing beats use `defaultLevel()` (beat 0 accented). A muted beat also silences its subdivisions. `sound.ts` holds the `SOUNDS` banks (`accent`, `normal`, `sub` buffers each).
- **`src/engine/worklet.ts`:** the `AudioWorkletProcessor` that runs `MetronomeCore` on the audio thread.
  - It must only import from `src/engine/`, and must never be imported by main-thread code: it calls `registerProcessor` at load.
  - Initial settings arrive in `processorOptions`; later changes arrive as `port` messages holding a `Partial<Settings>` patch. Both go through `core.apply()`.
  - It posts `Beat[]` (`{ beatInBar, time, level, audible, bpm, bumped }`, with `time` in AudioContext seconds) back to the main thread.
  - `main.tsx` imports it as `./engine/worklet.ts?worker&url`. Vite bundles it into a separate self-contained file. AudioWorklet scope globals (`sampleRate`, `currentTime`, `registerProcessor`) are declared at the top of the file.
- **`src/audio/MetronomeController.ts`:** the main-thread side.
  - The `AudioContext` is created and resumed inside the Start click, as the autoplay policy requires.
  - It creates one `AudioWorkletNode` per Start, so the engine resets each time, and disconnects it on Stop, then suspends the context.
  - `startToken` cancels a start that's still loading when Stop is pressed.
  - `configure(patch)` (and its `setBpm`/`setBeatsPerBar` shorthands) remembers settings for the next Start's node and posts the patch to the current one.
  - `now()` returns `getOutputTimestamp().contextTime`, which is what's being heard.
- **`MetronomeLike`:** the interface the UI depends on. `App` receives the controller as a prop, created in `main.tsx`, so tests pass a fake and never touch Web Audio or the `?worker&url` import.
- **`src/hooks/useMetronome.ts`:** owns the React state.
  - Beats from the controller wait in a ref queue. A `requestAnimationFrame` loop lights a dot once `controller.now()` reaches the beat's `time`, so the visual matches the sound despite output latency.
  - The other settings are pushed to `controller.configure()` by one effect each.
  - The BPM display follows the engine only when a beat has `bumped` set by the speed trainer; syncing on every beat would let stale queued beats undo the user's own edits. `baseBpm` is the last tempo the user set, and Stop returns to it after a ramp.
  - BPM and beats-per-bar limits come from `engine/tempo.ts` (`clampBpm`, 30–300) and `clampBeats` (1–12).
- **`src/hooks/useShortcuts.ts`:** one window `keydown` listener for Space, ↑/↓ (Shift ×10) and T.
  - It ignores keys while a text field, textarea, select or button has focus.
  - Range sliders are the exception: Space and T still work on them. On the tempo slider (marked with `data-tempo-slider`) the shortcut also handles the arrow keys and calls `preventDefault`, so the slider doesn't also step natively. The swing and volume sliders keep their own arrow keys.
  - Buttons call `preventDefault` on `onMouseDown` (`components/keepFocus.ts`), so clicking them doesn't move focus. Otherwise Space would press the focused button *and* toggle. That's why subdivision and sound are segmented buttons and the trainers are switch buttons (`components/Controls.tsx`), not `<select>`s or checkboxes.
- **`src/components/IntInput.tsx`:** a text input (not `type=number`) that applies values live while they're valid and in range. On blur, Enter or Escape it clamps the value, or reverts invalid text. This mirrors the Python app's `IntField`.

## Tests
- `src/test/setup.ts` loads jest-dom and runs `cleanup` after each test, because Vitest globals are off.
- `App.test.tsx` stubs `requestAnimationFrame` with a timer, because jsdom has no animation frames.
- The worklet itself can only run in a real browser. To check it, load the built `dist/assets/worklet-*.js` into an `OfflineAudioContext`, served over http, and inspect the rendered buffer.
