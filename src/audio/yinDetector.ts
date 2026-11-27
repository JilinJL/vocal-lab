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
  prevFrequency?: number | null
}

function findMinInRange(buf: Float32Array, start: number, end: number): { idx: number; val: number } {
  let minVal = Infinity
  let minIdx = -1
  for (let tau = start; tau <= end; tau++) {
    const v = buf[tau]!
    if (v < minVal) {
      minVal = v
      minIdx = tau
    }
  }
  return { idx: minIdx, val: minVal }
}

export function detectPitchYin(
  buffer: Float32Array,
  sampleRate: number,
  options: YinOptions = {},
): YinDetectionResult {
  const minFrequency = options.minFrequency ?? 65 // ~C2
  const maxFrequency = options.maxFrequency ?? 1200 // ~D6
  const threshold = options.threshold ?? 0.16
  const rmsThreshold = options.rmsThreshold ?? 0.0045
  const prevFrequency = options.prevFrequency ?? null

  const n = buffer.length
  if (n < 256 || sampleRate <= 0) {
    return { frequency: null, clarity: 0, rms: 0 }
  }

  // Step 0: Remove DC offset and apply gentle 45 Hz high-pass filter to reject breath pop & rumble
  let mean = 0
  for (let i = 0; i < n; i++) {
    mean += buffer[i]!
  }
  mean /= n

  const filtered = new Float32Array(n)
  const rc = 1 / (2 * Math.PI * 45)
  const dt = 1 / sampleRate
  const hpAlpha = rc / (rc + dt)
  let prevIn = buffer[0]! - mean
  let prevOut = 0
  let sumSq = 0

  for (let i = 0; i < n; i++) {
    const centered = buffer[i]! - mean
    const out = hpAlpha * (prevOut + centered - prevIn)
    prevIn = centered
    prevOut = out
    filtered[i] = out
    sumSq += out * out
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
      const delta = filtered[i]! - filtered[i + tau]!
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
    const globalMin = findMinInRange(yinBuffer, minTau, maxTau)
    if (globalMin.idx !== -1 && globalMin.val < 0.35) {
      tauEstimate = globalMin.idx
    } else {
      return { frequency: null, clarity: 0, rms }
    }
  }

  // Step 3b: Octave-up guard — if 2*tau (an octave lower) is significantly deeper, avoid 2nd-harmonic lock
  const currVal = yinBuffer[tauEstimate]!
  if (currVal > 0.06) {
    const doubleLo = Math.round(tauEstimate * 1.92)
    const doubleHi = Math.min(maxTau, Math.round(tauEstimate * 2.08))
    if (doubleLo <= maxTau && doubleHi >= doubleLo) {
      const subDip = findMinInRange(yinBuffer, doubleLo, doubleHi)
      if (subDip.idx !== -1 && subDip.val < currVal * 0.65 && currVal - subDip.val > 0.04) {
        tauEstimate = subDip.idx
      }
    }
  }

  // Step 3c: Continuity preference against octave flip-flopping when previous pitch is known
  if (prevFrequency !== null && Number.isFinite(prevFrequency) && prevFrequency >= minFrequency && prevFrequency <= maxFrequency) {
    const prevTau = sampleRate / prevFrequency
    const ratio = tauEstimate / prevTau
    const isOctaveFlip = Math.abs(ratio - 0.5) < 0.09 || Math.abs(ratio - 2.0) < 0.18
    if (isOctaveFlip) {
      const nearLo = Math.max(minTau, Math.floor(prevTau * 0.88))
      const nearHi = Math.min(maxTau, Math.ceil(prevTau * 1.12))
      if (nearHi >= nearLo) {
        const nearDip = findMinInRange(yinBuffer, nearLo, nearHi)
        if (nearDip.idx !== -1 && nearDip.val < 0.25 && nearDip.val <= yinBuffer[tauEstimate]! + 0.09) {
          tauEstimate = nearDip.idx
        }
      }
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
