import { frequencyToMidi, midiToFrequency } from './pitchMath'

export interface StabilizerOptions {
  enterClarity?: number
  holdClarity?: number
  coastRmsMin?: number
  maxCoastFrames?: number
  maxCoastGapSec?: number
  resetSilenceFrames?: number
  leapThresholdSemitones?: number
  leapConfirmFrames?: number
  medianWindowSize?: number
}

export interface StabilizedPitch {
  time: number
  midi: number | null
  frequency: number | null
  clarity: number
  rms: number
  coasted: boolean
}

interface PendingLeap {
  meanMidi: number
  count: number
}

function computeMedian(values: number[]): number {
  const len = values.length
  if (len === 0) return 0
  if (len === 1) return values[0]!
  if (len === 2) return (values[0]! + values[1]!) * 0.5
  const sorted = [...values].sort((a, b) => a - b)
  const mid = len >> 1
  return len % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) * 0.5
}

/**
 * Unified pitch tracker & stabilizer shared across Live Monitor, Practice, and Song modes.
 * Combines Schmitt-trigger voicing hysteresis, octave/harmonic leap confirmation,
 * 5-point median filtering, adaptive smoothing, and brief micro-dropout coasting.
 */
export class PitchStabilizer {
  private readonly enterClarity: number
  private readonly holdClarity: number
  private readonly coastRmsMin: number
  private readonly maxCoastFrames: number
  private readonly maxCoastGapSec: number
  private readonly resetSilenceFrames: number
  private readonly leapThresholdSemitones: number
  private readonly leapConfirmFrames: number
  private readonly medianWindowSize: number

  private isVoiced = false
  private smoothedMidi: number | null = null
  private medianWindow: number[] = []
  private unvoicedFrames = 0
  private lastRealVoicedTime = -Infinity
  private lastClarity = 0
  private pendingLeap: PendingLeap | null = null

  constructor(options: StabilizerOptions = {}) {
    this.enterClarity = options.enterClarity ?? 0.62
    this.holdClarity = options.holdClarity ?? 0.48
    this.coastRmsMin = options.coastRmsMin ?? 0.003
    this.maxCoastFrames = options.maxCoastFrames ?? 2
    this.maxCoastGapSec = options.maxCoastGapSec ?? 0.095
    this.resetSilenceFrames = options.resetSilenceFrames ?? 4
    this.leapThresholdSemitones = options.leapThresholdSemitones ?? 4.0
    this.leapConfirmFrames = options.leapConfirmFrames ?? 3
    this.medianWindowSize = options.medianWindowSize ?? 5
  }

  public reset(): void {
    this.isVoiced = false
    this.smoothedMidi = null
    this.medianWindow = []
    this.unvoicedFrames = 0
    this.lastRealVoicedTime = -Infinity
    this.lastClarity = 0
    this.pendingLeap = null
  }

