import { describe, expect, it } from 'vitest'
import { midiToFrequency } from '../pitchMath'
import { PitchStabilizer } from '../pitchStabilizer'

describe('PitchStabilizer', () => {
  it('rejects isolated 1-2 frame octave spikes and keeps pitch locked', () => {
    const stab = new PitchStabilizer()
    const fC4 = midiToFrequency(60, 440)
    const fC5 = midiToFrequency(72, 440)

    const outputs: Array<number | null> = []
    for (let i = 0; i < 8; i++) {
      const freq = i === 4 || i === 5 ? fC5 : fC4
      const res = stab.process({ time: i * 0.02, frequency: freq, clarity: 0.9, rms: 0.05 }, 440)
      outputs.push(res.midi)
    }

    for (const m of outputs) {
      expect(m).not.toBeNull()
      expect(Math.abs(m! - 60)).toBeLessThan(0.2)
    }
  })

  it('confirms a genuine sustained octave leap after 3 consistent frames', () => {
    const stab = new PitchStabilizer()
    const fC4 = midiToFrequency(60, 440)
    const fC5 = midiToFrequency(72, 440)

    for (let i = 0; i < 4; i++) {
      stab.process({ time: i * 0.02, frequency: fC4, clarity: 0.92, rms: 0.05 }, 440)
    }
    let latestMidi: number | null = null
    for (let i = 4; i < 8; i++) {
      const res = stab.process({ time: i * 0.02, frequency: fC5, clarity: 0.92, rms: 0.05 }, 440)
      latestMidi = res.midi
    }

    expect(latestMidi).not.toBeNull()
    expect(Math.abs(latestMidi! - 72)).toBeLessThan(0.15)
  })

  it('coasts smoothly across a 1-frame clarity dip while voice energy persists, and drops on silence', () => {
    const stab = new PitchStabilizer()
    const fA3 = midiToFrequency(57, 440)

    stab.process({ time: 0.0, frequency: fA3, clarity: 0.85, rms: 0.04 }, 440)
    stab.process({ time: 0.02, frequency: fA3, clarity: 0.84, rms: 0.04 }, 440)

    // 1-frame clarity drop while singer still has vocal energy
    const dip = stab.process({ time: 0.04, frequency: null, clarity: 0.35, rms: 0.02 }, 440)
    expect(dip.midi).not.toBeNull()
    expect(dip.coasted).toBe(true)
    expect(Math.abs(dip.midi! - 57)).toBeLessThan(0.1)

    // True silence (very low RMS) immediately drops to unvoiced
    const silent = stab.process({ time: 0.06, frequency: null, clarity: 0, rms: 0.0005 }, 440)
    expect(silent.midi).toBeNull()
    expect(silent.frequency).toBeNull()
  })

  it('dampens high-frequency jitter while tracking scale steps smoothly', () => {
    const stab = new PitchStabilizer()
    const jitterOffsets = [0, 0.28, -0.25, 0.22, -0.24, 0.18, -0.15, 0.1]
    const tracked: number[] = []

    for (let i = 0; i < jitterOffsets.length; i++) {
      const freq = midiToFrequency(60 + jitterOffsets[i]!, 440)
      const res = stab.process({ time: i * 0.02, frequency: freq, clarity: 0.88, rms: 0.05 }, 440)
      tracked.push(res.midi!)
    }
    // Jitter amplitude should be significantly smaller than raw ±0.28 semitones
    const maxDev = Math.max(...tracked.slice(2).map((m) => Math.abs(m - 60)))
    expect(maxDev).toBeLessThan(0.15)
  })
})
