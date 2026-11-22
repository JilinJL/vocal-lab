/**
 * YIN fundamental frequency estimator tuned for human singing voice.
 * Uses Cumulative Mean Normalized Difference Function (CMNDF) + parabolic interpolation
 * to avoid octave errors and achieve ~1-cent pitch accuracy.
 */
export interface YinDetectionResult {
  frequency: number | null
  clarity: number
  rms: number
}

export interface YinOptions {
  minFrequency?: number
  maxFrequency?: number
  threshold?: number
  rmsThreshold?: number
}

export function detectPitchYin(
  buffer: Float32Array,
  sampleRate: number,
  options: YinOptions = {},
): YinDetectionResult {
  const minFrequency = options.minFrequency ?? 65 // ~C2
  const maxFrequency = options.maxFrequency ?? 1200 // ~D6
  const threshold = options.threshold ?? 0.14
  const rmsThreshold = options.rmsThreshold ?? 0.009

  const n = buffer.length
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    const v = buffer[i]!
    sumSq += v * v
  }
  const rms = Math.sqrt(sumSq / n)

  if (rms < rmsThreshold) {
    return { frequency: null, clarity: 0, rms }
  }

  const halfN = Math.floor(n / 2)
  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency))
  const maxTau = Math.min(halfN - 1, Math.ceil(sampleRate / minFrequency))

  if (maxTau <= minTau) {
    return { frequency: null, clarity: 0, rms }
  }

  // Step 1 & 2: Difference function d(tau) and Cumulative Mean Normalized Difference Function d'(tau)
  const yinBuffer = new Float32Array(maxTau + 1)
  yinBuffer[0] = 1

  let runningSum = 0
  for (let tau = 1; tau <= maxTau; tau++) {
    let diffSum = 0
    // Integrate over halfN samples for steady energy
    for (let i = 0; i < halfN; i++) {
      const delta = buffer[i]! - buffer[i + tau]!
      diffSum += delta * delta
    }
    runningSum += diffSum
    yinBuffer[tau] = runningSum > 0 ? (diffSum * tau) / runningSum : 1
  }

  // Step 3: Absolute threshold search within vocal lag range
  let tauEstimate = -1
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (yinBuffer[tau]! < threshold) {
      while (tau + 1 <= maxTau && yinBuffer[tau + 1]! < yinBuffer[tau]!) {
        tau++
      }
      tauEstimate = tau
      break
    }
  }

  // Fallback: global minimum if still fairly periodic (helps soft breathy singing)
  if (tauEstimate === -1) {
    let minVal = Infinity
    let minIdx = -1
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (yinBuffer[tau]! < minVal) {
        minVal = yinBuffer[tau]!
        minIdx = tau
      }
    }
    if (minIdx !== -1 && minVal < 0.24) {
      tauEstimate = minIdx
    } else {
      return { frequency: null, clarity: 0, rms }
    }
  }

  // Step 4: Parabolic interpolation for sub-sample precision
  let betterTau = tauEstimate
  if (tauEstimate > 1 && tauEstimate < maxTau) {
    const s0 = yinBuffer[tauEstimate - 1]!
    const s1 = yinBuffer[tauEstimate]!
    const s2 = yinBuffer[tauEstimate + 1]!
    const denom = 2 * s1 - s2 - s0
    if (Math.abs(denom) > 1e-8) {
      const adjustment = (s2 - s0) / (2 * denom)
      if (Math.abs(adjustment) < 1) {
        betterTau = tauEstimate + adjustment
      }
    }
  }

  const frequency = sampleRate / betterTau
  const clarity = Math.max(0, Math.min(1, 1 - yinBuffer[tauEstimate]!))

  if (frequency < minFrequency || frequency > maxFrequency) {
    return { frequency: null, clarity: 0, rms }
  }

  return { frequency, clarity, rms }
}
