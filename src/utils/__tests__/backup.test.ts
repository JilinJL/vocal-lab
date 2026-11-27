import { beforeEach, describe, expect, it } from 'vitest'
import { buildBackupPayload, importBackupFromJson } from '../backup'

function createMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  }
}

describe('backup export and migration import', () => {
  beforeEach(() => {
    const mem = createMemoryStorage()
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: mem },
      writable: true,
      configurable: true,
    })
  })

  it('exports and merges settings, practice history, and rhythm history without duplicates', async () => {
    window.localStorage.setItem('vocallab:settings:v1', JSON.stringify({ a4Hz: 442, volume: 0.9 }))
    window.localStorage.setItem(
      'vocallab:practice-history:v1',
      JSON.stringify([
        {
          id: 'prac-1',
          mode: 'practice',
          title: '音准练习 A3–E4',
          startedAt: 1000,
          score: 92,
          maxCombo: 6,
          counts: { perfect: 5, great: 2, good: 1, miss: 0 },
          noteCount: 8,
          a4Hz: 442,
          rangeLabel: 'A3–E4',
        },
      ]),
    )
    window.localStorage.setItem(
      'vocallab:rhythm-history:v1',
      JSON.stringify([
        {
          id: 'rhy-1',
          challengeId: 'ch-1',
          title: '稳拍入门',
          bpm: 96,
          score: 88,
          accuracyPct: 91,
          meanOffsetMs: -4,
          playedAt: 2000,
        },
      ]),
    )

    const payload = await buildBackupPayload()
    expect(payload.app).toBe('VocalLab')
    expect(payload.schemaVersion).toBe(1)
    expect(payload.practiceHistory).toHaveLength(1)
    expect(payload.rhythmHistory).toHaveLength(1)

    // Simulate fresh install with one newer local record, then import backup
    window.localStorage.clear()
    window.localStorage.setItem(
      'vocallab:practice-history:v1',
      JSON.stringify([
        {
          id: 'prac-2',
          mode: 'practice',
          title: '音准练习 C4–G4',
          startedAt: 3000,
          score: 96,
          maxCombo: 8,
          counts: { perfect: 7, great: 1, good: 0, miss: 0 },
          noteCount: 8,
          a4Hz: 440,
          rangeLabel: 'C4–G4',
        },
      ]),
    )

    const summary = await importBackupFromJson(JSON.stringify(payload))
    expect(summary.settingsRestored).toBe(true)
    expect(summary.practiceCount).toBe(1)
    expect(summary.rhythmCount).toBe(1)

    const mergedPractice = JSON.parse(window.localStorage.getItem('vocallab:practice-history:v1')!)
    expect(mergedPractice.map((r: { id: string }) => r.id)).toEqual(['prac-2', 'prac-1'])
    const restoredSettings = JSON.parse(window.localStorage.getItem('vocallab:settings:v1')!)
    expect(restoredSettings.a4Hz).toBe(442)
  })

  it('rejects malformed or unsupported backup payloads', async () => {
    await expect(importBackupFromJson('not-json')).rejects.toThrow(/JSON/)
    await expect(importBackupFromJson(JSON.stringify({ app: 'Other', schemaVersion: 1 }))).rejects.toThrow(
      /VocalLab/,
    )
  })
})
