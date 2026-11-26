import { describe, expect, it } from 'vitest'
import { buildPracticeTimeline, generatePracticeSequence } from '../sequences'

describe('practice sequences', () => {
  it('generates chromatic up, down, and up-down sequences', () => {
    expect(generatePracticeSequence(57, 60, 'chromatic-up')).toEqual([57, 58, 59, 60])
    expect(generatePracticeSequence(57, 60, 'chromatic-down')).toEqual([60, 59, 58, 57])
    expect(generatePracticeSequence(57, 59, 'chromatic-up-down')).toEqual([57, 58, 59, 58, 57])
  })

  it('handles single-note range gracefully', () => {
    expect(generatePracticeSequence(60, 60, 'major-scale')).toEqual([60])
    expect(generatePracticeSequence(60, 60, 'random')).toEqual([60])
  })

  it('generates major and pentatonic scales anchored on minMidi', () => {
    expect(generatePracticeSequence(60, 72, 'major-scale')).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
    expect(generatePracticeSequence(60, 72, 'pentatonic')).toEqual([60, 62, 64, 67, 69, 72])
  })

  it('builds non-overlapping demo and sing windows in listen-then-sing mode', () => {
    const timeline = buildPracticeTimeline([57, 59], 'normal', 'listen-then-sing')
    expect(timeline).toHaveLength(2)
    expect(timeline[0]!.singStart).toBeGreaterThan(timeline[0]!.demoEnd)
    expect(timeline[1]!.demoStart).toBeGreaterThan(timeline[0]!.singEnd)
  })
})
