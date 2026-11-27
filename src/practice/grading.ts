import { midiToFrequency } from '../audio/pitchMath'
import type { PracticeStrictness } from '../composables/useSettings'
import type { PitchFrame } from '../engine/pitchEngine'
import type { NoteResult, PracticeGrade } from './types'

export interface GradeWindow {
  noteId: string
  midi: number
  start: number
  end: number
  onsetGraceSec?: number
}

export interface GradeOptions {
  a4Hz: number
  strictness: PracticeStrictness
  allowOctaveTolerance: boolean
  latencyOffsetSec?: number
}

export const GRADE_SCORE_WEIGHTS: Record<PracticeGrade, number> = {
  perfect: 100,
  great: 80,
  good: 55,
  miss: 0,
}

export const GRADE_LABELS: Record<PracticeGrade, { title: string; zh: string }> = {
  perfect: { title: 'PERFECT', zh: '完美' },
  great: { title: 'GREAT', zh: '优秀' },
  good: { title: 'GOOD', zh: '良好' },
  miss: { title: 'MISS', zh: '偏差' },
}

const STRICTNESS_MULTIPLIER: Record<PracticeStrictness, number> = {
  relaxed: 1.5,
  standard: 1.0,
  strict: 0.7,
}

const MIN_CLARITY = 0.52
const MAX_FRAME_DT = 0.08
const DEFAULT_FRAME_DT = 0.025
const OUTLIER_CENTS_LIMIT = 120

function medianOf(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) * 0.5
}

export function computeCentsError(
  frequency: number,
  targetMidi: number,
  a4Hz: number,
  allowOctaveTolerance: boolean,
): { cents: number; octaveOffset: number } {
  const targetFreq = midiToFrequency(targetMidi, a4Hz)
  const rawCents = 1200 * Math.log2(frequency / targetFreq)
  if (!allowOctaveTolerance) {
    return { cents: rawCents, octaveOffset: 0 }
  }
  const octaveOffset = Math.round(rawCents / 1200)
  const foldedCents = rawCents - octaveOffset * 1200
  return { cents: foldedCents, octaveOffset }
}

