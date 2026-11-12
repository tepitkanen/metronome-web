// Edge cases for the UI/UX pass: tempo buttons, trainer status line, swing hint, beat bar heights.
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { MetronomeLike } from './audio/MetronomeController'
import { HEIGHT } from './components/beatHeights'
import type { Beat, Level, Settings } from './engine/core'

class FakeController implements MetronomeLike {
  listeners = new Set<(beat: Beat) => void>()
  time: number | null = null
  start = vi.fn(async () => {
    this.time = 0
  })
  stop = vi.fn(() => {
    this.time = null
  })
  setBpm = vi.fn()
  setBeatsPerBar = vi.fn()
  configure = vi.fn((_patch: Partial<Settings>) => {})
  subscribe(listener: (beat: Beat) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  emit(beat: Pick<Beat, 'beatInBar' | 'time'> & Partial<Beat>) {
    const full: Beat = { level: 'normal', audible: true, bpm: 120, bumped: false, ...beat }
    for (const l of this.listeners) l(full)
  }
  now() {
    return this.time
  }
}

let fake: FakeController

function setup() {
  fake = new FakeController()
  const user = userEvent.setup()
  render(<App controller={fake} />)
  return user
}

const dots = () => screen.getAllByTestId('beat-dot')
const bpmShown = () => screen.getByTestId('bpm-display').textContent
const status = () => screen.getByTestId('trainer-status').textContent
const btn = (name: string) => screen.getByRole('button', { name })
const field = (name: string) => screen.getByRole('textbox', { name })
const sw = (name: string) => screen.getByRole('switch', { name })
// The level's height class, looked up from BeatDots' own map rather than hard-coded here.
const height = (i: number) => {
  const cls = within(dots()[i]).getByTestId('beat-bar').classList
  return (Object.keys(HEIGHT) as Level[]).find((level) => cls.contains(HEIGHT[level]))
}
const tick = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)))

async function startAndBeat(user: ReturnType<typeof setup>, beat: Partial<Beat> = {}) {
  await user.click(btn('Start'))
  fake.time = 10
  act(() => fake.emit({ beatInBar: 0, time: 1, ...beat }))
  await tick()
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 1))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('tempo buttons: limits and focus', () => {
  it('+ stops at 300 and − stops at 30', async () => {
    const user = setup()
    const input = field('BPM')
    await user.clear(input)
    await user.type(input, '300{Enter}')
    await user.click(btn('Increase tempo'))
    expect(bpmShown()).toBe('300')
    expect(fake.setBpm).toHaveBeenLastCalledWith(300)
    await user.clear(input)
    await user.type(input, '30{Enter}')
    await user.click(btn('Decrease tempo'))
    expect(bpmShown()).toBe('30')
    expect(fake.setBpm).toHaveBeenLastCalledWith(30)
  })

  it('repeated clicks accumulate without losing steps', async () => {
    const user = setup()
    for (let i = 0; i < 10; i++) await user.click(btn('Increase tempo'))
    expect(bpmShown()).toBe('130')
  })

  it('Space after −/+ toggles exactly once', async () => {
    const user = setup()
    await user.click(btn('Increase tempo'))
    await user.keyboard(' ')
    expect(fake.start).toHaveBeenCalledTimes(1)
    expect(fake.stop).not.toHaveBeenCalled()
    await user.click(btn('Decrease tempo'))
    await user.keyboard(' ')
    expect(fake.stop).toHaveBeenCalledTimes(1)
    expect(fake.start).toHaveBeenCalledTimes(1)
  })

  it('arrow keys still work after clicking −/+', async () => {
    const user = setup()
    await user.click(btn('Increase tempo'))
    await user.keyboard('{ArrowUp}')
    expect(bpmShown()).toBe('122')
  })

  it('only speed-trainer bumps are announced, not the user’s own tempo changes', async () => {
    const user = setup()
    const announced = () => screen.getByTestId('tempo-announcement')
    expect(announced()).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByTestId('bpm-display').closest('[aria-live]')).toBeNull()
    await user.click(btn('Increase tempo'))
    await user.keyboard('{ArrowUp}')
    expect(announced().textContent).toBe('')
    await user.click(sw('Speed trainer'))
    await startAndBeat(user, { bpm: 127, bumped: true })
    expect(announced().textContent).toBe('Tempo 127 BPM')
    act(() => fake.emit({ beatInBar: 1, time: 2, bpm: 127 }))
    await tick()
    expect(announced().textContent).toBe('Tempo 127 BPM') // plain beats don't re-announce
    await user.click(btn('Stop'))
    expect(announced().textContent).toBe('')
  })

  it('nudging during a speed-trainer ramp makes that the base Stop returns to', async () => {
    const user = setup()
    await user.click(sw('Speed trainer'))
    await startAndBeat(user, { bpm: 130, bumped: true })
    expect(bpmShown()).toBe('130')
    await user.click(btn('Increase tempo'))
    expect(bpmShown()).toBe('131')
    await user.click(btn('Stop'))
    expect(bpmShown()).toBe('131')
    expect(fake.setBpm).toHaveBeenLastCalledWith(131)
  })

  it('Stop after a ramp with no nudge returns to the original tempo', async () => {
    const user = setup()
    await user.click(sw('Speed trainer'))
    await startAndBeat(user, { bpm: 135, bumped: true })
    await user.click(btn('Stop'))
    expect(bpmShown()).toBe('120')
  })
})

