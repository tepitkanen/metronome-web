import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { MetronomeLike } from './audio/MetronomeController'
import type { Beat } from './engine/core'

interface Gate {
  resolve(): void
  reject(e: Error): void
}

/** Controller whose start() stays pending until the test releases it. */
class FakeController implements MetronomeLike {
  listeners = new Set<(beat: Beat) => void>()
  time: number | null = null
  gates: Gate[] = []
  hold = false
  start = vi.fn(async () => {
    if (this.hold) {
      await new Promise<void>((resolve, reject) => this.gates.push({ resolve, reject }))
    }
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
let unmount: () => void

function setup() {
  fake = new FakeController()
  const user = userEvent.setup()
  unmount = render(<App controller={fake} />).unmount
  return user
}

const bpmShown = () => screen.getByTestId('bpm-display').textContent
const bpmInput = () => screen.getByRole('textbox', { name: 'BPM' })
const beatsInput = () => screen.getByRole('textbox', { name: 'Beats per bar' })
const dots = () => screen.getAllByTestId('beat-dot')
const lit = () => dots().flatMap((d, i) => (d.dataset.lit === 'true' ? [i] : []))
const startBtn = () => screen.getByRole('button', { name: 'Start' })
const stopBtn = () => screen.getByRole('button', { name: 'Stop' })
const tick = (ms = 20) => act(() => new Promise<void>((r) => setTimeout(r, ms)))

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 1))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('start/stop races', () => {
  it('Stop while start is pending, then start resolving late, leaves the UI stopped', async () => {
    const user = setup()
    fake.hold = true
    await user.click(startBtn())
    expect(stopBtn()).toBeInTheDocument() // optimistic running state
    await user.click(stopBtn())
    expect(fake.stop).toHaveBeenCalledOnce()
    expect(startBtn()).toBeInTheDocument()
    await act(async () => fake.gates[0].resolve())
    expect(startBtn()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(lit()).toEqual([])
  })

  it('a start that fails after the user already pressed Stop shows no error', async () => {
    const user = setup()
    fake.hold = true
    await user.click(startBtn())
    await user.click(stopBtn())
    await act(async () => fake.gates[0].reject(new Error('late failure')))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a stale start failure must not stop a newer, successful start', async () => {
    const user = setup()
    fake.hold = true
    await user.click(startBtn()) // start #1 pending
    await user.click(stopBtn())
    await user.click(startBtn()) // start #2 pending
    expect(fake.start).toHaveBeenCalledTimes(2)
    await act(async () => fake.gates[0].reject(new Error('stale')))
    // start #2 is still wanted by the user and has not failed
    expect(stopBtn()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('stale beats from before a stop do not light dots after a restart', async () => {
    const user = setup()
    await user.click(startBtn())
    fake.time = 100
    act(() => fake.emit({ beatInBar: 1, time: 50 })) // queued but not yet shown
    await user.click(stopBtn())
    fake.hold = true
    await user.click(startBtn()) // restart; its beats have not started yet
    fake.time = 100
    await tick()
    expect(lit()).toEqual([])
    act(() => fake.emit({ beatInBar: 3, time: 120 }))
    await tick()
    expect(lit()).toEqual([])
    await act(async () => fake.gates[0].resolve())
  })

  it('beats emitted while stopped are discarded on the next start', async () => {
    const user = setup()
    act(() => fake.emit({ beatInBar: 2, time: 0.1 }))
    await user.click(startBtn())
    fake.time = 5
    await tick()
    expect(lit()).toEqual([])
  })

  it('unmounting while running stops the audio', async () => {
    const user = setup()
    await user.click(startBtn())
    unmount()
    expect(fake.stop).toHaveBeenCalledOnce()
  })

  it('unmounting while stopped does not call stop', () => {
    setup()
    unmount()
    expect(fake.stop).not.toHaveBeenCalled()
  })

  it('unsubscribes from the controller on unmount', () => {
    setup()
    expect(fake.listeners.size).toBe(1)
    unmount()
    expect(fake.listeners.size).toBe(0)
  })
})

describe('tap tempo', () => {
  it('averages the recent taps when they are within 2 s of each other', async () => {
    const user = setup()
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    await user.keyboard('t')
    now.mockReturnValue(1500)
    await user.keyboard('t')
    expect(bpmShown()).toBe('120')
    now.mockReturnValue(1750)
    await user.keyboard('t')
    expect(bpmShown()).toBe('160') // (1750-1000)/2 = 375 ms
  })

  it('restarts after a pause longer than 2 s: first tap after it does not change the tempo; second uses only new taps', async () => {
    const user = setup()
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    await user.keyboard('t')
    now.mockReturnValue(1500)
    await user.keyboard('t')
    expect(bpmShown()).toBe('120')
    now.mockReturnValue(6000) // > 2 s gap: restart
    await user.keyboard('t')
    expect(bpmShown()).toBe('120')
    now.mockReturnValue(6250)
    await user.keyboard('t')
    expect(bpmShown()).toBe('240')
  })

  it('the Tap button works the same as T', async () => {
    const user = setup()
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)
    await user.click(screen.getByRole('button', { name: 'Tap' }))
    now.mockReturnValue(1000)
    await user.click(screen.getByRole('button', { name: 'Tap' }))
    expect(bpmShown()).toBe('60')
    expect(fake.setBpm).toHaveBeenLastCalledWith(60)
  })
})

describe('beats-per-bar shrinking', () => {
  it('no dot is lit while the lit beat no longer exists', async () => {
    const user = setup()
    await user.click(startBtn())
    await user.clear(beatsInput())
    await user.type(beatsInput(), '8{Enter}')
    fake.time = 10
    act(() => fake.emit({ beatInBar: 6, time: 1 }))
    await waitFor(() => expect(lit()).toEqual([6]))
    await user.clear(beatsInput())
    await user.type(beatsInput(), '3{Enter}')
    expect(dots()).toHaveLength(3)
    expect(lit()).toEqual([])
  })

  it('growing back does not resurrect a stale lit dot', async () => {
    const user = setup()
    await user.click(startBtn())
    await user.clear(beatsInput())
    await user.type(beatsInput(), '8{Enter}')
    fake.time = 10
    act(() => fake.emit({ beatInBar: 6, time: 1 }))
    await waitFor(() => expect(lit()).toEqual([6]))
    await user.clear(beatsInput())
    await user.type(beatsInput(), '3{Enter}')
    await user.clear(beatsInput())
    await user.type(beatsInput(), '8{Enter}')
    expect(lit()).toEqual([])
  })
})

describe('IntInput edge cases', () => {
  it('accepts surrounding whitespace', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '  90  ')
    expect(bpmShown()).toBe('90')
    await user.tab()
    expect(bpmInput()).toHaveValue('90')
  })

  it('whitespace-only text reverts on blur', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '   ')
    await user.tab()
    expect(bpmInput()).toHaveValue('120')
    expect(bpmShown()).toBe('120')
  })

  it('negative numbers clamp to the minimum on blur and are not applied live', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '-5')
    expect(bpmShown()).toBe('120')
    await user.tab()
    expect(bpmShown()).toBe('30')
    expect(bpmInput()).toHaveValue('30')
  })

  it('a lone minus sign reverts', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '-')
    await user.tab()
    expect(bpmInput()).toHaveValue('120')
  })

  it('leading zeros are accepted and normalised', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '0090')
    expect(bpmShown()).toBe('90')
    await user.tab()
    expect(bpmInput()).toHaveValue('90')
  })

  it('decimals and exponent notation are rejected', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '90.5') // "90" was applied live on the way
    await user.tab()
    expect(bpmInput()).toHaveValue('90') // invalid final text reverts to the last applied value
    expect(bpmShown()).toBe('90')
    await user.clear(bpmInput())
    await user.type(bpmInput(), '1e2')
    await user.tab()
    expect(bpmInput()).toHaveValue('90')
    expect(bpmShown()).toBe('90')
  })

  it('Escape leaves the field and clamps out-of-range text (like Enter)', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), '5000{Escape}')
    expect(document.activeElement).not.toBe(bpmInput())
    expect(bpmShown()).toBe('300')
    expect(bpmInput()).toHaveValue('300')
  })

  it('Escape on invalid text reverts', async () => {
    const user = setup()
    await user.clear(bpmInput())
    await user.type(bpmInput(), 'x{Escape}')
    expect(bpmInput()).toHaveValue('120')
  })

  it('Enter with an unchanged value keeps it', async () => {
    const user = setup()
    await user.click(bpmInput())
    await user.keyboard('{Enter}')
    expect(bpmInput()).toHaveValue('120')
    expect(bpmShown()).toBe('120')
  })

  it('shows a changed value prop when not focused', async () => {
    const user = setup()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(bpmInput()).toHaveValue('122')
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect(bpmInput()).toHaveValue('132')
  })

  it('shows the slider value after the slider changes', async () => {
    setup()
    const slider = screen.getByRole('slider', { name: 'Tempo slider' })
    await act(async () => {
      slider.focus()
    })
    await userEvent.keyboard('{ArrowDown}')
    expect(bpmInput()).toHaveValue('119')
  })

  it('a value prop change while focused does not clobber the draft', async () => {
    const user = setup()
    await user.click(bpmInput())
    await user.keyboard('{Backspace}{Backspace}{Backspace}')
    await user.keyboard('7')
    // draft "7" is out of range, value stays 120, draft remains
    expect(bpmInput()).toHaveValue('7')
    act(() => fake.emit({ beatInBar: 0, time: 0 }))
    expect(bpmInput()).toHaveValue('7')
  })

  it('focusing selects the content so typing replaces it', async () => {
    const user = setup()
    await user.click(bpmInput())
    await user.keyboard('80')
    expect(bpmShown()).toBe('80')
  })
})

