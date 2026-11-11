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

export interface SoundBank {
  accent: Float32Array
  normal: Float32Array
}

export function beepBank(sampleRate: number): SoundBank {
  return {
    accent: makeClick(1500, sampleRate, { volume: 0.6 }),
    normal: makeClick(1000, sampleRate, { volume: 0.45 }),
  }
}
