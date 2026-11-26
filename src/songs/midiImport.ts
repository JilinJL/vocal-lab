import { Midi } from '@tonejs/midi'
import type { ImportedSong, MidiTrackOption, SongNote } from './types'

interface RawMidiNote {
  time: number
  duration: number
  midi: number
}

/**
 * Resolve overlapping notes into a monophonic melody line by prioritizing the highest pitch.
 */
export function extractMonophonicNotes(rawNotes: RawMidiNote[]): {
  notes: SongNote[]
  polyphonicRatio: number
} {
  if (rawNotes.length === 0) {
    return { notes: [], polyphonicRatio: 0 }
  }

  const sorted = [...rawNotes]
    .filter((n) => Number.isFinite(n.time) && Number.isFinite(n.duration) && n.duration >= 0.04)
    .sort((a, b) => a.time - b.time || b.midi - a.midi)

  if (sorted.length === 0) {
    return { notes: [], polyphonicRatio: 0 }
  }

  const result: SongNote[] = []
  let overlapCount = 0

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i]!
    const prev = result[result.length - 1]

    if (!prev) {
      result.push({
        id: `m-${result.length}-${curr.midi}`,
        start: curr.time,
        duration: curr.duration,
        midi: Math.round(curr.midi),
      })
      continue
    }

    const prevEnd = prev.start + prev.duration
    // Simultaneous chord start (within 35ms): keep the higher note (already sorted desc by midi)
    if (curr.time - prev.start <= 0.035) {
      overlapCount++
      continue
    }

    // Overlaps previous note tail: trim previous note cleanly
    if (curr.time < prevEnd) {
      overlapCount++
      const trimmedDuration = curr.time - prev.start
      if (trimmedDuration >= 0.05) {
        prev.duration = trimmedDuration
      } else {
        // Previous note was too short after trim; replace with current if higher
        if (curr.midi >= prev.midi) {
          result.pop()
        } else {
          continue
        }
      }
    }

    result.push({
      id: `m-${result.length}-${curr.midi}`,
      start: curr.time,
      duration: Math.max(0.06, curr.duration),
      midi: Math.round(curr.midi),
    })
  }

  return {
    notes: result,
    polyphonicRatio: sorted.length > 0 ? overlapCount / sorted.length : 0,
  }
}

function scoreVocalMelodyTrack(track: MidiTrackOption): number {
  if (track.noteCount === 0) return -Infinity
  const center = (track.minMidi + track.maxMidi) / 2
  // Favor vocal range C3 (48) – C6 (84), especially C4 (60) – A4 (69)
  const vocalCenterBonus = Math.max(0, 40 - Math.abs(center - 64) * 1.6)
  const monoBonus = (1 - Math.min(1, track.polyphonicRatio)) * 30
  const countScore = Math.min(40, Math.log2(track.noteCount + 1) * 7)
  const nameBonus = /vocal|voice|melody|lead|sing|主旋律|人声/i.test(track.name) ? 35 : 0
  const drumPenalty = /drum|percussion|bass|鼓/i.test(track.name + ' ' + track.instrument) ? -50 : 0
  return vocalCenterBonus + monoBonus + countScore + nameBonus + drumPenalty
}

export function parseMidiArrayBuffer(buffer: ArrayBuffer, fallbackTitle: string): ImportedSong {
  const midi = new Midi(buffer)
  const trackOptions: MidiTrackOption[] = []

  midi.tracks.forEach((track, idx) => {
    if (track.channel === 9 || track.instrument.percussion) return
    if (track.notes.length === 0) return

    const rawNotes: RawMidiNote[] = track.notes.map((n) => ({
      time: n.time,
      duration: n.duration,
      midi: n.midi,
    }))
    const { notes, polyphonicRatio } = extractMonophonicNotes(rawNotes)
    if (notes.length === 0) return

    let minMidi = Infinity
    let maxMidi = -Infinity
    for (const note of notes) {
      if (note.midi < minMidi) minMidi = note.midi
      if (note.midi > maxMidi) maxMidi = note.midi
    }

    trackOptions.push({
      index: idx,
      name: track.name?.trim() || `音轨 ${idx + 1}`,
      instrument: track.instrument.name || 'Piano',
      noteCount: notes.length,
      minMidi,
      maxMidi,
      polyphonicRatio: Math.round(polyphonicRatio * 100) / 100,
      notes,
    })
  })

  if (trackOptions.length === 0) {
    throw new Error('该 MIDI 文件中未检测到可用的旋律音符。')
  }

  let bestTrack = trackOptions[0]!
  let bestScore = scoreVocalMelodyTrack(bestTrack)
  for (let i = 1; i < trackOptions.length; i++) {
    const candidate = trackOptions[i]!
    const score = scoreVocalMelodyTrack(candidate)
    if (score > bestScore) {
      bestScore = score
      bestTrack = candidate
    }
  }

  const lastNote = bestTrack.notes[bestTrack.notes.length - 1]
  const duration = Math.max(midi.duration || 0, lastNote ? lastNote.start + lastNote.duration : 0)
  const cleanTitle = midi.name?.trim() || fallbackTitle.replace(/\.(mid|midi)$/i, '') || '未命名 MIDI'

  return {
    id: `midi-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: cleanTitle,
    sourceType: 'midi',
    duration,
    notes: bestTrack.notes,
    createdAt: Date.now(),
    tracks: trackOptions,
    selectedTrackIndex: bestTrack.index,
    hasBackingAudio: false,
  }
}
