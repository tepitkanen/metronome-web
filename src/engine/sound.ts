export interface ClickOptions {
  ms?: number
  volume?: number
  decay?: number
}

/** A short decaying sine burst (mono). */
export function makeClick(
  freq: number,
  sampleRate: number,
  { ms = 30, volume = 0.5, decay = 150 }: ClickOptions = {},
): Float32Array {
  const n = Math.floor((sampleRate * ms) / 1000)
  const out = new Float32Array(n)
  const fadeIn = Math.min(n, Math.max(1, Math.floor(sampleRate / 2000))) // ~0.5 ms, avoids a pop
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    let env = Math.exp(-t * decay)
    if (i < fadeIn) env *= fadeIn === 1 ? 0 : i / (fadeIn - 1)
    out[i] = volume * env * Math.sin(2 * Math.PI * freq * t)
  }
  return out
}

/** Small seeded PRNG (mulberry32), so the noise burst is the same sound every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A decaying burst of bright (high-passed) noise, hi-hat style. */
export function makeNoiseBurst(
  sampleRate: number,
  { ms = 40, volume = 0.5, decay = 120 }: ClickOptions = {},
): Float32Array {
  const n = Math.floor((sampleRate * ms) / 1000)
  const out = new Float32Array(n)
  const rand = seeded(0)
  let prev = 0
  for (let i = 0; i < n; i++) {
    const noise = rand() * 2 - 1
    const bright = (noise - prev) / 2 // first difference = crude high-pass, stays in [-1, 1]
    prev = noise
    out[i] = volume * Math.exp((-i / sampleRate) * decay) * bright
  }
  return out
}

function wood(freq: number, sampleRate: number, volume: number): Float32Array {
  const body = makeClick(freq, sampleRate, { ms: 25, volume: 0.7 * volume, decay: 250 })
  const ring = makeClick(freq * 2.76, sampleRate, { ms: 25, volume: 0.3 * volume, decay: 400 })
  return body.map((x, i) => x + ring[i])
}

/** Click buffers per beat level, plus `sub` for subdivision ticks. */
export interface SoundBank {
  accent: Float32Array
  normal: Float32Array
  sub: Float32Array
}

export const SOUNDS = {
  Beep: (sr: number): SoundBank => ({
    accent: makeClick(1500, sr, { volume: 0.6 }),
    normal: makeClick(1000, sr, { volume: 0.45 }),
    sub: makeClick(1000, sr, { volume: 0.2 }),
  }),
  Wood: (sr: number): SoundBank => ({
    accent: wood(1100, sr, 0.7),
    normal: wood(800, sr, 0.55),
    sub: wood(800, sr, 0.25),
  }),
  'Hi-hat': (sr: number): SoundBank => ({
    accent: makeNoiseBurst(sr, { ms: 60, volume: 0.6, decay: 70 }),
    normal: makeNoiseBurst(sr, { volume: 0.45 }),
    sub: makeNoiseBurst(sr, { ms: 25, volume: 0.25, decay: 200 }),
  }),
  Click: (sr: number): SoundBank => ({
    accent: makeClick(3500, sr, { ms: 4, volume: 0.7, decay: 900 }),
    normal: makeClick(2500, sr, { ms: 4, volume: 0.55, decay: 900 }),
    sub: makeClick(2500, sr, { ms: 3, volume: 0.25, decay: 900 }),
  }),
} satisfies Record<string, (sampleRate: number) => SoundBank>

export type SoundName = keyof typeof SOUNDS
export const SOUND_NAMES = Object.keys(SOUNDS) as SoundName[]

export const isSoundName = (v: unknown): v is SoundName => typeof v === 'string' && Object.hasOwn(SOUNDS, v)
