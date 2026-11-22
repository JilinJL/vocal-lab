import { midiToFrequency } from './pitchMath'

export type PianoTimbre = 'sampled' | 'rhodes' | 'sine'

const SAMPLE_NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

export function midiToSampleUrl(midi: number): string {
  const clamped = Math.max(21, Math.min(108, Math.round(midi)))
  const pc = ((clamped % 12) + 12) % 12
  const octave = Math.floor(clamped / 12) - 1
  const base = import.meta.env.BASE_URL || '/'
  return `${base}audio/piano/${SAMPLE_NOTE_NAMES[pc]}${octave}.mp3`
}

interface ActiveVoice {
  stop: (releaseTime?: number) => void
  midi: number
}

/**
 * Polyphonic Web Audio piano engine supporting:
 * 1. Real 88-key sampled acoustic piano MP3s (A0–C8, cached as decoded AudioBuffers, A4-tunable)
 * 2. Synthesized Warm Rhodes & Pure Sine reference tones
 */
export class PianoSynthesizer {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private voices = new Map<number, ActiveVoice>()
  private bufferCache = new Map<number, AudioBuffer>()
  private loadingPromises = new Map<number, Promise<AudioBuffer | null>>()
  private preloadedCore = false

  private volume = 0.72
  private timbre: PianoTimbre = 'sampled'
  private a4Hz = 440

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AudioCtx()
      this.compressor = this.ctx.createDynamicsCompressor()
      this.compressor.threshold.value = -14
      this.compressor.knee.value = 18
      this.compressor.ratio.value = 3.5
      this.compressor.attack.value = 0.003
      this.compressor.release.value = 0.18

      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = this.volume

