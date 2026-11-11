// Edge cases for the UI side of the new features: focus/keyboard interplay, late bumps, trainer fields.
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { MetronomeLike } from './audio/MetronomeController'
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
  last<K extends keyof Settings>(key: K): Settings[K] | undefined {
    const calls = this.configure.mock.calls.filter(([p]) => key in p)
    return calls.at(-1)?.[0][key] as Settings[K] | undefined
  }
}

let fake: FakeController

function setup() {
  fake = new FakeController()
  const user = userEvent.setup()
  const view = render(<App controller={fake} />)
  return { user, view }
}

const dots = () => screen.getAllByTestId('beat-dot')
const levels = () => dots().map((d) => d.dataset.level)
const lit = () => dots().map((d) => d.dataset.lit)
const bpmShown = () => screen.getByTestId('bpm-display').textContent
const btn = (name: string) => screen.getByRole('button', { name })
const sw = (name: string) => screen.getByRole('switch', { name })
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

describe('keyboard with the new controls focused', () => {
  it('Space on a keyboard-focused subdivision button activates it and does not toggle playback', async () => {
    const { user } = setup()
    btn('Triplets').focus()
    await user.keyboard(' ')
    expect(fake.last('subdivision')).toBe(3)
    expect(fake.start).not.toHaveBeenCalled()
  })

  it('Space on a keyboard-focused switch flips it and does not toggle playback', async () => {
    const { user } = setup()
    sw('Gap trainer').focus()
    await user.keyboard(' ')
    expect(sw('Gap trainer')).toHaveAttribute('aria-checked', 'true')
    expect(fake.start).not.toHaveBeenCalled()
    await user.keyboard(' ')
    expect(sw('Gap trainer')).toHaveAttribute('aria-checked', 'false')
  })

  it('Enter on a focused sound button selects it', async () => {
    const { user } = setup()
    btn('Click').focus()
    await user.keyboard('{Enter}')
    expect(fake.last('sound')).toBe('Click')
  })

  it('Tab reaches segmented buttons and Space then selects and keeps working', async () => {
    const { user } = setup()
    await user.tab()
    expect(document.activeElement).not.toBe(document.body)
    // walk to the 16ths button
    for (let i = 0; i < 40 && document.activeElement !== btn('16ths'); i++) await user.tab()
    expect(document.activeElement).toBe(btn('16ths'))
    await user.keyboard(' ')
    expect(fake.last('subdivision')).toBe(4)
    expect(btn('16ths')).toHaveAttribute('aria-pressed', 'true')
    expect(fake.start).not.toHaveBeenCalled()
  })

  it('arrow keys on a focused switch or segmented button do not change the tempo', async () => {
    const { user } = setup()
    sw('Speed trainer').focus()
    await user.keyboard('{ArrowUp}{ArrowDown}t')
    btn('Wood').focus()
    await user.keyboard('{ArrowUp}{Shift>}{ArrowUp}{/Shift}')
    expect(bpmShown()).toBe('120')
    expect(fake.setBpm).not.toHaveBeenCalled()
  })

  it('arrows on the focused Volume slider are left to the slider, not the tempo', async () => {
    setup()
    const vol = slider('Volume')
    vol.focus()
    const notPrevented = fireEvent.keyDown(vol, { key: 'ArrowUp' })
    expect(notPrevented).toBe(true) // native slider stepping (not simulated by jsdom)
    fireEvent.keyDown(vol, { key: 'ArrowDown', shiftKey: true })
    expect(bpmShown()).toBe('120')
  })

  it('arrows on the enabled Swing slider are left to the slider, not the tempo', async () => {
    const { user } = setup()
    await user.click(btn('Eighths'))
    const sl = slider('Swing')
    sl.focus()
    expect(fireEvent.keyDown(sl, { key: 'ArrowUp' })).toBe(true)
    expect(bpmShown()).toBe('120')
  })

  it('arrows on the focused tempo slider still nudge the tempo, and are prevented', () => {
    setup()
    const tempo = slider('Tempo slider')
    tempo.focus()
    expect(fireEvent.keyDown(tempo, { key: 'ArrowUp' })).toBe(false)
    expect(bpmShown()).toBe('121')
  })

  it('Space with a slider focused toggles playback', async () => {
    const { user } = setup()
    slider('Volume').focus()
    await user.keyboard(' ')
    expect(fake.start).toHaveBeenCalledOnce()
  })

  it('typing in a trainer field does not trigger shortcuts', async () => {
    const { user } = setup()
    await user.click(sw('Speed trainer'))
    const step = field('Speed step')
    await user.click(step)
    await user.keyboard('t {ArrowUp}')
    expect(fake.start).not.toHaveBeenCalled()
    expect(bpmShown()).toBe('120')
  })

  it('a disabled Swing slider cannot take focus, so the shortcuts keep working', async () => {
    const { user } = setup()
    await user.click(slider('Swing')) // disabled: click does nothing
    await user.keyboard(' ')
    expect(fake.start).toHaveBeenCalledOnce()
  })
})

