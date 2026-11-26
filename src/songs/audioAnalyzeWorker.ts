import { detectPitchYin } from '../audio/yinDetector'
import { segmentPitchFramesToNotes, type OfflinePitchPoint } from './noteSegmenter'
import type { SongNote } from './types'

interface AnalyzeRequest {
  samples: Float32Array
  sampleRate: number
  a4Hz: number
}

interface ProgressMessage {
  type: 'progress'
  progress: number
}

interface DoneMessage {
  type: 'done'
  notes: SongNote[]
}

interface ErrorMessage {
  type: 'error'
  message: string
}

self.onmessage = (event: MessageEvent<AnalyzeRequest>) => {
  try {
    const { samples, sampleRate, a4Hz } = event.data
    const frameSize = 2048
    const hopSize = Math.max(256, Math.round(sampleRate * 0.025)) // 25ms hop
    const totalFrames = Math.max(1, Math.floor((samples.length - frameSize) / hopSize) + 1)
    const points: OfflinePitchPoint[] = []
    const slice = new Float32Array(frameSize)

    let lastProgress = -1
    for (let idx = 0; idx < totalFrames; idx++) {
      const offset = idx * hopSize
      if (offset + frameSize > samples.length) break
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

      const pct = Math.min(95, Math.floor((idx / totalFrames) * 95))
      if (pct >= lastProgress + 5) {
        lastProgress = pct
        const msg: ProgressMessage = { type: 'progress', progress: pct }
        self.postMessage(msg)
      }
    }

    const notes = segmentPitchFramesToNotes(points, { a4Hz })
    const doneMsg: DoneMessage = { type: 'done', notes }
    self.postMessage(doneMsg)
  } catch (err) {
    const msg: ErrorMessage = {
      type: 'error',
      message: err instanceof Error ? err.message : '音频旋律提取失败',
    }
    self.postMessage(msg)
  }
}