describe('shortcut modifiers and repeat', () => {
  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])('ignores Space/arrows/T with %o', async (mod) => {
    setup()
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(1000)
    for (const key of [' ', 'ArrowUp', 'ArrowDown', 't', 'T']) {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mod })
      act(() => {
        window.dispatchEvent(ev)
      })
      expect(ev.defaultPrevented).toBe(false)
    }
    now.mockReturnValue(1250)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ...mod }))
    })
    expect(fake.start).not.toHaveBeenCalled()
    expect(bpmShown()).toBe('120')
  })

  it('handled keys call preventDefault, unhandled keys do not', () => {
    setup()
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    const x = new KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true })
    act(() => {
      window.dispatchEvent(space)
      window.dispatchEvent(x)
    })
    expect(space.defaultPrevented).toBe(true)
    expect(x.defaultPrevented).toBe(false)
  })

  it('Shift+Space and Shift+T still work', async () => {
    const user = setup()
    await user.keyboard('{Shift>} {/Shift}')
    expect(fake.start).toHaveBeenCalledOnce()
  })

  it('repeating Space does not toggle again', async () => {
    setup()
    const press = (repeat: boolean) =>
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat, bubbles: true, cancelable: true }))
      })
    press(false)
    press(true)
    press(true)
    expect(fake.start).toHaveBeenCalledOnce()
    expect(fake.stop).not.toHaveBeenCalled()
  })

  it('repeating T does not tap again', () => {
    setup()
    const now = vi.spyOn(performance, 'now')
    const press = (repeat: boolean, t: number) => {
      now.mockReturnValue(t)
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 't', repeat, bubbles: true, cancelable: true }))
      })
    }
    press(false, 1000)
    press(true, 1250)
    press(true, 1500)
    expect(bpmShown()).toBe('120') // only one real tap: no tempo yet
  })

  it('repeating arrows keep nudging', () => {
    setup()
    for (let i = 0; i < 5; i++) {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', repeat: i > 0, bubbles: true }))
      })
    }
    expect(bpmShown()).toBe('125')
  })
})

