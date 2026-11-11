import { keepFocus } from './keepFocus'

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500'

interface SegmentedProps<T extends string | number> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange(value: NoInfer<T>): void
}

/** A row of mutually exclusive buttons (used instead of <select>, which would keep focus). */
export function Segmented<T extends string | number>({ label, options, value, onChange }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex overflow-hidden rounded-lg bg-zinc-200 p-0.5 dark:bg-zinc-700">
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onMouseDown={keepFocus}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-md px-2 py-1 text-sm ${focusRing} ${
              selected ? 'bg-white shadow-sm dark:bg-zinc-500' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  onChange(value: number): void
  disabled?: boolean
}

/** Range slider with its value shown as a percentage. */
export function PercentSlider({ label, value, min, max, onChange, disabled = false }: SliderProps) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full accent-blue-500 disabled:opacity-40"
      />
      <span className={`w-12 text-right text-sm tabular-nums ${disabled ? 'text-zinc-400' : ''}`}>{value}%</span>
    </div>
  )
}

interface SwitchProps {
  label: string
  checked: boolean
  onChange(checked: boolean): void
}

/** On/off switch (a button, so clicking it doesn't take focus away from the shortcuts). */
export function Switch({ label, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onMouseDown={keepFocus}
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-md text-sm font-medium ${focusRing}`}
    >
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`}
        />
      </span>
      {label}
    </button>
  )
}
