import type { PracticeSessionRecord } from '../practice/types'
import { loadPracticeHistory } from '../practice/storage'
import type { RhythmGameRecord } from '../rhythm/types'
import { loadRhythmHistory } from '../rhythm/scoring'
import type { ImportedSong } from '../songs/types'
import { listStoredSongs, loadSongAudioBlob, saveStoredSong } from '../songs/songStorage'
import { isNativeUpdaterAvailable, VocalLabUpdater } from '../engine/nativeUpdaterPlugin'

const SETTINGS_KEY = 'vocallab:settings:v1'
const PRACTICE_HISTORY_KEY = 'vocallab:practice-history:v1'
const RHYTHM_HISTORY_KEY = 'vocallab:rhythm-history:v1'
const MAX_PRACTICE_RECORDS = 50
const MAX_RHYTHM_RECORDS = 40

export interface SerializedSongEntry {
  song: ImportedSong
  audioBase64?: string
  audioMime?: string
}

export interface VocalLabBackupPayload {
  schemaVersion: 1
  app: 'VocalLab'
  exportedAt: string
  settings: Record<string, unknown> | null
  practiceHistory: PracticeSessionRecord[]
  rhythmHistory: RhythmGameRecord[]
  songs: SerializedSongEntry[]
}

export interface LocalDataStats {
  practiceCount: number
  rhythmCount: number
  songCount: number
}

export interface ImportBackupSummary {
  practiceCount: number
  rhythmCount: number
  songCount: number
  settingsRestored: boolean
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

function base64ToBlob(base64: string, mimeType = 'application/octet-stream'): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

function mergeRecordsById<T extends { id: string; startedAt?: number; playedAt?: number }>(
  existing: T[],
  incoming: T[],
  maxCount: number,
): T[] {
  const map = new Map<string, T>()
  for (const item of existing) {
    if (item && typeof item.id === 'string') {
      map.set(item.id, item)
    }
  }
  for (const item of incoming) {
    if (item && typeof item.id === 'string') {
      map.set(item.id, item)
    }
  }
  return Array.from(map.values())
    .sort((a, b) => (b.startedAt ?? b.playedAt ?? 0) - (a.startedAt ?? a.playedAt ?? 0))
    .slice(0, maxCount)
}

export async function getLocalDataStats(): Promise<LocalDataStats> {
  const practiceCount = loadPracticeHistory().length
  const rhythmCount = loadRhythmHistory().length
  const songs = await listStoredSongs()
  return {
    practiceCount,
    rhythmCount,
    songCount: songs.length,
  }
}

export async function buildBackupPayload(): Promise<VocalLabBackupPayload> {
  let settingsObj: Record<string, unknown> | null = null
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        settingsObj = parsed as Record<string, unknown>
      }
    }
  } catch {
    settingsObj = null
  }

  const practiceHistory = loadPracticeHistory()
  const rhythmHistory = loadRhythmHistory()
  const storedSongs = await listStoredSongs()

  const songs: SerializedSongEntry[] = []
  for (const song of storedSongs) {
    if (song.id.startsWith('builtin-')) continue
    const entry: SerializedSongEntry = { song }
    if (song.hasBackingAudio) {
      const blob = await loadSongAudioBlob(song.id)
      if (blob) {
        entry.audioBase64 = await blobToBase64(blob)
        entry.audioMime = blob.type || 'audio/mpeg'
      }
    }
    songs.push(entry)
  }

  return {
    schemaVersion: 1,
    app: 'VocalLab',
    exportedAt: new Date().toISOString(),
    settings: settingsObj,
    practiceHistory,
    rhythmHistory,
    songs,
  }
}

export async function exportBackupToDevice(): Promise<{ location: string; stats: LocalDataStats }> {
  const payload = await buildBackupPayload()
  const json = JSON.stringify(payload, null, 2)
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `VocalLab-backup-${stamp}.json`
  const stats: LocalDataStats = {
    practiceCount: payload.practiceHistory.length,
    rhythmCount: payload.rhythmHistory.length,
    songCount: payload.songs.length,
  }

  if (isNativeUpdaterAvailable()) {
    const res = await VocalLabUpdater.saveBackupFile({ filename, content: json })
    return { location: res.location, stats }
  }

  const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  return { location: filename, stats }
}

export async function importBackupFromJson(rawJson: string): Promise<ImportBackupSummary> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new Error('备份文件格式错误，无法解析 JSON。')
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('备份文件内容无效。')
  }

  const data = parsed as Partial<VocalLabBackupPayload>
  if (data.app !== 'VocalLab' || data.schemaVersion !== 1) {
    throw new Error('不是受支持的 VocalLab 备份文件。')
  }

  let settingsRestored = false
  if (data.settings && typeof data.settings === 'object') {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(data.settings))
      settingsRestored = true
    } catch {
      // ignore storage quota errors
    }
  }

  const incomingPractice = Array.isArray(data.practiceHistory) ? data.practiceHistory : []
  const mergedPractice = mergeRecordsById(
    loadPracticeHistory(),
    incomingPractice,
    MAX_PRACTICE_RECORDS,
  )
  try {
    window.localStorage.setItem(PRACTICE_HISTORY_KEY, JSON.stringify(mergedPractice))
  } catch {
    // ignore
  }

  const incomingRhythm = Array.isArray(data.rhythmHistory) ? data.rhythmHistory : []
  const mergedRhythm = mergeRecordsById(
    loadRhythmHistory(),
    incomingRhythm,
    MAX_RHYTHM_RECORDS,
  )
  try {
    window.localStorage.setItem(RHYTHM_HISTORY_KEY, JSON.stringify(mergedRhythm))
  } catch {
    // ignore
  }

  const incomingSongs = Array.isArray(data.songs) ? data.songs : []
  let restoredSongs = 0
  for (const entry of incomingSongs) {
    if (!entry || !entry.song || typeof entry.song.id !== 'string') continue
    if (entry.song.id.startsWith('builtin-')) continue
    const blob =
      typeof entry.audioBase64 === 'string' && entry.audioBase64.length > 0
        ? base64ToBlob(entry.audioBase64, entry.audioMime || 'audio/mpeg')
        : undefined
    await saveStoredSong(entry.song, blob)
    restoredSongs++
  }

  return {
    practiceCount: incomingPractice.length,
    rhythmCount: incomingRhythm.length,
    songCount: restoredSongs,
    settingsRestored,
  }
}
