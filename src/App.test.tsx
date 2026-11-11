import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { MetronomeLike } from './audio/MetronomeController'
import type { Beat } from './engine/core'

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
  subscribe(listener: (beat: Beat) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  emit(beat: Beat) {
    for (const l of this.listeners) l(beat)
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

const bpmShown = () => screen.getByTestId('bpm-display').textContent
const bpmInput = () => screen.getByRole('textbox', { name: 'BPM' })
const beatsInput = () => screen.getByRole('textbox', { name: 'Beats per bar' })
const dots = () => screen.getAllByTestId('beat-dot')

beforeEach(() => {
  // jsdom has no real animation frames; run them on a short timer instead.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 1))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('App', () => {
  it('starts at 120 BPM in 4/4', () => {
    setup()
    expect(bpmShown()).toBe('120')
    expect(dots()).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('Start/Stop button toggles the controller', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(fake.start).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(fake.stop).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('clicking a button does not move focus to it', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Tap' }))
    expect(document.activeElement).toBe(document.body)
  })

  it('shows an error and stays stopped when audio fails to start', async () => {
    const user = setup()
    fake.start.mockRejectedValueOnce(new Error('no device'))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('no device')
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })
})

describe('keyboard shortcuts', () => {
  it('Space toggles, arrows nudge by 1 or 10 and clamp', async () => {
    const user = setup()
    await user.keyboard(' ')
    expect(fake.start).toHaveBeenCalledOnce()
    await user.keyboard('{ArrowUp}')
    expect(bpmShown()).toBe('121')
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(bpmShown()).toBe('111')
    expect(fake.setBpm).toHaveBeenLastCalledWith(111)
    for (let i = 0; i < 25; i++) await user.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect(bpmShown()).toBe('300')
    await user.keyboard(' ')
    expect(fake.stop).toHaveBeenCalledOnce()
  })

  it('T taps the tempo', async () => {
    const user = setup()
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    await user.keyboard('t')
    now.mockReturnValue(1250)
    await user.keyboard('t')
    expect(bpmShown()).toBe('240')
  })

  it('is ignored while typing in a field', async () => {
    const user = setup()
    await user.click(bpmInput())
    await user.keyboard(' {ArrowUp}t')
    expect(fake.start).not.toHaveBeenCalled()
    expect(bpmShown()).toBe('120')
  })

  it('arrows on the focused slider step once, not twice', async () => {
    const user = setup()
    screen.getByRole('slider', { name: 'Tempo slider' }).focus()
    await user.keyboard('{ArrowUp}')
    expect(bpmShown()).toBe('121')
  })
})

describe('number fields', () => {
  it('applies valid in-range values live, ignoring out-of-range intermediates', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '5')
    expect(bpmShown()).toBe('120') // "5" is below 30: not applied while typing
    await user.type(bpmInput(), '0')
    expect(bpmShown()).toBe('50')
  })

  it('clamps out-of-range values when the field is left', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '5000{Enter}')
    expect(bpmShown()).toBe('300')
    expect(bpmInput()).toHaveValue('300')
    expect(document.activeElement).not.toBe(bpmInput())
  })

  it('reverts invalid text', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), 'abc')
    await user.tab()
    expect(bpmInput()).toHaveValue('120')
    expect(bpmShown()).toBe('120')
  })

  it('beats per bar changes the dots and the engine, clamped to 1–12', async () => {
    const user = setup()
    await user.clear(beatsInput())
    await user.type(beatsInput(), '6{Enter}')
    expect(dots()).toHaveLength(6)
    expect(fake.setBeatsPerBar).toHaveBeenLastCalledWith(6)
    await user.clear(beatsInput())
    await user.type(beatsInput(), '99{Enter}')
    expect(dots()).toHaveLength(12)
  })
})

describe('beat indicator', () => {
  it('lights a dot only once its sound is heard', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    fake.time = 1
    act(() => fake.emit({ beatInBar: 2, time: 5 }))
    await new Promise((r) => setTimeout(r, 20))
    expect(dots().some((d) => d.dataset.lit === 'true')).toBe(false)
    fake.time = 5
    await waitFor(() => expect(dots()[2]).toHaveAttribute('data-lit', 'true'))
  })

  it('clears the lit dot on stop', async () => {
    const user = setup()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 0, time: 1 }))
    await waitFor(() => expect(dots()[0]).toHaveAttribute('data-lit', 'true'))
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(dots().every((d) => d.dataset.lit === 'false')).toBe(true)
  })
})
