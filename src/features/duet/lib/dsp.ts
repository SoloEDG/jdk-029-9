// Small, dependency-free DSP helpers shared by the capture analysis and tests.

export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice()
  const length = Math.max(1, Math.round(input.length * toRate / fromRate))
  const output = new Float32Array(length)
  const step = fromRate / toRate
  for (let index = 0; index < length; index++) {
    const position = index * step
    const first = Math.floor(position)
    const fraction = position - first
    const a = input[first] ?? 0
    const b = input[first + 1] ?? a
    output[index] = a + (b - a) * fraction
  }
  return output
}

/** Box-filter decimation. Harmonics above the new Nyquist fold down when you
 *  sample naively, so a short moving average runs first. */
export function downsample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return resampleLinear(input, fromRate, toRate)
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.floor(input.length / ratio))
  const window = Math.max(1, Math.round(ratio))
  const filtered = new Float32Array(input.length)
  let sum = 0
  for (let index = 0; index < input.length; index++) {
    sum += input[index]
    if (index >= window) sum -= input[index - window]
    filtered[index] = sum / Math.min(window, index + 1)
  }
  const output = new Float32Array(length)
  const step = fromRate / toRate
  for (let index = 0; index < length; index++) {
    const position = index * step
    const first = Math.floor(position)
    const fraction = position - first
    const a = filtered[Math.min(first, filtered.length - 1)]
    const b = filtered[Math.min(first + 1, filtered.length - 1)]
    output[index] = a + (b - a) * fraction
  }
  return output
}

export function rms(samples: Float32Array, start = 0, length = samples.length): number {
  const first = Math.max(0, start)
  const last = Math.min(samples.length, start + length)
  if (last <= first) return 0
  let sum = 0
  for (let index = first; index < last; index++) sum += samples[index] * samples[index]
  return Math.sqrt(sum / (last - first))
}

export function dbfs(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-9))
}

export function percentile(values: readonly number[], fraction: number): number {
  if (!values.length) return -90
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
  return sorted[index]
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12)
}

const HARMONIC_WEIGHTS = [1, 0.45, 0.22, 0.1] as const

/** Normalised resource for a known note: harmonic energy / frame energy. */
export function noteAffinity(samples: Float32Array, rate: number, midi: number): number {
  const energy = rms(samples)
  if (energy < 1e-5) return 0
  const fundamental = midiToHz(midi)
  let sum = 0
  let weights = 0
  for (let order = 1; order <= HARMONIC_WEIGHTS.length; order++) {
    const frequency = fundamental * order
    if (frequency >= rate * 0.45) break
    const amplitude = goertzelAmp(samples, rate, frequency)
    sum += HARMONIC_WEIGHTS[order - 1] * amplitude * amplitude
    weights += HARMONIC_WEIGHTS[order - 1]
  }
  return weights > 0 ? sum / (energy * energy * weights) : 0
}

/** Normalised Goertzel amplitude: ~= A for a sinusoid of amplitude A. */
export function goertzelAmp(samples: Float32Array, rate: number, frequency: number): number {
  if (frequency <= 0 || frequency >= rate / 2) return 0
  const omega = 2 * Math.PI * frequency / rate
  const coefficient = 2 * Math.cos(omega)
  let first = 0
  let second = 0
  for (let index = 0; index < samples.length; index++) {
    const current = samples[index] + coefficient * first - second
    second = first
    first = current
  }
  const power = first * first + second * second - coefficient * first * second
  return Math.sqrt(Math.max(0, power)) * 2 / samples.length
}

/**
 * Pitch via the first strong autocorrelation peak.
 *
 * A voice's harmonic series correlates almost as well at 2T as at T, so the
 * naive "highest correlation" pick lands an octave low.  We therefore take the
 * first local maximum that is nearly as good as the global one.
 */
export function autocorrelationPitch(
  samples: Float32Array, rate: number, lowMidi = 55, highMidi = 90,
): { midi: number; clarity: number } | null {
  const energy = rms(samples)
  if (energy < 1e-4) return null
  const minLag = Math.max(2, Math.floor(rate / midiToHz(highMidi)))
  const maxLag = Math.min(samples.length - 2, Math.ceil(rate / midiToHz(lowMidi)))
  if (maxLag <= minLag) return null
  // Keep the accumulated norms so normalisation does not cost a second pass.
  const correlations = new Float32Array(maxLag + 2)
  const norms = new Float64Array(samples.length + 1)
  for (let index = 0; index < samples.length; index++) norms[index + 1] = norms[index] + samples[index] * samples[index]
  let best = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0
    for (let index = 0; index + lag < samples.length; index++) dot += samples[index] * samples[index + lag]
    const energyA = norms[samples.length - lag]
    const energyB = norms[samples.length] - norms[lag]
    const value = energyA > 0 && energyB > 0 ? dot / Math.sqrt(energyA * energyB) : 0
    correlations[lag] = value
    if (value > best) best = value
  }
  if (best < 0.35) return null
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (
      correlations[lag] >= best * 0.92
      && correlations[lag] >= correlations[lag - 1]
      && correlations[lag] >= correlations[lag + 1]
    ) {
      return { midi: 69 + 12 * Math.log2(rate / lag / 440), clarity: correlations[lag] }
    }
  }
  let bestLag = minLag
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (correlations[lag] === best) { bestLag = lag; break }
  }
  return { midi: 69 + 12 * Math.log2(rate / bestLag / 440), clarity: best }
}

/** Peak envelope for drawing raw audio. */
export function waveformPeaks(samples: Float32Array, bins = 320): number[] {
  if (!samples.length || bins <= 0) return []
  const size = Math.max(1, Math.floor(samples.length / bins))
  const peaks: number[] = []
  for (let bin = 0; bin < bins; bin++) {
    const first = bin * size
    const last = Math.min(samples.length, first + size)
    let peak = 0
    for (let index = first; index < last; index++) peak = Math.max(peak, Math.abs(samples[index]))
    peaks.push(peak)
  }
  return peaks
}

/**
 * Score-guided pitch: how well does the frame match each candidate note?
 *
 * This is the primitive the evidence analysis needs.  It is not a general
 * pitch detector — it answers "is candidate X sounding?" — which is exactly the
 * question one can answer from a known duet score.  Returns `{midi:null}` when
 * no candidate is supported well enough to call.
 */
export function directPitch(
  samples: Float32Array, rate: number, candidates: readonly number[],
): { midi: number | null; score: number } {
  if (!candidates.length) return { midi: null, score: 0 }
  let bestMidi: number | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    const score = noteAffinity(samples, rate, candidate)
    if (score > bestScore) { bestScore = score; bestMidi = candidate }
  }
  return bestScore >= 0.3 ? { midi: bestMidi, score: bestScore } : { midi: null, score: bestScore }
}

/** Linear-interpolation read of a mono buffer at an arbitrary time. */
export function readAt(samples: Float32Array, rate: number, seconds: number): number {
  const position = seconds * rate
  const first = Math.floor(position)
  if (first < 0 || first + 1 >= samples.length) return 0
  const fraction = position - first
  return samples[first] + (samples[first + 1] - samples[first]) * fraction
}
