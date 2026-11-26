import { describe, expect, it } from 'vitest'
import {
  computeSwingOffsetSec,
  findGrooveById,
  getGrooveCellCount,
  grooveToPatternData,
  parseVelocityString,
} from '../grooves'
import {
  formatTimingBias,
  judgeTimingOffset,
  summarizeRhythmResults,
} from '../scoring'
import type { RhythmHitResult } from '../types'

describe('rhythm grooves & meters', () => {
  it('computes correct step counts for each meter', () => {
    expect(getGrooveCellCount('4/4')).toBe(16)
    expect(getGrooveCellCount('3/4')).toBe(12)
    expect(getGrooveCellCount('2/4')).toBe(8)
    expect(getGrooveCellCount('6/8')).toBe(12)
  })

  it('parses velocity strings faithfully into 0..3 levels', () => {
    const parsed = parseVelocityString('4/4', '1002003010000000')
    expect(parsed.length).toBe(16)
    expect(parsed[0]).toBe(1)
    expect(parsed[3]).toBe(2)
    expect(parsed[6]).toBe(3)
    expect(parsed[8]).toBe(1)
  })

  it('applies swing delay only to offbeat eighth steps (pos % 4 === 2)', () => {
    const bpm = 120 // beat = 0.5s
    expect(computeSwingOffsetSec(0, 4, bpm, 0.66)).toBe(0)
    expect(computeSwingOffsetSec(1, 4, bpm, 0.66)).toBe(0)
    expect(computeSwingOffsetSec(2, 4, bpm, 0.66)).toBeCloseTo(0.08, 4)
    expect(computeSwingOffsetSec(2, 4, bpm, 0.5)).toBe(0)
    expect(computeSwingOffsetSec(2, 2, bpm, 0.66)).toBe(0)
  })

  it('loads classic custom dongda groove cleanly', () => {
    const preset = findGrooveById('custom-dongda')
    const data = grooveToPatternData(preset)
    expect(data.kick[0]).toBe(1)
    expect(data.kick[8]).toBe(1)
    expect(data.kick[11]).toBe(3)
    expect(data.snare[4]).toBe(1)
    expect(data.snare[12]).toBe(1)
  })
})

describe('rhythm game timing judgment & summary', () => {
  it('grades timing offsets accurately across thresholds', () => {
    expect(judgeTimingOffset(0)).toBe('perfect')
    expect(judgeTimingOffset(-36)).toBe('perfect')
    expect(judgeTimingOffset(40)).toBe('great')
    expect(judgeTimingOffset(-72)).toBe('great')
    expect(judgeTimingOffset(95)).toBe('good')
    expect(judgeTimingOffset(-125)).toBe('miss')
  })

  it('formats early/late timing bias labels', () => {
    expect(formatTimingBias(-5)).toBe('稳准')
    expect(formatTimingBias(-28)).toBe('偏抢 28ms')
    expect(formatTimingBias(34)).toBe('偏拖 +34ms')
  })

  it('summarizes score, counts, average bias, and stability', () => {
    const results: RhythmHitResult[] = [
      { targetId: 1, grade: 'perfect', offsetMs: -10, layer: 'beat', blind: false },
      { targetId: 2, grade: 'perfect', offsetMs: 10, layer: 'beat', blind: false },
      { targetId: 3, grade: 'great', offsetMs: 50, layer: 'beat', blind: false },
      { targetId: 4, grade: 'miss', offsetMs: 165, layer: 'beat', blind: true },
    ]
    const summary = summarizeRhythmResults(results, 4, 3)
    expect(summary.score).toBe(70) // (100+100+80+0)/4
    expect(summary.perfectCount).toBe(2)
    expect(summary.greatCount).toBe(1)
    expect(summary.missCount).toBe(1)
    expect(summary.maxCombo).toBe(3)
    expect(summary.avgOffsetMs).toBe(17) // (-10+10+50)/3 ≈ 16.67
    expect(summary.stabilityMs).toBeGreaterThan(20)
  })
})
