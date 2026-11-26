import type { PracticePattern, PracticeSpeed } from '../composables/useSettings'
import type { PracticeNoteSlot } from './types'

export interface SpeedTiming {
  demoDuration: number
  gapDuration: number
  singDuration: number
  betweenNotes: number
}

export const SPEED_TIMINGS: Record<PracticeSpeed, SpeedTiming> = {
  slow: {
    demoDuration: 0.9,
    gapDuration: 0.35,
    singDuration: 2.0,
    betweenNotes: 0.4,
  },
  normal: {
    demoDuration: 0.7,
    gapDuration: 0.3,
    singDuration: 1.5,
    betweenNotes: 0.32,
  },
  fast: {
    demoDuration: 0.55,
    gapDuration: 0.25,
    singDuration: 1.15,
    betweenNotes: 0.25,
  },
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11]
const PENTATONIC_INTERVALS = [0, 2, 4, 7, 9]

function buildScaleInRange(minMidi: number, maxMidi: number, intervals: number[]): number[] {
  const notes: number[] = []
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const offset = ((midi - minMidi) % 12 + 12) % 12
    if (intervals.includes(offset)) {
      notes.push(midi)
    }
  }
  return notes.length > 0 ? notes : [minMidi]
}

export function generatePracticeSequence(
  minMidiInput: number,
  maxMidiInput: number,
  pattern: PracticePattern,
  randomFn: () => number = Math.random,
): number[] {
  const minMidi = Math.max(36, Math.min(84, Math.round(Math.min(minMidiInput, maxMidiInput))))
  const maxMidi = Math.max(36, Math.min(84, Math.round(Math.max(minMidiInput, maxMidiInput))))

  if (minMidi === maxMidi) {
    return [minMidi]
  }

  const chromatic: number[] = []
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    chromatic.push(midi)
  }

  switch (pattern) {
    case 'chromatic-up':
      return chromatic
    case 'chromatic-down':
      return [...chromatic].reverse()
    case 'chromatic-up-down': {
      const down = [...chromatic].reverse().slice(1)
      return [...chromatic, ...down]
    }
    case 'major-scale':
      return buildScaleInRange(minMidi, maxMidi, MAJOR_INTERVALS)
    case 'pentatonic':
      return buildScaleInRange(minMidi, maxMidi, PENTATONIC_INTERVALS)
    case 'intervals-3rd': {
      const scale = buildScaleInRange(minMidi, maxMidi, MAJOR_INTERVALS)
      if (scale.length < 3) return scale
      const result: number[] = []
      for (let i = 0; i < scale.length - 2; i++) {
        result.push(scale[i]!, scale[i + 2]!)
      }
      return result
    }
    case 'intervals-5th': {
      const scale = buildScaleInRange(minMidi, maxMidi, MAJOR_INTERVALS)
      if (scale.length < 5) {
        return [minMidi, maxMidi]
      }
      const result: number[] = []
      for (let i = 0; i < scale.length - 4; i++) {
        result.push(scale[i]!, scale[i + 4]!)
      }
      return result
    }
    case 'random': {
      const count = Math.max(6, Math.min(14, chromatic.length))
      const pool: number[] = []
      let prev: number | null = null
      for (let i = 0; i < count; i++) {
        let pick = chromatic[Math.floor(randomFn() * chromatic.length)]!
        if (chromatic.length > 1 && pick === prev) {
          const idx = chromatic.indexOf(pick)
          pick = chromatic[(idx + 1) % chromatic.length]!
        }
        pool.push(pick)
        prev = pick
      }
      return pool
    }
  }
}

export function buildPracticeTimeline(
  midis: number[],
  speed: PracticeSpeed,
  listenMode: 'listen-then-sing' | 'simultaneous',
): PracticeNoteSlot[] {
  const timing = SPEED_TIMINGS[speed]
  const slots: PracticeNoteSlot[] = []
  let cursor = 0.25

  for (let index = 0; index < midis.length; index++) {
    const midi = midis[index]!
    if (listenMode === 'simultaneous') {
      const singStart = cursor
      const singEnd = singStart + timing.singDuration
      slots.push({
        id: `note-${index}-${midi}`,
        index,
        midi,
        demoStart: singStart,
        demoEnd: singEnd,
        singStart,
        singEnd,
      })
      cursor = singEnd + timing.betweenNotes
    } else {
      const demoStart = cursor
      const demoEnd = demoStart + timing.demoDuration
      const singStart = demoEnd + timing.gapDuration
      const singEnd = singStart + timing.singDuration
      slots.push({
        id: `note-${index}-${midi}`,
        index,
        midi,
        demoStart,
        demoEnd,
        singStart,
        singEnd,
      })
      cursor = singEnd + timing.betweenNotes
    }
  }

  return slots
}
