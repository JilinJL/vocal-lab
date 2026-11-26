import { describe, expect, it } from 'vitest'
import { detectPitchYin } from '../yinDetector'

function makeSine(freq: number, sampleRate: number, length = 4096, amp = 0.28): Float32Array {
  return Float32Array.from({ length }, (_, idx) => amp * Math.sin((2 * Math.PI * freq * idx) / sampleRate))
}

function makeHarmonicVoice(freq: number, sampleRate: number, length = 4096): Float32Array {
  return Float32Array.from({ length }, (_, idx) => {
    const t = idx / sampleRate
    return (
      0.22 * Math.sin(2 * Math.PI * freq * t) +
      0.12 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.06 * Math.sin(2 * Math.PI * freq * 3 * t)
    )
  })
}

describe('detectPitchYin', () => {
  it('tracks pure sines across vocal range within 5 cents at 44.1kHz and 48kHz', () => {
    for (const sampleRate of [44100, 48000]) {
      for (const freq of [82.41, 130.81, 220, 440, 880, 1046.5]) {
        const res = detectPitchYin(makeSine(freq, sampleRate), sampleRate)
        expect(res.frequency).not.toBeNull()
        const cents = 1200 * Math.log2(res.frequency! / freq)
        expect(Math.abs(cents)).toBeLessThan(5)
        expect(res.clarity).toBeGreaterThan(0.85)
      }
    }
  })

  it('tracks harmonic-rich vocal waveforms without octave errors', () => {
    for (const freq of [146.83, 261.63, 392.0, 523.25]) {
      const res = detectPitchYin(makeHarmonicVoice(freq, 48000), 48000)
      expect(res.frequency).not.toBeNull()
      const cents = 1200 * Math.log2(res.frequency! / freq)
      expect(Math.abs(cents)).toBeLessThan(5)
    }
  })

  it('returns null for silence and below-threshold noise', () => {
    const silence = new Float32Array(4096)
    expect(detectPitchYin(silence, 48000).frequency).toBeNull()

    const quiet = makeSine(440, 48000, 4096, 0.002)
    expect(detectPitchYin(quiet, 48000).frequency).toBeNull()
  })
})
