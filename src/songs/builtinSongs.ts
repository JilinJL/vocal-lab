import type { ImportedSong, SongNote } from './types'

function buildTimedNotes(prefix: string, items: Array<[number, number]>, beatSec: number): SongNote[] {
  const notes: SongNote[] = []
  let cursor = 0.4
  for (let i = 0; i < items.length; i++) {
    const [midi, beats] = items[i]!
    const duration = beats * beatSec
    if (midi > 0) {
      notes.push({
        id: `${prefix}-${i}-${midi}`,
        start: Math.round(cursor * 1000) / 1000,
        duration: Math.round((duration * 0.88) * 1000) / 1000,
        midi,
      })
    }
    cursor += duration
  }
  return notes
}

const TWINKLE_NOTES = buildTimedNotes(
  'twinkle',
  [
    [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
    [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
  ],
  0.65,
)

const ODE_TO_JOY_NOTES = buildTimedNotes(
  'ode',
  [
    [64, 1], [64, 1], [65, 1], [67, 1],
    [67, 1], [65, 1], [64, 1], [62, 1],
    [60, 1], [60, 1], [62, 1], [64, 1],
    [64, 1.5], [62, 0.5], [62, 2],
  ],
  0.58,
)

export const BUILTIN_SONGS: ImportedSong[] = [
  {
    id: 'builtin-twinkle',
    title: '小星星（公共领域示例）',
    sourceType: 'builtin',
    duration: TWINKLE_NOTES[TWINKLE_NOTES.length - 1]!.start + TWINKLE_NOTES[TWINKLE_NOTES.length - 1]!.duration + 0.5,
    notes: TWINKLE_NOTES,
    createdAt: 1,
    hasBackingAudio: false,
  },
  {
    id: 'builtin-ode-to-joy',
    title: '欢乐颂（公共领域示例）',
    sourceType: 'builtin',
    duration: ODE_TO_JOY_NOTES[ODE_TO_JOY_NOTES.length - 1]!.start + ODE_TO_JOY_NOTES[ODE_TO_JOY_NOTES.length - 1]!.duration + 0.5,
    notes: ODE_TO_JOY_NOTES,
    createdAt: 2,
    hasBackingAudio: false,
  },
]
