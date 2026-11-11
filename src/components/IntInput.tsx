import { useState } from 'react'

interface Props {
  label: string
  value: number
  min: number
  max: number
  onChange(value: number): void
  className?: string
}

const parseIntStrict = (text: string): number | null => (/^\s*-?\d+\s*$/.test(text) ? Number(text) : null)

/**
 * Integer field: applied live while the text is a valid in-range number (so typing "5"
 * on the way to "50" doesn't jump the tempo); on blur, Enter or Escape it clamps
 * out-of-range values and reverts invalid text.
 */
export function IntInput({ label, value, min, max, onChange, className = '' }: Props) {
  const [draft, setDraft] = useState<string | null>(null) // null = not editing, show `value`

  const commit = () => {
    if (draft === null) return
    const v = parseIntStrict(draft)
    if (v !== null) onChange(Math.min(max, Math.max(min, v)))
    setDraft(null)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? String(value)}
      onFocus={(e) => {
        setDraft(String(value))
        e.currentTarget.select()
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = parseIntStrict(e.target.value)
        if (v !== null && v >= min && v <= max) onChange(v)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
      className={`w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-center tabular-nums
        focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800 ${className}`}
    />
  )
}
