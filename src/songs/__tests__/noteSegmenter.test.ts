import { describe, expect, it } from 'vitest'
import { midiToFrequency } from '../../audio/pitchMath'
import { segmentPitchFramesToNotes, type OfflinePitchPoint } from '../noteSegmenter'

describe('noteSegmenter', () => {
  it('segments monophonic pitch contour into discrete notes and bridges short gaps', () => {
    const points: OfflinePitchPoint[] = []
    // C4 for 0.4s with a 25ms brief dropout at 0.2s
    for (let t = 0; t < 0.4; t += 0.025) {
      const drop = Math.abs(t - 0.2) < 0.015
      points.push({
        time: t,
        frequency: drop ? null : midiToFrequency(60, 440),
        clarity: drop ? 0 : 0.92,
      })
    }
    // 0.15s silence
    for (let t = 0.4; t < 0.55; t += 0.025) {
      points.push({ time: t, frequency: null, clarity: 0 })
    }
    // E4 for 0.35s
    for (let t = 0.55; t < 0.9; t += 0.025) {
      points.push({ time: t, frequency: midiToFrequency(64, 440), clarity: 0.9 })
    }

    const notes = segmentPitchFramesToNotes(points)
    expect(notes).toHaveLength(2)
    expect(notes[0]!.midi).toBe(60)
    expect(notes[0]!.duration).toBeGreaterThan(0.32)
    expect(notes[1]!.midi).toBe(64)
  })
})
