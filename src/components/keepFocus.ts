import type { MouseEvent } from 'react'

// Clicking a button shouldn't move focus to it, or Space would then both press the
// focused button and trigger the Space shortcut. Keyboard (Tab) focus still works.
export const keepFocus = (e: MouseEvent) => e.preventDefault()
