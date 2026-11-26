import { detectPitchYin } from '../audio/yinDetector'
import { getSharedAudioContext } from '../engine/audioContext'
import { segmentPitchFramesToNotes, type OfflinePitchPoint } from './noteSegmenter'
import type { ImportedSong, SongNote } from './types'

export const MAX_AUDIO_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
export const MAX_AUDIO_DURATION_SEC = 60 // 60 s preview cap

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const length = audioBuffer.length
  const channels = audioBuffer.numberOfChannels
  const mono = new Float32Array(length)
  if (channels === 1) {
    mono.set(audioBuffer.getChannelData(0))
    return mono
  }
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      mono[i] = mono[i]! + data[i]! / channels
    }
  }
  return mono
}

function analyzeOnMainThread(samples: Float32Array, sampleRate: number, a4Hz: number): SongNote[] {
  const frameSize = 2048
  const hopSize = Math.max(256, Math.round(sampleRate * 0.025))
  const points: OfflinePitchPoint[] = []
  const slice = new Float32Array(frameSize)
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    slice.set(samples.subarray(offset, offset + frameSize))
    const res = detectPitchYin(slice, sampleRate, {
      minFrequency: 65,
      maxFrequency: 1180,
      threshold: 0.15,
      rmsThreshold: 0.01,
    })
    points.push({
      time: (offset + frameSize / 2) / sampleRate,
      frequency: res.frequency,
      clarity: res.clarity,
    })
  }
  return segmentPitchFramesToNotes(points, { a4Hz })
}

export interface AudioAnalysisHandle {
  promise: Promise<{ song: ImportedSong; audioBuffer: AudioBuffer }>
  cancel: () => void
}

export function analyzeVocalAudioFile(
  file: File,
  a4Hz: number,
  onProgress?: (percent: number) => void,
): AudioAnalysisHandle {
  let cancelled = false
  let worker: Worker | null = null

  const cancel = () => {
    cancelled = true
    if (worker) {
      worker.terminate()
      worker = null
    }
  }

  const promise = (async () => {
    if (file.size > MAX_AUDIO_FILE_BYTES) {
      throw new Error('单人清唱文件上限为 10 MB，请裁剪后重新导入。')
    }

    onProgress?.(8)
    const arrayBuffer = await file.arrayBuffer()
    if (cancelled) throw new Error('已取消导入')

    const ctx = getSharedAudioContext()
    let decoded: AudioBuffer
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
    } catch {
      throw new Error('无法解码该音频文件，请确认文件为正常的 WAV、MP3 或 M4A 格式。')
    }

    if (cancelled) throw new Error('已取消导入')
    if (decoded.duration > MAX_AUDIO_DURATION_SEC + 0.5) {
      throw new Error(
        `清唱音频时长为 ${Math.round(decoded.duration)} 秒，当前上限为 ${MAX_AUDIO_DURATION_SEC} 秒，请先截取片段后导入。`,
      )
    }

    onProgress?.(20)
    const mono = mixToMono(decoded)
    const sampleRate = decoded.sampleRate

    let notes: SongNote[]
    if (typeof Worker !== 'undefined') {
      notes = await new Promise<SongNote[]>((resolve, reject) => {
        worker = new Worker(new URL('./audioAnalyzeWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<{ type: string; progress?: number; notes?: SongNote[]; message?: string }>) => {
          if (cancelled) return
          const data = event.data
          if (data.type === 'progress' && typeof data.progress === 'number') {
            onProgress?.(20 + Math.round(data.progress * 0.78))
          } else if (data.type === 'done' && data.notes) {
            worker?.terminate()
            worker = null
            resolve(data.notes)
          } else if (data.type === 'error') {
            worker?.terminate()
            worker = null
            reject(new Error(data.message || '旋律提取失败'))
          }
        }
        worker.onerror = () => {
          worker?.terminate()
          worker = null
          try {
            resolve(analyzeOnMainThread(mono, sampleRate, a4Hz))
          } catch (err) {
            reject(err)
          }
        }
        worker.postMessage({ samples: mono, sampleRate, a4Hz }, [mono.buffer])
      })
    } else {
      notes = analyzeOnMainThread(mono, sampleRate, a4Hz)
    }

    if (cancelled) throw new Error('已取消导入')
    if (notes.length === 0) {
      throw new Error('未检测到清晰的单声部旋律。请使用无伴奏清唱或单乐器音频重试。')
    }

    onProgress?.(100)
    const cleanTitle = file.name.replace(/\.(wav|mp3|m4a|aac|ogg|flac)$/i, '') || '未命名音频'
    const song: ImportedSong = {
      id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: cleanTitle,
      sourceType: 'audio',
      duration: decoded.duration,
      notes,
      createdAt: Date.now(),
      hasBackingAudio: true,
    }

    return { song, audioBuffer: decoded }
  })()

  return { promise, cancel }
}
