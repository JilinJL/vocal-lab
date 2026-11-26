import type {
  PracticeListenMode,
  PracticePattern,
  PracticeSpeed,
  PracticeStrictness,
} from '../composables/useSettings'

export type PracticeGrade = 'perfect' | 'great' | 'good' | 'miss'

export type PracticeStatus = 'idle' | 'countdown' | 'running' | 'paused' | 'finished'

export interface PracticeConfig {
  minMidi: number
  maxMidi: number
  pattern: PracticePattern
  speed: PracticeSpeed
  listenMode: PracticeListenMode
  strictness: PracticeStrictness
  allowOctaveTolerance: boolean
  a4Hz: number
  customMidis?: number[]
}

export interface PracticeNoteSlot {
  id: string
  index: number
  midi: number
  /** Session-relative seconds (0 = start of note 0) */
  demoStart: number
  demoEnd: number
  singStart: number
  singEnd: number
}

export interface NoteResult {
  noteId: string
  midi: number
  grade: PracticeGrade
  meanCents: number
  meanAbsCents: number
  stability: number
  voicedRatio: number
  onsetDelayMs: number | null
  octaveOffset: number
}

export interface PracticeSessionRecord {
  id: string
  mode: 'practice' | 'song'
  title: string
  startedAt: number
  score: number
  maxCombo: number
  counts: Record<PracticeGrade, number>
  noteCount: number
  a4Hz: number
  rangeLabel: string
}

export interface TargetBar {
  id: string
  midi: number
  start: number
  end: number
  phase: 'demo' | 'sing'
  grade?: PracticeGrade | null
  provisionalGrade?: PracticeGrade | null
  label?: string
}

export interface GradeFeedbackPopup {
  id: number
  grade: PracticeGrade
  midi: number
  meanCents: number
  combo: number
  timestamp: number
}
