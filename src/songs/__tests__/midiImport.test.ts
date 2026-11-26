import { describe, expect, it } from 'vitest'
import { Midi } from '@tonejs/midi'
import { extractMonophonicNotes, parseMidiArrayBuffer } from '../midiImport'

describe('midiImport', () => {
  it('resolves chords to the highest melody note and trims overlaps', () => {
    const { notes, polyphonicRatio } = extractMonophonicNotes([
      { time: 0, duration: 1.0, midi: 60 },
      { time: 0, duration: 1.0, midi: 64 },
      { time: 0.5, duration: 0.5, midi: 67 },
    ])
    expect(notes).toHaveLength(2)
    expect(notes[0]!.midi).toBe(64)
    expect(notes[0]!.duration).toBeCloseTo(0.5, 2)
    expect(notes[1]!.midi).toBe(67)
    expect(polyphonicRatio).toBeGreaterThan(0)
  })

  it('parses a standard MIDI buffer and picks the vocal-range track', () => {
    const midi = new Midi()
    midi.header.setTempo(120)
    const bass = midi.addTrack()
    bass.name = 'Bass'
    bass.addNote({ midi: 36, time: 0, duration: 1 })

    const vocal = midi.addTrack()
    vocal.name = 'Vocal Melody'
    vocal.addNote({ midi: 60, time: 0, duration: 0.5 })
    vocal.addNote({ midi: 64, time: 0.5, duration: 0.5 })
    vocal.addNote({ midi: 67, time: 1.0, duration: 1.0 })

    const bytes = midi.toArray()
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const song = parseMidiArrayBuffer(buf as ArrayBuffer, 'test.mid')

    expect(song.title).toBe('test')
    expect(song.notes.map((n) => n.midi)).toEqual([60, 64, 67])
    expect(song.tracks?.length).toBe(2)
  })
})