describe('late and odd beats', () => {
  it('a bump that arrives after Stop does not change the tempo or light a dot after a restart', async () => {
    const { user } = setup()
    await user.click(btn('Start'))
    await user.click(btn('Stop'))
    act(() => fake.emit({ beatInBar: 2, time: 1, bpm: 135, bumped: true }))
    expect(bpmShown()).toBe('120')
    await user.click(btn('Start'))
    fake.time = 10
    await tick()
    expect(bpmShown()).toBe('120')
    expect(lit()).toEqual(['false', 'false', 'false', 'false'])
  })

  it('a bump delivered while stopped is not shown, even if the context time is huge', async () => {
    setup()
    act(() => fake.emit({ beatInBar: 0, time: 0, bpm: 150, bumped: true }))
    fake.time = 100
    await tick()
    expect(bpmShown()).toBe('120')
  })

  it('several queued beats in one poll end on the last one and keep the bumped tempo', async () => {
    const { user } = setup()
    await user.click(btn('Start'))
    fake.time = 10
    act(() => {
      fake.emit({ beatInBar: 3, time: 1, bpm: 120 })
      fake.emit({ beatInBar: 0, time: 2, bpm: 125, bumped: true })
      fake.emit({ beatInBar: 1, time: 3, bpm: 125 })
    })
    await tick()
    expect(bpmShown()).toBe('125')
    expect(lit()).toEqual(['false', 'true', 'false', 'false'])
  })

  it('a future beat is not lit or applied until the heard time reaches it', async () => {
    const { user } = setup()
    await user.click(btn('Start'))
    fake.time = 1
    act(() => fake.emit({ beatInBar: 1, time: 5, bpm: 130, bumped: true }))
    await tick()
    expect(bpmShown()).toBe('120')
    expect(lit()).toEqual(['false', 'false', 'false', 'false'])
    fake.time = 5
    await tick()
    expect(bpmShown()).toBe('130')
    expect(lit()[1]).toBe('true')
  })

  it('after a bump the user can set a new tempo and Stop keeps it', async () => {
    const { user } = setup()
    await user.click(btn('Start'))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 0, time: 1, bpm: 130, bumped: true }))
    await tick()
    await user.click(field('BPM'))
    await user.clear(field('BPM'))
    await user.type(field('BPM'), '90{Enter}')
    await user.click(btn('Stop'))
    expect(bpmShown()).toBe('90')
  })

  it('unmounting while running stops the controller', async () => {
    const { user, view } = setup()
    await user.click(btn('Start'))
    view.unmount()
    expect(fake.stop).toHaveBeenCalled()
  })

  it('changing settings while running neither restarts nor stops playback', async () => {
    const { user } = setup()
    await user.click(btn('Start'))
    await user.click(btn('Eighths'))
    await user.click(btn('Hi-hat'))
    await user.click(sw('Gap trainer'))
    await user.click(dots()[1])
    expect(fake.start).toHaveBeenCalledOnce()
    expect(fake.stop).not.toHaveBeenCalled()
    expect(btn('Stop')).toBeInTheDocument()
  })
})

describe('accent grid edges', () => {
  it('three clicks return a dot to its original level and send the full array', async () => {
    const { user } = setup()
    for (let i = 0; i < 3; i++) await user.click(dots()[2])
    expect(levels()).toEqual(['accent', 'normal', 'normal', 'normal'])
    expect(fake.last('accents')).toEqual(['accent', 'normal', 'normal'])
  })

  it('clicking the last of twelve dots works and levels of hidden beats survive a shrink', async () => {
    const { user } = setup()
    const beats = field('Beats per bar')
    await user.clear(beats)
    await user.type(beats, '12{Enter}')
    expect(dots()).toHaveLength(12)
    await user.click(dots()[11])
    expect(levels()[11]).toBe('mute')
    await user.clear(beats)
    await user.type(beats, '1{Enter}')
    expect(dots()).toHaveLength(1)
    expect(fake.setBeatsPerBar).toHaveBeenLastCalledWith(1)
    await user.clear(beats)
    await user.type(beats, '12{Enter}')
    expect(levels()[11]).toBe('mute')
  })

  it('the lit dot disappears when the bar shrinks below it and the muted level is shown', async () => {
    const { user } = setup()
    await user.click(btn('Start'))
    fake.time = 10
    act(() => fake.emit({ beatInBar: 3, time: 1 }))
    await tick()
    expect(lit()[3]).toBe('true')
    const beats = field('Beats per bar')
    await user.clear(beats)
    await user.type(beats, '2{Enter}')
    expect(lit()).toEqual(['false', 'false'])
  })

  it('muting the downbeat is allowed and shown', async () => {
    const { user } = setup()
    await user.click(dots()[0]) // accent -> normal
    await user.click(dots()[0]) // normal -> mute
    expect(levels()[0]).toBe('mute')
    expect(fake.last('accents')?.[0]).toBe('mute')
  })
})