      this.masterGain.connect(this.compressor)
      this.compressor.connect(this.ctx.destination)
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }

    if (!this.preloadedCore) {
      this.preloadedCore = true
      this.preloadRange(48, 72) // Gently warm C3–C5 singing range in background
    }

    return this.ctx
  }

  private async loadSampleBuffer(midi: number): Promise<AudioBuffer | null> {
    const key = Math.max(21, Math.min(108, Math.round(midi)))
    const cached = this.bufferCache.get(key)
    if (cached) return cached

    const inflight = this.loadingPromises.get(key)
    if (inflight) return inflight

    const ctx = this.ensureContext()
    const promise = (async () => {
      try {
        const response = await fetch(midiToSampleUrl(key))
        if (!response.ok) return null
        const arrayBuffer = await response.arrayBuffer()
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        this.bufferCache.set(key, decoded)
        return decoded
      } catch {
        return null
      } finally {
        this.loadingPromises.delete(key)
      }
    })()

    this.loadingPromises.set(key, promise)
    return promise
  }

  public preloadRange(minMidi: number, maxMidi: number): void {
    // Load quietly in small batches so initial playback stays snappy
    const targets: number[] = []
    for (let m = minMidi; m <= maxMidi; m++) {
      if (!this.bufferCache.has(m)) targets.push(m)
    }
    let cursor = 0
    const nextBatch = () => {
      if (!this.ctx || cursor >= targets.length) return
      const slice = targets.slice(cursor, cursor + 4)
      cursor += 4
      void Promise.all(slice.map((m) => this.loadSampleBuffer(m))).then(() => {
        window.setTimeout(nextBatch, 60)
      })
    }
    window.setTimeout(nextBatch, 120)
  }

  public setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value))
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02)
    }
  }

  public setTimbre(timbre: PianoTimbre): void {
    this.timbre = timbre
  }

  public setA4Hz(hz: number): void {
    this.a4Hz = hz
  }

  public noteOn(midi: number, options?: { sustain?: boolean; velocity?: number }): void {
    const ctx = this.ensureContext()
    if (!this.masterGain) return

    // Re-trigger cleanly if the same key is already sounding
    this.noteOff(midi, 0.04)

    const velocity = options?.velocity ?? 0.88
    const sustain = options?.sustain ?? false

    if (this.timbre === 'sampled') {
      const clampedMidi = Math.max(21, Math.min(108, Math.round(midi)))
      const cached = this.bufferCache.get(clampedMidi)
      if (cached) {
        this.playSampleBuffer(ctx, clampedMidi, cached, velocity, sustain)
      } else {
        // Track pending load: if user taps quickly during the ~15ms first decode,
        // still play the note with a natural release so the first click is always audible.
        let releasedEarly = false
        let replaced = false
        const pendingVoice: ActiveVoice = {
          midi,
          stop: (releaseTime?: number) => {
            if (releaseTime !== undefined && releaseTime <= 0.15) {
              replaced = true
            } else {
              releasedEarly = true
            }
            if (this.voices.get(midi) === pendingVoice) {
              this.voices.delete(midi)
            }
          },
        }
        this.voices.set(midi, pendingVoice)

        void this.loadSampleBuffer(clampedMidi).then((buffer) => {
          if (replaced || !this.ctx || !this.masterGain) return
          if (buffer) {
            this.playSampleBuffer(this.ctx, clampedMidi, buffer, velocity, sustain && !releasedEarly)
            if (releasedEarly && !sustain) {
              window.setTimeout(() => {
                this.noteOff(clampedMidi, 0.55)
              }, 160)
            }
          } else {
            this.playSynthVoice(this.ctx, midi, 'rhodes', velocity, sustain && !releasedEarly)
          }
        })
      }
      return
    }

    this.playSynthVoice(ctx, midi, this.timbre, velocity, sustain)
  }

  private playSampleBuffer(
    ctx: AudioContext,
    midi: number,
    buffer: AudioBuffer,
    velocity: number,
    sustain: boolean,
  ): void {
    if (!this.masterGain) return

    const now = ctx.currentTime
    const source = ctx.createBufferSource()
    source.buffer = buffer
    // Apply A4 calibration seamlessly via playbackRate (440 Hz = 1.0)
    source.playbackRate.setValueAtTime(this.a4Hz / 440, now)

    const voiceGain = ctx.createGain()
    voiceGain.gain.setValueAtTime(0.001, now)
    voiceGain.gain.linearRampToValueAtTime(0.95 * velocity, now + 0.004)

    source.connect(voiceGain)
    voiceGain.connect(this.masterGain)
    source.start(now)

    // In sustain-drone mode, add a subtle matched warm harmonic bed so reference pitch holds continuously
    let droneOsc: OscillatorNode | null = null
    let droneGain: GainNode | null = null
    if (sustain) {
      const freq = midiToFrequency(midi, this.a4Hz)
      droneOsc = ctx.createOscillator()
      droneOsc.type = 'sine'
      droneOsc.frequency.setValueAtTime(freq, now)

      droneGain = ctx.createGain()
      droneGain.gain.setValueAtTime(0.0001, now)
      droneGain.gain.setValueAtTime(0.0001, now + 0.35)
      droneGain.gain.linearRampToValueAtTime(0.2 * velocity, now + 1.45)

      droneOsc.connect(droneGain)
      droneGain.connect(this.masterGain)
      droneOsc.start(now)
    }

    let stopped = false

    const cleanup = () => {
      try {
        source.disconnect()
        voiceGain.disconnect()
        droneOsc?.disconnect()
        droneGain?.disconnect()
      } catch {
        // ignore already disconnected nodes
      }
    }

    const stop = (releaseTime = 0.42) => {
      if (stopped || !this.ctx) return
      stopped = true

      const stopAt = this.ctx.currentTime
      // Allow natural short piano tap ring when not forcibly muted
      const fade = Math.max(0.03, releaseTime)

      voiceGain.gain.cancelScheduledValues(stopAt)
      voiceGain.gain.setValueAtTime(Math.max(voiceGain.gain.value, 0.0001), stopAt)
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopAt + fade)

      if (droneGain && droneOsc) {
        droneGain.gain.cancelScheduledValues(stopAt)
        droneGain.gain.setValueAtTime(Math.max(droneGain.gain.value, 0.0001), stopAt)
        droneGain.gain.exponentialRampToValueAtTime(0.0001, stopAt + fade)
        try {
          droneOsc.stop(stopAt + fade + 0.03)
        } catch {
          // already stopped
        }
      }

      try {
        source.stop(stopAt + fade + 0.03)
      } catch {
        // already ended
      }

      window.setTimeout(cleanup, (fade + 0.08) * 1000)

      if (this.voices.get(midi) === voice) {
        this.voices.delete(midi)
      }
    }

    const voice: ActiveVoice = { stop, midi }
    this.voices.set(midi, voice)

    source.onended = () => {
      if (!sustain && !stopped) {
        stopped = true
        cleanup()
        if (this.voices.get(midi) === voice) {
          this.voices.delete(midi)
        }
      }
    }
  }

  private playSynthVoice(
    ctx: AudioContext,
    midi: number,
    mode: 'rhodes' | 'sine',
    velocity: number,
    sustain: boolean,
  ): void {
    if (!this.masterGain) return

    const now = ctx.currentTime
    const freq = midiToFrequency(midi, this.a4Hz)

    const voiceGain = ctx.createGain()
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'

    const oscillators: OscillatorNode[] = []
    const harmonicGains: GainNode[] = []

    if (mode === 'sine') {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now)

      filter.frequency.setValueAtTime(16000, now)
      osc.connect(filter)
      oscillators.push(osc)

      voiceGain.gain.setValueAtTime(0.0001, now)
      voiceGain.gain.linearRampToValueAtTime(0.38 * velocity, now + 0.015)
      if (!sustain) {
        voiceGain.gain.exponentialRampToValueAtTime(0.24 * velocity, now + 0.4)
        voiceGain.gain.exponentialRampToValueAtTime(0.0008, now + 3.2)
      }
    } else {
      const partials: Array<{ ratio: number; type: OscillatorType; amp: number; detune: number }> = [
        { ratio: 1, type: 'sine', amp: 0.72, detune: 0 },
        { ratio: 2, type: 'sine', amp: 0.22, detune: 1.5 },
        { ratio: 3, type: 'triangle', amp: 0.08, detune: -1.5 },
        { ratio: 6.02, type: 'sine', amp: 0.04, detune: 0 },
      ]

      filter.frequency.setValueAtTime(Math.min(7200, freq * 8), now)
      filter.frequency.exponentialRampToValueAtTime(Math.max(900, freq * 2.5), now + 0.65)
      filter.Q.value = 0.8

      for (const p of partials) {
        const osc = ctx.createOscillator()
        const g = ctx.createGain()
        osc.type = p.type
        osc.frequency.setValueAtTime(freq * p.ratio, now)
        osc.detune.setValueAtTime(p.detune, now)

        g.gain.setValueAtTime(p.amp, now)
        if (p.ratio >= 3) {
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
        }
        osc.connect(g)
        g.connect(filter)
        oscillators.push(osc)
        harmonicGains.push(g)
      }

      voiceGain.gain.setValueAtTime(0.0001, now)
      voiceGain.gain.linearRampToValueAtTime(0.36 * velocity, now + 0.008)
      if (sustain) {
        voiceGain.gain.exponentialRampToValueAtTime(0.22 * velocity, now + 0.6)
      } else {
        voiceGain.gain.exponentialRampToValueAtTime(0.18 * velocity, now + 0.5)
        voiceGain.gain.exponentialRampToValueAtTime(0.0006, now + 3.8)
      }
    }

    filter.connect(voiceGain)
    voiceGain.connect(this.masterGain)

    for (const osc of oscillators) {
      osc.start(now)
    }

    let stopped = false
    let cleanupTimer: number | null = null

    const stop = (releaseTime = 0.28) => {
      if (stopped || !this.ctx) return
      stopped = true
      if (cleanupTimer !== null) {
        window.clearTimeout(cleanupTimer)
      }

      const stopAt = this.ctx.currentTime
      voiceGain.gain.cancelScheduledValues(stopAt)
      voiceGain.gain.setValueAtTime(Math.max(voiceGain.gain.value, 0.0001), stopAt)
      voiceGain.gain.exponentialRampToValueAtTime(0.0001, stopAt + releaseTime)

      const end = stopAt + releaseTime + 0.03
      for (const osc of oscillators) {
        try {
          osc.stop(end)
        } catch {
          // already stopped
        }
      }

      window.setTimeout(() => {
        voiceGain.disconnect()
        filter.disconnect()
        for (const g of harmonicGains) g.disconnect()
      }, (releaseTime + 0.08) * 1000)

      if (this.voices.get(midi) === voice) {
        this.voices.delete(midi)
      }
    }

    const voice: ActiveVoice = { stop, midi }
    this.voices.set(midi, voice)

    if (!sustain) {
      cleanupTimer = window.setTimeout(() => {
        stop(0.18)
      }, 3900)
    }
  }

  public noteOff(midi: number, releaseTime = 0.45): void {
    const voice = this.voices.get(midi)
    if (voice) {
      voice.stop(releaseTime)
    }
  }

  public stopAll(): void {
    for (const voice of Array.from(this.voices.values())) {
      voice.stop(0.14)
    }
    this.voices.clear()
  }

  public dispose(): void {
    this.stopAll()
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
      this.masterGain = null
      this.compressor = null
    }
  }
}