describe('trainer status line', () => {
  it('gap trainer only', async () => {
    const user = setup()
    await user.click(sw('Gap trainer'))
    await startAndBeat(user)
    expect(status()).toBe('Playing')
    act(() => fake.emit({ beatInBar: 1, time: 2, audible: false }))
    await tick()
    expect(status()).toBe('Silent bar')
  })

  it('speed trainer only', async () => {
    const user = setup()
    await user.click(sw('Speed trainer'))
    await startAndBeat(user)
    expect(status()).toBe('120 → 160 BPM')
  })

  it('is empty with no trainer on, even while a beat is lit', async () => {
    const user = setup()
    await startAndBeat(user)
    expect(status()).toBe('')
  })

  it('is empty before the first beat arrives', async () => {
    const user = setup()
    await user.click(sw('Gap trainer'))
    await user.click(btn('Start'))
    expect(status()).toBe('')
  })

  it('updates when trainers are toggled while running', async () => {
    const user = setup()
    await startAndBeat(user)
    expect(status()).toBe('')
    await user.click(sw('Gap trainer'))
    expect(status()).toBe('Playing')
    await user.click(sw('Speed trainer'))
    expect(status()).toBe('Playing · 120 → 160 BPM')
    await user.click(sw('Gap trainer'))
    expect(status()).toBe('120 → 160 BPM')
    await user.click(sw('Speed trainer'))
    expect(status()).toBe('')
  })

  it('shows the new target when the target field changes', async () => {
    const user = setup()
    await user.click(sw('Speed trainer'))
    await startAndBeat(user)
    await user.clear(field('Speed target BPM'))
    await user.type(field('Speed target BPM'), '200{Enter}')
    expect(status()).toBe('120 → 200 BPM')
  })

  it('shows the user nudged tempo while running', async () => {
    const user = setup()
    await user.click(sw('Speed trainer'))
    await startAndBeat(user)
    await user.click(btn('Increase tempo'))
    expect(status()).toBe('121 → 160 BPM')
  })

  it('clears when beats per bar shrinks below the lit beat', async () => {
    const user = setup()
    await user.click(sw('Gap trainer'))
    await user.click(sw('Speed trainer'))
    await user.click(btn('Start'))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 3, time: 1 }))
    await tick()
    expect(status()).toBe('Playing · 120 → 160 BPM')
    const beats = field('Beats per bar')
    await user.clear(beats)
    await user.type(beats, '2{Enter}')
    expect(dots()).toHaveLength(2)
    expect(dots().every((d) => d.dataset.lit === 'false')).toBe(true)
    expect(status()).toBe('')
  })

  it('stays empty after a failed start', async () => {
    const user = setup()
    await user.click(sw('Gap trainer'))
    fake.start.mockRejectedValueOnce(new Error('no audio'))
    await user.click(btn('Start'))
    expect(screen.getByRole('alert')).toHaveTextContent('no audio')
    expect(btn('Start')).toBeInTheDocument()
    expect(status()).toBe('')
  })

  it('does not show stale beats after Stop then Start again', async () => {
    const user = setup()
    await user.click(sw('Gap trainer'))
    await startAndBeat(user)
    await user.click(btn('Stop'))
    await user.click(btn('Start'))
    expect(status()).toBe('')
  })
})