describe('trainer fields', () => {
  it('editing fields while a trainer is off does not enable it', async () => {
    const { user } = setup()
    await user.clear(field('Gap bars played'))
    await user.type(field('Gap bars played'), '5{Enter}')
    await user.clear(field('Speed every bars'))
    await user.type(field('Speed every bars'), '8{Enter}')
    expect(fake.last('gap')).toBeNull()
    expect(fake.last('speed')).toBeNull()
    await user.click(sw('Gap trainer'))
    await user.click(sw('Speed trainer'))
    expect(fake.last('gap')).toEqual({ play: 5, mute: 2 })
    expect(fake.last('speed')).toEqual({ step: 5, every: 8, target: 160 })
  })

  it('out-of-range values clamp to the limits on Enter', async () => {
    const { user } = setup()
    await user.click(sw('Gap trainer'))
    await user.click(sw('Speed trainer'))
    const cases: [string, string, string][] = [
      ['Gap bars played', '99', '16'],
      ['Gap bars muted', '0', '1'],
      ['Speed every bars', '100', '32'],
      ['Speed target BPM', '999', '300'],
      ['Speed target BPM', '5', '30'],
      ['Speed step', '0', '1'],
    ]
    for (const [name, typed, shown] of cases) {
      await user.clear(field(name))
      await user.type(field(name), `${typed}{Enter}`)
      expect(field(name)).toHaveValue(shown)
    }
    expect(fake.last('gap')).toEqual({ play: 16, mute: 1 })
    expect(fake.last('speed')).toEqual({ step: 1, every: 32, target: 30 })
  })

  it('invalid text reverts on blur without sending anything new', async () => {
    const { user } = setup()
    await user.click(sw('Speed trainer'))
    const before = fake.configure.mock.calls.length
    await user.clear(field('Speed step'))
    await user.type(field('Speed step'), 'abc')
    await user.tab()
    expect(field('Speed step')).toHaveValue('5')
    expect(fake.configure.mock.calls.length).toBe(before)
  })

  it('a speed target below the current tempo is accepted and sent', async () => {
    const { user } = setup()
    await user.click(sw('Speed trainer'))
    await user.clear(field('Speed target BPM'))
    await user.type(field('Speed target BPM'), '60{Enter}')
    expect(fake.last('speed')).toEqual({ step: 5, every: 4, target: 60 })
  })
})

describe('sliders', () => {
  it('swing keeps its value when switching away from eighths and back', async () => {
    const { user } = setup()
    await user.click(btn('Eighths'))
    fireEvent.change(slider('Swing'), { target: { value: '70' } })
    await user.click(btn('Quarter'))
    expect(slider('Swing')).toBeDisabled()
    expect(screen.getByText('70%')).toBeInTheDocument()
    await user.click(btn('Eighths'))
    expect(slider('Swing')).toHaveValue('70')
  })

  it('swing slider is limited to 50..75 and volume 0..100', () => {
    setup()
    expect(slider('Swing')).toHaveAttribute('min', '50')
    expect(slider('Swing')).toHaveAttribute('max', '75')
    expect(slider('Volume')).toHaveAttribute('min', '0')
    expect(slider('Volume')).toHaveAttribute('max', '100')
  })

  it('volume 0 is sent as exactly 0', () => {
    setup()
    fireEvent.change(slider('Volume'), { target: { value: '0' } })
    expect(fake.last('volume')).toBe(0)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('every segmented group has exactly one pressed button', async () => {
    const { user } = setup()
    await user.click(btn('Click'))
    await user.click(btn('16ths'))
    for (const group of ['Subdivision', 'Sound']) {
      const pressed = screen
        .getByRole('group', { name: group })
        .querySelectorAll('button[aria-pressed="true"]')
      expect(pressed).toHaveLength(1)
    }
  })
})
