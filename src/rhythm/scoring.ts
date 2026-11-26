import type {
  RhythmGameRecord,
  RhythmGameSummary,
  RhythmGrade,
  RhythmHitResult,
} from './types'

export interface RhythmTimingWindows {
  perfectMs: number
  greatMs: number
  goodMs: number
  maxWindowMs: number
}

export const DEFAULT_TIMING_WINDOWS: RhythmTimingWindows = {
  perfectMs: 36,
  greatMs: 72,
  goodMs: 118,
  maxWindowMs: 165,
}

export const RHYTHM_GRADE_POINTS: Record<RhythmGrade, number> = {
  perfect: 100,
  great: 80,
  good: 55,
  miss: 0,
}

export const RHYTHM_GRADE_LABELS: Record<RhythmGrade, string> = {
  perfect: 'Perfect',
  great: 'Great',
  good: 'Good',
  miss: 'Miss',
}

export function judgeTimingOffset(
  offsetMs: number,
  windows: RhythmTimingWindows = DEFAULT_TIMING_WINDOWS,
): RhythmGrade {
  const abs = Math.abs(offsetMs)
  if (abs <= windows.perfectMs) return 'perfect'
  if (abs <= windows.greatMs) return 'great'
  if (abs <= windows.goodMs) return 'good'
  return 'miss'
}

export function formatTimingBias(offsetMs: number): string {
  const rounded = Math.round(offsetMs)
  if (Math.abs(rounded) <= 10) return '稳准'
  return rounded < 0 ? `偏抢 ${Math.abs(rounded)}ms` : `偏拖 +${rounded}ms`
}

export function summarizeRhythmResults(
  results: readonly RhythmHitResult[],
  totalTargets: number,
  maxCombo: number,
): RhythmGameSummary {
  let perfectCount = 0
  let greatCount = 0
  let goodCount = 0
  let missCount = 0
  let totalPoints = 0
  const hitOffsets: number[] = []

  for (const r of results) {
    totalPoints += RHYTHM_GRADE_POINTS[r.grade]
    if (r.grade === 'perfect') perfectCount++
    else if (r.grade === 'great') greatCount++
    else if (r.grade === 'good') goodCount++
    else missCount++

    if (r.grade !== 'miss' && Number.isFinite(r.offsetMs)) {
      hitOffsets.push(r.offsetMs)
    }
  }

  const denom = Math.max(1, totalTargets)
  const score = Math.round(totalPoints / denom)

  let avgOffsetMs = 0
  let stabilityMs = 0
  if (hitOffsets.length > 0) {
    avgOffsetMs = hitOffsets.reduce((acc, v) => acc + v, 0) / hitOffsets.length
    const variance =
      hitOffsets.reduce((acc, v) => acc + (v - avgOffsetMs) * (v - avgOffsetMs), 0) /
      hitOffsets.length
    stabilityMs = Math.sqrt(variance)
  }

  return {
    score,
    totalTargets,
    perfectCount,
    greatCount,
    goodCount,
    missCount,
    maxCombo,
    avgOffsetMs: Math.round(avgOffsetMs),
    stabilityMs: Math.round(stabilityMs),
  }
}

const HISTORY_KEY = 'vocallab:rhythm-history:v1'
const MAX_RECORDS = 12

export function loadRhythmHistory(): RhythmGameRecord[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, MAX_RECORDS) as RhythmGameRecord[]
  } catch {
    return []
  }
}

export function saveRhythmRecord(record: RhythmGameRecord): RhythmGameRecord[] {
  const next = [record, ...loadRhythmHistory()].slice(0, MAX_RECORDS)
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // ignore storage failures
  }
  return next
}

export function clearRhythmHistory(): void {
  try {
    window.localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}