  public process(
    frame: { time: number; frequency: number | null; clarity: number; rms: number },
    a4Hz: number,
  ): StabilizedPitch {
    const clarityGate = this.isVoiced ? this.holdClarity : this.enterClarity
    const hasCandidate =
      frame.frequency !== null &&
      Number.isFinite(frame.frequency) &&
      frame.frequency > 0 &&
      frame.clarity >= clarityGate

    if (!hasCandidate) {
      this.unvoicedFrames++
      this.pendingLeap = null

      const canCoast =
        this.isVoiced &&
        this.smoothedMidi !== null &&
        this.unvoicedFrames <= this.maxCoastFrames &&
        frame.time - this.lastRealVoicedTime <= this.maxCoastGapSec &&
        frame.rms >= this.coastRmsMin

      if (canCoast) {
        const coastMidi = this.smoothedMidi!
        const coastClarity = Math.max(frame.clarity, this.holdClarity + 0.05)
        return {
          time: frame.time,
          midi: coastMidi,
          frequency: midiToFrequency(coastMidi, a4Hz),
          clarity: coastClarity,
          rms: frame.rms,
          coasted: true,
        }
      }

      this.isVoiced = false
      if (this.unvoicedFrames >= this.resetSilenceFrames) {
        this.smoothedMidi = null
        this.medianWindow = []
        this.lastClarity = 0
      }

      return {
        time: frame.time,
        midi: null,
        frequency: null,
        clarity: 0,
        rms: frame.rms,
        coasted: false,
      }
    }

    const rawMidi = frequencyToMidi(frame.frequency!, a4Hz)
    const isContinuousPhrase =
      this.smoothedMidi !== null && frame.time - this.lastRealVoicedTime <= 0.28

    if (!isContinuousPhrase) {
      this.pendingLeap = null
      this.medianWindow = [rawMidi]
      this.smoothedMidi = rawMidi
      this.isVoiced = true
      this.unvoicedFrames = 0
      this.lastRealVoicedTime = frame.time
      this.lastClarity = frame.clarity

      return {
        time: frame.time,
        midi: this.smoothedMidi,
        frequency: midiToFrequency(this.smoothedMidi, a4Hz),
        clarity: frame.clarity,
        rms: frame.rms,
        coasted: false,
      }
    }

    const currentMidi = this.smoothedMidi!
    const absJump = Math.abs(rawMidi - currentMidi)

    if (absJump > this.leapThresholdSemitones) {
      const isOctaveLike = Math.abs(absJump - 12) <= 1.35 || Math.abs(absJump - 24) <= 1.5
      if (this.pendingLeap && Math.abs(rawMidi - this.pendingLeap.meanMidi) <= 1.35) {
        const nextCount = this.pendingLeap.count + 1
        this.pendingLeap = {
          meanMidi: (this.pendingLeap.meanMidi * this.pendingLeap.count + rawMidi) / nextCount,
          count: nextCount,
        }
      } else {
        this.pendingLeap = { meanMidi: rawMidi, count: 1 }
      }

      const requiredFrames =
        !isOctaveLike && frame.clarity >= 0.88
          ? Math.max(2, this.leapConfirmFrames - 1)
          : this.leapConfirmFrames

      if (this.pendingLeap.count < requiredFrames) {
        // Reject transient 1-2 frame octave/harmonic glitch; hold steady on current pitch
        this.unvoicedFrames = 0
        this.lastRealVoicedTime = frame.time
        return {
          time: frame.time,
          midi: currentMidi,
          frequency: midiToFrequency(currentMidi, a4Hz),
          clarity: Math.max(this.lastClarity, this.holdClarity + 0.08),
          rms: frame.rms,
          coasted: true,
        }
      }

      // Confirmed real vocal leap
      const confirmedMidi = this.pendingLeap.meanMidi
      this.pendingLeap = null
      this.medianWindow = [confirmedMidi]
      this.smoothedMidi = confirmedMidi
      this.isVoiced = true
      this.unvoicedFrames = 0
      this.lastRealVoicedTime = frame.time
      this.lastClarity = frame.clarity

      return {
        time: frame.time,
        midi: confirmedMidi,
        frequency: midiToFrequency(confirmedMidi, a4Hz),
        clarity: frame.clarity,
        rms: frame.rms,
        coasted: false,
      }
    }

    // Smooth tracking within normal vocal step / vibrato range
    this.pendingLeap = null
    this.medianWindow.push(rawMidi)
    if (this.medianWindow.length > this.medianWindowSize) {
      this.medianWindow.shift()
    }

    const medianMidi = computeMedian(this.medianWindow)
    const delta = Math.abs(medianMidi - currentMidi)

    // Adaptive smoothing: strong damping for micro-jitter, faster tracking for vibrato & scale steps
    let alpha: number
    if (delta <= 0.35) {
      alpha = 0.25
    } else if (delta <= 1.4) {
      alpha = 0.44
    } else {
      alpha = 0.68
    }

    this.smoothedMidi = currentMidi + (medianMidi - currentMidi) * alpha
    this.isVoiced = true
    this.unvoicedFrames = 0
    this.lastRealVoicedTime = frame.time
    this.lastClarity = frame.clarity

    return {
      time: frame.time,
      midi: this.smoothedMidi,
      frequency: midiToFrequency(this.smoothedMidi, a4Hz),
      clarity: frame.clarity,
      rms: frame.rms,
      coasted: false,
    }
  }
}
