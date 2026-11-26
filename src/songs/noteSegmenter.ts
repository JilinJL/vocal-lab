import { frequencyToMidi } from '../audio/pitchMath'
import type { SongNote } from './types'

export interface OfflinePitchPoint {
  time: number
  frequency: number | null
  clarity: number
}

export interface SegmentOptions {
  a4Hz?: number
  minClarity?: number
  minNoteDurationSec?: number
  maxBridgeGapSec?: number
}

function medianOfWindow(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Convert monophonic offline pitch frames into discrete SongNote bars.
 */
export function segmentPitchFramesToNotes(
  points: OfflinePitchPoint[],
  options: SegmentOptions = {},
): SongNote[] {
  if (points.length === 0) return []

  const a4Hz = options.a4Hz ?? 440
  const minClarity = options.minClarity ?? 0.78
  const minNoteDurationSec = options.minNoteDurationSec ?? 0.12
  const maxBridgeGapSec = options.maxBridgeGapSec ?? 0.06

  // Step 1: Convert valid voiced points to integer MIDI with a 3-point median filter
  const rawMidis: Array<number | null> = points.map((p) => {
    if (p.frequency === null || p.clarity < minClarity) return null
    return frequencyToMidi(p.frequency, a4Hz)
  })

  const smoothedIntMidis: Array<number | null> = rawMidis.map((val, i) => {
    if (val === null) return null
    const windowVals: number[] = []
    for (let j = Math.max(0, i - 1); j <= Math.min(rawMidis.length - 1, i + 1); j++) {
      const neighbor = rawMidis[j]
      if (neighbor !== null && Math.abs(neighbor - val) <= 2.5) {
        windowVals.push(neighbor)
      }
    }
    const med = windowVals.length > 0 ? medianOfWindow(windowVals) : val
    return Math.round(med)
  })

  // Step 2: Group consecutive identical semitones into raw runs
  interface RawRun {
    midi: number
    start: number
    end: number
  }

  const runs: RawRun[] = []
  let active: RawRun | null = null
  const defaultStep =
    points.length >= 2 ? Math.max(0.01, points[1]!.time - points[0]!.time) : 0.025

  for (let i = 0; i < points.length; i++) {
    const midi = smoothedIntMidis[i]
    const t = points[i]!.time
    const nextT = i + 1 < points.length ? points[i + 1]!.time : t + defaultStep

    if (midi === null) {
      if (active) {
        runs.push(active)
        active = null
      }
      continue
    }

    if (active && active.midi === midi && t - active.end <= defaultStep * 1.5) {
      active.end = nextT
    } else {
      if (active) runs.push(active)
      active = { midi, start: t, end: nextT }
    }
  }
  if (active) runs.push(active)

  // Step 3: Bridge brief silence gaps between identical pitches
  const merged: RawRun[] = []
  for (const run of runs) {
    const prev = merged[merged.length - 1]
    if (prev && prev.midi === run.midi && run.start - prev.end <= maxBridgeGapSec) {
      prev.end = run.end
    } else {
      merged.push({ ...run })
    }
  }

  // Step 4: Drop transient glitches shorter than minNoteDurationSec
  const notes: SongNote[] = []
  for (const run of merged) {
    const duration = run.end - run.start
    if (duration < minNoteDurationSec) continue
    notes.push({
      id: `a-${notes.length}-${run.midi}`,
      start: Math.round(run.start * 1000) / 1000,
      duration: Math.round(duration * 1000) / 1000,
      midi: run.midi,
    })
  }

  return notes
}
