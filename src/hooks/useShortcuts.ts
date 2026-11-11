import { useEffect, useRef } from 'react'

export interface ShortcutActions {
  toggle(): void
  nudge(delta: number): void
  tap(): void
}

/** True when the key should go to the focused element instead (typing, or a focused button). */
function belongsToTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLInputElement) return target.type !== 'range' // sliders: we handle arrows
  // A keyboard-focused button activates itself on Space/Enter; don't toggle as well.
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement
}

/** Space start/stop, ↑/↓ ±1 BPM, Shift+↑/↓ ±10, T tap. Ignored while typing in a field. */
export function useShortcuts(actions: ShortcutActions): void {
  const latest = useRef(actions)
  useEffect(() => {
    latest.current = actions
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || belongsToTarget(e.target)) return
      const a = latest.current
      switch (e.key) {
        case ' ':
          if (e.repeat) break
          a.toggle()
          break
        case 'ArrowUp':
          a.nudge(e.shiftKey ? 10 : 1)
          break
        case 'ArrowDown':
          a.nudge(e.shiftKey ? -10 : -1)
          break
        case 't':
        case 'T':
          if (e.repeat) break
          a.tap()
          break
        default:
          return
      }
      e.preventDefault() // no page scroll on Space/arrows, no native slider step on top of ours
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
