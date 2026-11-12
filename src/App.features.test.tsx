// Accent grid, subdivision/swing, sound, volume and the practice trainers in the UI.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { MetronomeLike } from './audio/MetronomeController'
import { HEIGHT } from './components/beatHeights'
import type { Beat, Settings } from './engine/core'

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
  /** Latest value sent for one setting key. */
  last<K extends keyof Settings>(key: K): Settings[K] | undefined {
    const calls = this.configure.mock.calls.filter(([p]) => key in p)
    return calls.at(-1)?.[0][key] as Settings[K] | undefined
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
const levels = () => dots().map((d) => d.dataset.level)
const bpmShown = () => screen.getByTestId('bpm-display').textContent
const btn = (name: string) => screen.getByRole('button', { name })
const field = (name: string) => screen.getByRole('textbox', { name })
const slider = (name: string) => screen.getByRole('slider', { name })
const tick = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)))

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 1))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('accent grid', () => {
  it('clicking a dot cycles accent → normal → mute → accent', async () => {
    const user = setup()
    expect(levels()).toEqual(['accent', 'normal', 'normal', 'normal'])
    await user.click(dots()[1])
    expect(levels()[1]).toBe('mute')
    expect(fake.last('accents')).toEqual(['accent', 'mute'])
    await user.click(dots()[1])
    expect(levels()[1]).toBe('accent')
    await user.click(dots()[0])
    expect(levels()).toEqual(['normal', 'accent', 'normal', 'normal'])
    expect(fake.last('accents')).toEqual(['normal', 'accent'])
  })

  it('clicking a dot does not move focus', async () => {
    const user = setup()
    await user.click(dots()[2])
    expect(document.activeElement).toBe(document.body)
  })

  it('levels survive beats per bar shrinking and growing again', async () => {
    const user = setup()
    await user.click(dots()[3]) // normal → mute
    const beats = field('Beats per bar')
    await user.clear(beats)
    await user.type(beats, '2{Enter}')
    expect(dots()).toHaveLength(2)
    await user.clear(beats)
    await user.type(beats, '4{Enter}')
    expect(levels()).toEqual(['accent', 'normal', 'normal', 'mute'])
  })

  it('a lit beat in a gap bar or a muted beat is shown as silent', async () => {
    const user = setup()
    await user.click(btn('Start'))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 0, time: 1, audible: false }))
    await tick()
    expect(dots()[0].dataset.lit).toBe('true')
    const bar = (i: number) => within(dots()[i]).getByTestId('beat-bar')
    expect(bar(0).className).toMatch(/bg-indigo-200/)
    act(() => fake.emit({ beatInBar: 1, time: 2 }))
    await tick()
    expect(bar(1).className).toMatch(/bg-blue-500/)
  })

  it('bar height shows the level, so it is not colour-only', async () => {
    const user = setup()
    const bar = (i: number) => within(dots()[i]).getByTestId('beat-bar')
    expect(bar(0)).toHaveClass(HEIGHT.accent)
    expect(bar(1)).toHaveClass(HEIGHT.normal)
    await user.click(dots()[1]) // normal → mute
    expect(bar(1)).toHaveClass(HEIGHT.mute)
    expect(new Set(Object.values(HEIGHT)).size).toBe(3) // three distinct heights
  })
})

