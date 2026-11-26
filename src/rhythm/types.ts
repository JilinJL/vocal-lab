export type MeterId = '4/4' | '3/4' | '2/4' | '6/8'
export type RhythmSubView = 'beat' | 'groove' | 'game'
export type DrumLayer = 'kick' | 'snare' | 'hat' | 'fill'
export type DrumSoundId = 'pulse' | 'sub' | 'kick' | 'snare' | 'hat' | 'fill'
export type VelocityLevel = 0 | 1 | 2 | 3 // 0=off, 1=heavy, 2=medium, 3=light
export type GrooveCategory = '流行' | '摇滚' | '律动' | '舞曲' | '三拍' | '自定义'

export interface MeterSpec {
  id: MeterId
  label: string
  beats: number
  grooveSub: number // grid steps per beat in groove mode
  pulse: readonly number[] // 3=strong, 2=medium, 1=weak
}

export interface GroovePatternData {
  kick: VelocityLevel[]
  snare: VelocityLevel[]
  hat: VelocityLevel[]
  fill: VelocityLevel[]
}

export interface GroovePreset {
  id: string
  category: GrooveCategory
  name: string
  desc: string
  bpm: number
  meter: MeterId
  swing: number
  kick: string
  snare: string
  hat: string
  fill: string
  tip: string
}

export interface BasicBeatPreset {
  id: string
  name: string
  desc: string
  bpm: number
  meter: MeterId
  subdivision: 1 | 2 | 3 | 4
  tip: string
}

export type RhythmGameTargetMode = 'beat' | 'kick' | 'snare' | 'backbone'
export type RhythmGrade = 'perfect' | 'great' | 'good' | 'miss'
export type RhythmGameStatus = 'idle' | 'countdown' | 'running' | 'finished'

export interface RhythmGameChallenge {
  id: string
  name: string
  desc: string
  grooveId: string
  bpm: number
  bars: number
  targetMode: RhythmGameTargetMode
  blindBars: boolean // true: alternate 2 audible bars + 2 muted-drum blind bars
}

export interface RhythmHitTarget {
  id: number
  barIndex: number
  stepIndex: number
  expectedTime: number
  layer: 'beat' | 'kick' | 'snare'
  accent: number // 3=strong, 2=medium, 1=light
  blind: boolean
  judged: boolean
  grade?: RhythmGrade
  offsetMs?: number // negative = early (抢拍), positive = late (拖拍)
}

export interface RhythmHitResult {
  targetId: number
  grade: RhythmGrade
  offsetMs: number
  layer: 'beat' | 'kick' | 'snare'
  blind: boolean
}

export interface RhythmGradePopup {
  id: number
  grade: RhythmGrade
  offsetMs: number | null
  combo: number
  createdAt: number
}

export interface RhythmGameSummary {
  score: number
  totalTargets: number
  perfectCount: number
  greatCount: number
  goodCount: number
  missCount: number
  maxCombo: number
  avgOffsetMs: number // negative=抢拍, positive=拖拍
  stabilityMs: number // std-dev of timing offset
}

export interface RhythmGameRecord {
  id: string
  timestamp: number
  challengeName: string
  bpm: number
  meter: MeterId
  targetMode: RhythmGameTargetMode
  blindBars: boolean
  score: number
  maxCombo: number
  avgOffsetMs: number
  stabilityMs: number
}