describe('trainer field dimming', () => {
  it('dims fields only while the trainer is off', async () => {
    const user = setup()
    const wrap = (name: string) => field(name).closest('[data-off="true"]')
    expect(wrap('Gap bars played')).not.toBeNull()
    expect(wrap('Speed step')).not.toBeNull()
    await user.click(sw('Gap trainer'))
    expect(wrap('Gap bars played')).toBeNull()
    expect(wrap('Speed step')).not.toBeNull()
    await user.click(sw('Speed trainer'))
    expect(wrap('Speed step')).toBeNull()
  })

  it('dimmed fields remain editable', async () => {
    const user = setup()
    await user.clear(field('Gap bars played'))
    await user.type(field('Gap bars played'), '5{Enter}')
    expect(field('Gap bars played')).toHaveValue('5')
  })
})

describe('swing hint', () => {
  it.each([
    ['Quarter', true],
    ['Eighths', false],
    ['Triplets', true],
    ['16ths', true],
  ])('%s: hint shown = %s', async (label, hint) => {
    const user = setup()
    await user.click(btn(label))
    const swing = screen.getByRole('slider', { name: 'Swing' })
    if (hint) {
      expect(swing).toHaveAccessibleDescription('Eighths only')
    } else {
      expect(screen.queryByText('Eighths only')).not.toBeInTheDocument()
      expect(swing).not.toHaveAttribute('aria-describedby')
    }
  })

  it('hint returns when going from eighths back to another subdivision', async () => {
    const user = setup()
    await user.click(btn('Eighths'))
    await user.click(btn('16ths'))
    expect(screen.getByText('Eighths only')).toBeInTheDocument()
  })
})

describe('beat bars', () => {
  it('heights follow the level through a full cycle on every beat', async () => {
    const user = setup()
    // beat 0 starts accent, beat 1 starts normal
    const expected0 = ['accent', 'normal', 'mute', 'accent']
    const expected1 = ['normal', 'mute', 'accent', 'normal']
    expect(height(0)).toBe(expected0[0])
    expect(height(1)).toBe(expected1[0])
    for (let step = 1; step < 4; step++) {
      await user.click(dots()[0])
      await user.click(dots()[1])
      expect(height(0)).toBe(expected0[step])
      expect(height(1)).toBe(expected1[step])
    }
  })

  it('muted bar is outlined, others are not', async () => {
    const user = setup()
    await user.click(dots()[1]) // normal → mute
    const cls = (i: number) => within(dots()[i]).getByTestId('beat-bar').className
    expect(cls(1)).toMatch(/border-zinc-500/)
    expect(cls(1)).toMatch(/bg-transparent/)
    expect(cls(0)).toMatch(/border-transparent/)
  })

  it('heights are preserved for a beat that reappears after beats per bar changes', async () => {
    const user = setup()
    await user.click(dots()[3]) // normal → mute
    await user.click(dots()[3]) // mute → accent
    expect(height(3)).toBe('accent')
    const beats = field('Beats per bar')
    await user.clear(beats)
    await user.type(beats, '2{Enter}')
    expect(dots()).toHaveLength(2)
    await user.clear(beats)
    await user.type(beats, '6{Enter}')
    expect([0, 1, 2, 3, 4, 5].map(height)).toEqual(['accent', 'normal', 'normal', 'accent', 'normal', 'normal'])
  })

  it('growing past the accents array uses defaults, 1 beat per bar works', async () => {
    const user = setup()
    const beats = field('Beats per bar')
    await user.clear(beats)
    await user.type(beats, '1{Enter}')
    expect(dots()).toHaveLength(1)
    expect(height(0)).toBe('accent')
    await user.clear(beats)
    await user.type(beats, '12{Enter}')
    expect(dots()).toHaveLength(12)
    expect(height(11)).toBe('normal')
  })

  it('lit bar keeps its height and gains an outline; level height unaffected', async () => {
    const user = setup()
    await startAndBeat(user)
    const bar = within(dots()[0]).getByTestId('beat-bar')
    expect(bar.className).toMatch(/outline-2/)
    expect(height(0)).toBe('accent')
    expect(within(dots()[1]).getByTestId('beat-bar').className).not.toMatch(/outline-2/)
  })

  it('a lit muted beat keeps the mute height and gets the silent colour', async () => {
    const user = setup()
    await user.click(dots()[1]) // mute
    await user.click(btn('Start'))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 1, time: 1, level: 'mute', audible: false }))
    await tick()
    const bar = within(dots()[1]).getByTestId('beat-bar')
    expect(height(1)).toBe('mute')
    expect(bar.className).toMatch(/bg-indigo-200/)
  })

  it('group has an accessible name and each button is labelled with its level', () => {
    setup()
    expect(screen.getByRole('group', { name: 'Beat indicator' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beat 1: accent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beat 2: normal' })).toBeInTheDocument()
  })
})