describe('tempo buttons', () => {
  it('− and + nudge the tempo by 1 without taking focus', async () => {
    const user = setup()
    await user.click(btn('Increase tempo'))
    expect(bpmShown()).toBe('121')
    await user.click(btn('Decrease tempo'))
    await user.click(btn('Decrease tempo'))
    expect(bpmShown()).toBe('119')
    expect(fake.setBpm).toHaveBeenLastCalledWith(119)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('subdivision, swing, sound, volume', () => {
  it('sends the defaults on mount', () => {
    setup()
    expect(fake.last('subdivision')).toBe(1)
    expect(fake.last('swing')).toBe(0.5)
    expect(fake.last('sound')).toBe('Beep')
    expect(fake.last('volume')).toBe(1)
    expect(fake.last('gap')).toBeNull()
    expect(fake.last('speed')).toBeNull()
  })

  it('subdivision buttons set the engine, and swing is enabled only for eighths', async () => {
    const user = setup()
    expect(slider('Swing')).toBeDisabled()
    await user.click(btn('Eighths'))
    expect(fake.last('subdivision')).toBe(2)
    expect(btn('Eighths')).toHaveAttribute('aria-pressed', 'true')
    expect(btn('Quarter')).toHaveAttribute('aria-pressed', 'false')
    expect(slider('Swing')).toBeEnabled()
    await user.click(btn('Triplets'))
    expect(fake.last('subdivision')).toBe(3)
    expect(slider('Swing')).toBeDisabled()
  })

  it('explains why swing is disabled', async () => {
    const user = setup()
    expect(screen.getByText('Eighths only')).toBeInTheDocument()
    await user.click(btn('Eighths'))
    expect(screen.queryByText('Eighths only')).not.toBeInTheDocument()
  })

  it('swing and volume sliders send fractions and show percentages', () => {
    setup()
    fireEvent.change(slider('Swing'), { target: { value: '66' } })
    expect(fake.last('swing')).toBeCloseTo(0.66)
    expect(screen.getByText('66%')).toBeInTheDocument()
    fireEvent.change(slider('Volume'), { target: { value: '40' } })
    expect(fake.last('volume')).toBeCloseTo(0.4)
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('sound buttons select the sound', async () => {
    const user = setup()
    await user.click(btn('Hi-hat'))
    expect(fake.last('sound')).toBe('Hi-hat')
    expect(btn('Hi-hat')).toHaveAttribute('aria-pressed', 'true')
  })

  it('Space still toggles after clicking a subdivision or sound button', async () => {
    const user = setup()
    await user.click(btn('16ths'))
    await user.click(btn('Wood'))
    await user.keyboard(' ')
    expect(fake.start).toHaveBeenCalledOnce()
  })
})

describe('practice trainers', () => {
  it('apply only while switched on, and keep their values when switched off', async () => {
    const user = setup()
    await user.click(screen.getByRole('switch', { name: 'Gap trainer' }))
    expect(fake.last('gap')).toEqual({ play: 2, mute: 2 })
    await user.clear(field('Gap bars muted'))
    await user.type(field('Gap bars muted'), '3')
    expect(fake.last('gap')).toEqual({ play: 2, mute: 3 }) // live while on
    await user.click(screen.getByRole('switch', { name: 'Gap trainer' }))
    expect(fake.last('gap')).toBeNull()
    await user.click(screen.getByRole('switch', { name: 'Gap trainer' }))
    expect(fake.last('gap')).toEqual({ play: 2, mute: 3 })

    await user.click(screen.getByRole('switch', { name: 'Speed trainer' }))
    expect(fake.last('speed')).toEqual({ step: 5, every: 4, target: 160 })
    expect(screen.getByRole('switch', { name: 'Speed trainer' })).toHaveAttribute('aria-checked', 'true')
  })

  it('trainer fields clamp on commit', async () => {
    const user = setup()
    await user.click(screen.getByRole('switch', { name: 'Speed trainer' }))
    await user.clear(field('Speed step'))
    await user.type(field('Speed step'), '99{Enter}')
    expect(field('Speed step')).toHaveValue('50')
    expect(fake.last('speed')).toMatchObject({ step: 50 })
  })

  it('the status line shows trainer progress only while running', async () => {
    const user = setup()
    const status = () => screen.getByTestId('trainer-status').textContent
    await user.click(screen.getByRole('switch', { name: 'Gap trainer' }))
    await user.click(screen.getByRole('switch', { name: 'Speed trainer' }))
    expect(status()).toBe('')
    await user.click(btn('Start'))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 0, time: 1 }))
    await tick()
    expect(status()).toBe('Playing · 120 → 160 BPM')
    act(() => fake.emit({ beatInBar: 0, time: 2, audible: false, bpm: 125, bumped: true }))
    await tick()
    expect(status()).toBe('Silent bar · 125 → 160 BPM')
    await user.click(btn('Stop'))
    expect(status()).toBe('')
  })
})

describe('speed trainer tempo display', () => {
  async function startWithBump() {
    const user = setup()
    await user.click(btn('Start'))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 0, time: 1, bpm: 125, bumped: true }))
    await tick()
    return user
  }

  it('a bump updates the shown BPM without sending it back', async () => {
    await startWithBump()
    expect(bpmShown()).toBe('125')
    expect(fake.setBpm).not.toHaveBeenCalled()
  })

  it('a stale beat without a bump does not override the user tempo', async () => {
    const user = setup()
    await user.click(btn('Start'))
    await user.keyboard('{ArrowUp}')
    fake.time = 10
    act(() => fake.emit({ beatInBar: 0, time: 1, bpm: 120 }))
    await tick()
    expect(bpmShown()).toBe('121')
  })

  it('Stop restores the tempo from before the ramp', async () => {
    const user = await startWithBump()
    await user.click(btn('Stop'))
    expect(bpmShown()).toBe('120')
    expect(fake.setBpm).toHaveBeenLastCalledWith(120)
  })

  it('a tempo change during the ramp becomes the new base', async () => {
    const user = await startWithBump()
    await user.keyboard('{ArrowUp}') // 125 + 1
    expect(fake.setBpm).toHaveBeenLastCalledWith(126)
    await user.click(btn('Stop'))
    expect(bpmShown()).toBe('126')
  })

  it('Stop without a ramp leaves the tempo alone', async () => {
    const user = setup()
    await user.click(btn('Start'))
    await user.click(btn('Stop'))
    expect(fake.setBpm).not.toHaveBeenCalled()
    expect(bpmShown()).toBe('120')
  })
})
