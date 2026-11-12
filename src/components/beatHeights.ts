import type { Level } from '../engine/core'

/** Bar height per level, so the level is readable from height, not only colour (like the desktop app). */
export const HEIGHT: Record<Level, string> = {
  accent: 'h-12',
  normal: 'h-8',
  mute: 'h-4',
}
