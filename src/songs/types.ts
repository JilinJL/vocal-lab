export interface SongNote {
  id: string
  /** Seconds from start of song (at 1.0x speed) */
  start: number
  /** Duration in seconds (at 1.0x speed) */
  duration: number
  /** Integer MIDI pitch */
  midi: number
}

export interface MidiTrackOption {
  index: number
  name: string
  instrument: string
  noteCount: number
  minMidi: number
  maxMidi: number
  polyphonicRatio: number
  notes: SongNote[]
}

export interface ImportedSong {
  id: string
  title: string
  sourceType: 'builtin' | 'midi' | 'audio'
  duration: number
  notes: SongNote[]
  createdAt: number
  /** Only for MIDI songs with multiple selectable tracks */
  tracks?: MidiTrackOption[]
  selectedTrackIndex?: number
  /** True if original audio blob is stored in IndexedDB */
  hasBackingAudio?: boolean
}
