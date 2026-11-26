import type { PracticeSessionRecord } from './types'

const HISTORY_KEY = 'vocallab:practice-history:v1'
const MAX_RECORDS = 50

export function loadPracticeHistory(): PracticeSessionRecord[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, MAX_RECORDS) as PracticeSessionRecord[]
  } catch {
    return []
  }
}

export function savePracticeRecord(record: PracticeSessionRecord): PracticeSessionRecord[] {
  const list = [record, ...loadPracticeHistory()].slice(0, MAX_RECORDS)
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    // ignore storage quota errors
  }
  return list
}

export function clearPracticeHistory(): void {
  try {
    window.localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}
