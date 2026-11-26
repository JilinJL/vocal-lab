import { reactive, watch } from 'vue'
import type { PianoTimbre } from '../audio/pianoSynth'

export type PracticePattern =
  | 'chromatic-up'
  | 'chromatic-down'
  | 'chromatic-up-down'
  | 'major-scale'
  | 'pentatonic'
  | 'intervals-3rd'
  | 'intervals-5th'
  | 'random'

export type PracticeSpeed = 'slow' | 'normal' | 'fast'
export type PracticeListenMode = 'listen-then-sing' | 'simultaneous'
export type PracticeStrictness = 'relaxed' | 'standard' | 'strict'

export interface VocalLabSettings {
  a4Hz: number
  windowSeconds: number
  autoFollow: boolean
  timbre: PianoTimbre
  volume: number
  showKeyShortcuts: boolean
  practiceRangeMin: number
  practiceRangeMax: number
  practicePattern: PracticePattern
  practiceSpeed: PracticeSpeed
  practiceListenMode: PracticeListenMode
  practiceStrictness: PracticeStrictness
  allowOctaveTolerance: boolean
  latencyOffsetMs: number
}

const STORAGE_KEY = 'vocallab:settings:v1'

const DEFAULT_SETTINGS: VocalLabSettings = {
  a4Hz: 440,
  windowSeconds: 12,
  autoFollow: true,
  timbre: 'sampled',
  volume: 0.76,
  showKeyShortcuts: true,
  practiceRangeMin: 57, // A3
  practiceRangeMax: 64, // E4
  practicePattern: 'chromatic-up',
  practiceSpeed: 'normal',
  practiceListenMode: 'listen-then-sing',
  practiceStrictness: 'standard',
  allowOctaveTolerance: false,
  latencyOffsetMs: 0,
}

const VALID_TIMBRES = new Set<PianoTimbre>(['sampled', 'rhodes', 'sine'])
const VALID_WINDOWS = new Set<number>([6, 12, 24])
const VALID_PATTERNS = new Set<PracticePattern>([
  'chromatic-up',
  'chromatic-down',
  'chromatic-up-down',
  'major-scale',
  'pentatonic',
  'intervals-3rd',
  'intervals-5th',
  'random',
])
const VALID_SPEEDS = new Set<PracticeSpeed>(['slow', 'normal', 'fast'])
const VALID_LISTEN_MODES = new Set<PracticeListenMode>(['listen-then-sing', 'simultaneous'])
const VALID_STRICTNESS = new Set<PracticeStrictness>(['relaxed', 'standard', 'strict'])

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function loadStoredSettings(): VocalLabSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<VocalLabSettings>
    const minMidi =
      typeof parsed.practiceRangeMin === 'number' && Number.isFinite(parsed.practiceRangeMin)
        ? clamp(Math.round(parsed.practiceRangeMin), 36, 84)
        : DEFAULT_SETTINGS.practiceRangeMin
    const maxMidi =
      typeof parsed.practiceRangeMax === 'number' && Number.isFinite(parsed.practiceRangeMax)
        ? clamp(Math.round(parsed.practiceRangeMax), 36, 84)
        : DEFAULT_SETTINGS.practiceRangeMax

    return {
      a4Hz:
        typeof parsed.a4Hz === 'number' && Number.isFinite(parsed.a4Hz)
          ? clamp(Math.round(parsed.a4Hz), 432, 446)
          : DEFAULT_SETTINGS.a4Hz,
      windowSeconds:
        typeof parsed.windowSeconds === 'number' && VALID_WINDOWS.has(parsed.windowSeconds)
          ? parsed.windowSeconds
          : DEFAULT_SETTINGS.windowSeconds,
      autoFollow:
        typeof parsed.autoFollow === 'boolean' ? parsed.autoFollow : DEFAULT_SETTINGS.autoFollow,
      timbre:
        typeof parsed.timbre === 'string' && VALID_TIMBRES.has(parsed.timbre as PianoTimbre)
          ? (parsed.timbre as PianoTimbre)
          : DEFAULT_SETTINGS.timbre,
      volume:
        typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
          ? clamp(parsed.volume, 0, 1)
          : DEFAULT_SETTINGS.volume,
      showKeyShortcuts:
        typeof parsed.showKeyShortcuts === 'boolean'
          ? parsed.showKeyShortcuts
          : DEFAULT_SETTINGS.showKeyShortcuts,
      practiceRangeMin: Math.min(minMidi, maxMidi),
      practiceRangeMax: Math.max(minMidi, maxMidi),
      practicePattern:
        typeof parsed.practicePattern === 'string' &&
        VALID_PATTERNS.has(parsed.practicePattern as PracticePattern)
          ? (parsed.practicePattern as PracticePattern)
          : DEFAULT_SETTINGS.practicePattern,
      practiceSpeed:
        typeof parsed.practiceSpeed === 'string' &&
        VALID_SPEEDS.has(parsed.practiceSpeed as PracticeSpeed)
          ? (parsed.practiceSpeed as PracticeSpeed)
          : DEFAULT_SETTINGS.practiceSpeed,
      practiceListenMode:
        typeof parsed.practiceListenMode === 'string' &&
        VALID_LISTEN_MODES.has(parsed.practiceListenMode as PracticeListenMode)
          ? (parsed.practiceListenMode as PracticeListenMode)
          : DEFAULT_SETTINGS.practiceListenMode,
      practiceStrictness:
        typeof parsed.practiceStrictness === 'string' &&
        VALID_STRICTNESS.has(parsed.practiceStrictness as PracticeStrictness)
          ? (parsed.practiceStrictness as PracticeStrictness)
          : DEFAULT_SETTINGS.practiceStrictness,
      allowOctaveTolerance:
        typeof parsed.allowOctaveTolerance === 'boolean'
          ? parsed.allowOctaveTolerance
          : DEFAULT_SETTINGS.allowOctaveTolerance,
      latencyOffsetMs:
        typeof parsed.latencyOffsetMs === 'number' && Number.isFinite(parsed.latencyOffsetMs)
          ? clamp(Math.round(parsed.latencyOffsetMs), -250, 350)
          : DEFAULT_SETTINGS.latencyOffsetMs,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let singletonSettings: VocalLabSettings | null = null

export function useSettings(): VocalLabSettings {
  if (!singletonSettings) {
    singletonSettings = reactive(loadStoredSettings())
    watch(
      singletonSettings,
      (next) => {
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          // ignore quota or private mode failures
        }
      },
      { deep: true },
    )
  }
  return singletonSettings
}
