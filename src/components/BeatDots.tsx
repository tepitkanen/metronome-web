interface Props {
  beatsPerBar: number
  activeBeat: number | null
}

/** One dot per beat; the lit dot follows what you hear. Beat 1 is the accent. */
export function BeatDots({ beatsPerBar, activeBeat }: Props) {
  return (
    <div className="flex flex-wrap justify-center gap-2" aria-label="Beat indicator">
      {Array.from({ length: beatsPerBar }, (_, i) => {
        const lit = i === activeBeat
        const accent = i === 0
        const color = lit
          ? accent
            ? 'bg-red-500'
            : 'bg-blue-500'
          : accent
            ? 'bg-red-200 dark:bg-red-950'
            : 'bg-zinc-300 dark:bg-zinc-700'
        return (
          <span
            key={i}
            data-testid="beat-dot"
            data-lit={lit}
            className={`size-7 rounded-full transition-colors duration-75 ${color}`}
          />
        )
      })}
    </div>
  )
}