export function gradeNote(
  frames: PitchFrame[],
  window: GradeWindow,
  options: GradeOptions,
): NoteResult {
  const rawDuration = Math.max(0.05, window.end - window.start)
  const onsetGrace =
    window.onsetGraceSec !== undefined
      ? Math.max(0, Math.min(rawDuration * 0.4, window.onsetGraceSec))
      : Math.min(0.22, rawDuration * 0.28)

  const evalStart = window.start + onsetGrace
  const evalEnd = window.end
  const evalDuration = Math.max(0.05, evalEnd - evalStart)
  const latency = options.latencyOffsetSec ?? 0

  // Filter and align frames inside [evalStart, evalEnd)
  const aligned: Array<{ time: number; frequency: number | null; clarity: number }> = []
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    const t = frame.time - latency
    if (t >= evalStart && t < evalEnd) {
      aligned.push({ time: t, frequency: frame.frequency, clarity: frame.clarity })
    }
  }

  // Also check onset delay from window.start
  let onsetDelayMs: number | null = null
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!
    const t = frame.time - latency
    if (t < window.start || t >= window.end) continue
    if (frame.frequency !== null && frame.clarity >= MIN_CLARITY) {
      const { cents } = computeCentsError(
        frame.frequency,
        window.midi,
        options.a4Hz,
        options.allowOctaveTolerance,
      )
      if (Math.abs(cents) <= 50) {
        onsetDelayMs = Math.max(0, Math.round((t - window.start) * 1000))
        break
      }
    }
  }

  if (aligned.length === 0) {
    return {
      noteId: window.noteId,
      midi: window.midi,
      grade: 'miss',
      meanCents: 0,
      meanAbsCents: 999,
      stability: 999,
      voicedRatio: 0,
      onsetDelayMs,
      octaveOffset: 0,
    }
  }

  let voicedDuration = 0
  const voicedSamples: Array<{ cents: number; octaveOffset: number; weight: number }> = []

  for (let i = 0; i < aligned.length; i++) {
    const curr = aligned[i]!
    const nextTime = i + 1 < aligned.length ? aligned[i + 1]!.time : Math.min(evalEnd, curr.time + DEFAULT_FRAME_DT)
    const dt = Math.max(0.005, Math.min(MAX_FRAME_DT, nextTime - curr.time))

    if (curr.frequency !== null && curr.clarity >= MIN_CLARITY) {
      const { cents, octaveOffset } = computeCentsError(
        curr.frequency,
        window.midi,
        options.a4Hz,
        options.allowOctaveTolerance,
      )
      voicedDuration += dt
      voicedSamples.push({ cents, octaveOffset, weight: dt })
    }
  }

  if (voicedDuration <= 0 || voicedSamples.length === 0) {
    return {
      noteId: window.noteId,
      midi: window.midi,
      grade: 'miss',
      meanCents: 0,
      meanAbsCents: 999,
      stability: 999,
      voicedRatio: 0,
      onsetDelayMs,
      octaveOffset: 0,
    }
  }

  // Reject isolated transient onset/consonant/octave outliers so brief glitches don't ruin steady notes
  let activeSamples = voicedSamples
  let activeDuration = voicedDuration
  if (voicedSamples.length >= 5) {
    const medCents = medianOf(voicedSamples.map((s) => s.cents))
    const inliers = voicedSamples.filter((s) => Math.abs(s.cents - medCents) <= OUTLIER_CENTS_LIMIT)
    const inlierDuration = inliers.reduce((acc, s) => acc + s.weight, 0)
    if (inliers.length >= 3 && inlierDuration >= voicedDuration * 0.65) {
      activeSamples = inliers
      activeDuration = inlierDuration
    }
  }

  const voicedRatio = Math.min(1, activeDuration / evalDuration)
  let weightedCentsSum = 0
  let weightedAbsCentsSum = 0
  let weightedOctaveSum = 0
  for (const sample of activeSamples) {
    weightedCentsSum += sample.cents * sample.weight
    weightedAbsCentsSum += Math.abs(sample.cents) * sample.weight
    weightedOctaveSum += sample.octaveOffset * sample.weight
  }

  const meanCents = weightedCentsSum / activeDuration
  const meanAbsCents = weightedAbsCentsSum / activeDuration
  const octaveOffset = Math.round(weightedOctaveSum / activeDuration)

  let varianceSum = 0
  for (const sample of activeSamples) {
    const diff = sample.cents - meanCents
    varianceSum += diff * diff * sample.weight
  }
  const stability = Math.sqrt(varianceSum / activeDuration)

  const mult = STRICTNESS_MULTIPLIER[options.strictness]
  let grade: PracticeGrade = 'miss'

  if (meanAbsCents <= 15 * mult && stability <= 24 * mult && voicedRatio >= 0.45) {
    grade = 'perfect'
  } else if (meanAbsCents <= 30 * mult && voicedRatio >= 0.35) {
    grade = 'great'
  } else if (meanAbsCents <= 55 * mult && voicedRatio >= 0.25) {
    grade = 'good'
  }

  return {
    noteId: window.noteId,
    midi: window.midi,
    grade,
    meanCents: Math.round(meanCents),
    meanAbsCents: Math.round(meanAbsCents * 10) / 10,
    stability: Math.round(stability * 10) / 10,
    voicedRatio: Math.round(voicedRatio * 1000) / 1000,
    onsetDelayMs,
    octaveOffset,
  }
}

export function computeProvisionalGrade(
  frames: PitchFrame[],
  window: GradeWindow,
  currentTime: number,
  options: GradeOptions,
): PracticeGrade | null {
  const elapsed = currentTime - window.start
  if (elapsed < 0.26) return null
  const partialEnd = Math.min(window.end, currentTime)
  if (partialEnd - window.start < 0.26) return null
  const result = gradeNote(frames, { ...window, end: partialEnd }, options)
  if (result.voicedRatio < 0.18) return null
  return result.grade
}

export function summarizeResults(results: NoteResult[]): {
  score: number
  counts: Record<PracticeGrade, number>
  maxCombo: number
  missedMidis: number[]
} {
  const counts: Record<PracticeGrade, number> = {
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0,
  }
  let totalPoints = 0
  let combo = 0
  let maxCombo = 0
  const missedSet = new Set<number>()

  for (const res of results) {
    counts[res.grade]++
    totalPoints += GRADE_SCORE_WEIGHTS[res.grade]
    if (res.grade === 'perfect' || res.grade === 'great') {
      combo++
      if (combo > maxCombo) maxCombo = combo
    } else {
      combo = 0
    }
    if (res.grade === 'miss' || res.grade === 'good') {
      missedSet.add(res.midi)
    }
  }

  const score = results.length > 0 ? Math.round(totalPoints / results.length) : 0
  return {
    score,
    counts,
    maxCombo,
    missedMidis: Array.from(missedSet).sort((a, b) => a - b),
  }
}