describe('Space on a keyboard-focused button', () => {
  it('toggles exactly once (the button handles it, the shortcut ignores it)', async () => {
    const user = setup()
    startBtn().focus()
    expect(document.activeElement).toBe(startBtn())
    await user.keyboard(' ')
    expect(fake.start).toHaveBeenCalledTimes(1)
    expect(fake.stop).not.toHaveBeenCalled()
    expect(stopBtn()).toBeInTheDocument()
  })

  it('Space on the focused Tap button taps once and does not toggle', async () => {
    const user = setup()
    const tap = screen.getByRole('button', { name: 'Tap' })
    tap.focus()
    const now = vi.spyOn(performance, 'now')
    now.mockReturnValue(0)
    await user.keyboard(' ')
    now.mockReturnValue(500)
    await user.keyboard(' ')
    expect(fake.start).not.toHaveBeenCalled()
    expect(bpmShown()).toBe('120') // two taps 500 ms apart = 120
    now.mockReturnValue(750)
    await user.keyboard(' ')
    expect(bpmShown()).toBe('160') // (750-0)/2 = 375 ms -> 160
  })

  it('Enter on a focused Start button toggles once', async () => {
    const user = setup()
    startBtn().focus()
    await user.keyboard('{Enter}')
    expect(fake.start).toHaveBeenCalledTimes(1)
  })
})
