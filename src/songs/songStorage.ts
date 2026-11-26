import type { ImportedSong } from './types'

const DB_NAME = 'vocallab-songs-db'
const DB_VERSION = 1
const STORE_SONGS = 'songs'
const STORE_BLOBS = 'blobs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SONGS)) {
        db.createObjectStore(STORE_SONGS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

export async function listStoredSongs(): Promise<ImportedSong[]> {
  try {
    const db = await openDb()
    return await new Promise<ImportedSong[]>((resolve, reject) => {
      const tx = db.transaction(STORE_SONGS, 'readonly')
      const req = tx.objectStore(STORE_SONGS).getAll()
      req.onsuccess = () => {
        const items = (req.result as ImportedSong[]) || []
        items.sort((a, b) => b.createdAt - a.createdAt)
        resolve(items)
      }
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function saveStoredSong(song: ImportedSong, audioBlob?: Blob): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_SONGS, STORE_BLOBS], 'readwrite')
    tx.objectStore(STORE_SONGS).put(song)
    if (audioBlob) {
      tx.objectStore(STORE_BLOBS).put(audioBlob, song.id)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('保存本地歌曲失败，请清理存储空间后重试。'))
  })
}

export async function loadSongAudioBlob(songId: string): Promise<Blob | null> {
  try {
    const db = await openDb()
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_BLOBS, 'readonly')
      const req = tx.objectStore(STORE_BLOBS).get(songId)
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

export async function deleteStoredSong(songId: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE_SONGS, STORE_BLOBS], 'readwrite')
      tx.objectStore(STORE_SONGS).delete(songId)
      tx.objectStore(STORE_BLOBS).delete(songId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    // ignore cleanup failures
  }
}
