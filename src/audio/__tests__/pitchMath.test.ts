import { describe, expect, it } from 'vitest'
import {
  describePitchFromFrequency,
  formatCents,
  formatTimestamp,
  frequencyToMidi,
  midiToFrequency,
} from '../pitchMath'

describe('pitchMath', () => {
  it('maps 440Hz to A4 with 0 cents at A4=440', () => {
    const info = describePitchFromFrequency(440, 440)
    expect(info.fullName).toBe('A4')
    expect(info.nearestMidi).toBe(69)
    expect(info.cents).toBe(0)
    expect(info.solfege).toBe('La')
  })

  it('inverts frequencyToMidi and midiToFrequency across vocal range and A4 calibrations', () => {
    for (const a4 of [432, 440, 446]) {
      for (const midi of [36, 48, 57, 60, 69, 72, 84]) {
        const freq = midiToFrequency(midi, a4)
        expect(frequencyToMidi(freq, a4)).toBeCloseTo(midi, 6)
      }
    }
  })

  it('adjusts pitch description when A4 calibration changes', () => {
    const info = describePitchFromFrequency(432, 432)
    expect(info.fullName).toBe('A4')
    expect(info.cents).toBe(0)

    const flatAt440 = describePitchFromFrequency(432, 440)
    expect(flatAt440.cents).toBeLessThan(-25)
  })

  it('formats cents and timestamps cleanly', () => {
    expect(formatCents(0)).toBe('0¢')
    expect(formatCents(14)).toBe('+14¢')
    expect(formatCents(-9)).toBe('-9¢')
    expect(formatTimestamp(65.4)).toBe('01:05.4')
  })
})
