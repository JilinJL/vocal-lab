import { describe, expect, it } from 'vitest'
import { midiToFrequency } from '../../audio/pitchMath'
import type { PitchFrame } from '../../engine/pitchEngine'
import { gradeNote, summarizeResults } from '../grading'

function makeFrames(
  start: number,
  end: number,
  targetMidi: number,
  centsOffset: number | ((t: number) => number),
  step = 0.025,
  clarity = 0.94,
): PitchFrame[] {
  const frames: PitchFrame[] = []
  for (let t = start; t < end; t += step) {
    const offset = typeof centsOffset === 'function' ? centsOffset(t) : centsOffset
    const freq = midiToFrequency(targetMidi + offset / 100, 440)
    frames.push({ time: t, frequency: freq, clarity, rms: 0.1 })
  }
  return frames
}

describe('practice grading', () => {
  const baseOptions = {
    a4Hz: 440,
    strictness: 'standard' as const,
    allowOctaveTolerance: false,
  }

  it('awards perfect, great, good, and miss across cents thresholds', () => {
    const win = { noteId: 'n1', midi: 60, start: 1.0, end: 2.5 }

    const perfect = gradeNote(makeFrames(1.0, 2.5, 60, 4), win, baseOptions)
    expect(perfect.grade).toBe('perfect')
    expect(perfect.voicedRatio).toBeGreaterThan(0.9)

    const great = gradeNote(makeFrames(1.0, 2.5, 60, 18), win, baseOptions)
    expect(great.grade).toBe('great')

    const good = gradeNote(makeFrames(1.0, 2.5, 60, -40), win, baseOptions)
    expect(good.grade).toBe('good')

    const wrongSemitone = gradeNote(makeFrames(1.0, 2.5, 61, 0), win, baseOptions)
    expect(wrongSemitone.grade).toBe('miss')
  })

  it('marks silence and brief vocal snippets as miss', () => {
    const win = { noteId: 'n2', midi: 64, start: 0, end: 1.5 }
    expect(gradeNote([], win, baseOptions).grade).toBe('miss')
    // Only 0.2s voiced inside 1.35s evaluation window (< 0.4 coverage)
    const snippet = makeFrames(0.2, 0.4, 64, 0)
    expect(gradeNote(snippet, win, baseOptions).grade).toBe('miss')
  })

  it('handles octave tolerance toggle accurately', () => {
    const win = { noteId: 'n3', midi: 60, start: 0, end: 1.5 }
    const highOctave = makeFrames(0, 1.5, 72, 2)
    expect(gradeNote(highOctave, win, { ...baseOptions, allowOctaveTolerance: false }).grade).toBe('miss')
    const tolerated = gradeNote(highOctave, win, { ...baseOptions, allowOctaveTolerance: true })
    expect(tolerated.grade).toBe('perfect')
    expect(tolerated.octaveOffset).toBe(1)
  })

  it('summarizes score, combo, and missed notes', () => {
    const win = { noteId: 'n', midi: 60, start: 0, end: 1.5 }
    const r1 = gradeNote(makeFrames(0, 1.5, 60, 2), win, baseOptions)
    const r2 = gradeNote(makeFrames(0, 1.5, 62, 18), { ...win, midi: 62 }, baseOptions)
    const r3 = gradeNote([], { ...win, midi: 64 }, baseOptions)
    const summary = summarizeResults([r1, r2, r3])
    expect(summary.counts).toEqual({ perfect: 1, great: 1, good: 0, miss: 1 })
    expect(summary.maxCombo).toBe(2)
    expect(summary.score).toBe(60)
    expect(summary.missedMidis).toEqual([64])
  })

  it('ignores isolated octave glitch frames and tolerates natural moderate vocal clarity', () => {
    const win = { noteId: 'n4', midi: 60, start: 0, end: 1.5 }
    const frames = makeFrames(0.15, 1.45, 60, (t) => Math.sin(t * 2 * Math.PI * 5.2) * 12, 0.025, 0.66)
    // Inject 2 isolated octave-up glitch frames
    frames[12] = { time: frames[12]!.time, frequency: midiToFrequency(72, 440), clarity: 0.85, rms: 0.08 }
    frames[13] = { time: frames[13]!.time, frequency: midiToFrequency(72, 440), clarity: 0.85, rms: 0.08 }

    const res = gradeNote(frames, win, baseOptions)
    expect(res.grade).toBe('perfect')
    expect(Math.abs(res.meanCents)).toBeLessThan(12)
  })
})
