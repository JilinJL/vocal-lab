import { ensureAudioContextRunning, getSharedAudioContext } from '../engine/audioContext'
import { isNativeAudioActive, VocalLabAudio } from '../engine/nativeAudioPlugin'
import type { DrumSoundId } from './types'

const SOUND_TO_NATIVE: Record<DrumSoundId, number> = {
  pulse: 0,
  sub: 1,
  kick: 2,
  snare: 3,
  hat: 4,
  fill: 5,
}

function velocityGain(level: number): number {
  if (level === 3) return 0.34
  if (level === 2) return 0.66
  return 1.0
}

/**
 * Dual-backend drum & metronome synthesizer:
 * - On Android native app: delegates sample-accurate hits to C++17 / Oboe DrumSynth.
 * - On Web / iOS / Desktop: renders crisp Web Audio percussion through the shared AudioContext.
 */
export class DrumSynthesizer {
  private ctx: AudioContext | null = null
  private masterGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private noiseBuf: AudioBuffer | null = null
  private volume = 0.92

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1.2, vol))
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015)
    }
  }

  private ensureWebBus(): AudioContext {
    const shared = getSharedAudioContext()
    if (this.ctx !== shared || !this.masterGain || !this.compressor) {
      this.ctx = shared
      this.compressor = this.ctx.createDynamicsCompressor()
      this.compressor.threshold.value = -8
      this.compressor.knee.value = 10
      this.compressor.ratio.value = 4
      this.compressor.attack.value = 0.002
      this.compressor.release.value = 0.12

      this.masterGain = this.ctx.createGain()
      this.masterGain.gain.value = this.volume
      this.masterGain.connect(this.compressor)
      this.compressor.connect(this.ctx.destination)
      this.noiseBuf = null
    }
    void ensureAudioContextRunning()
    return this.ctx
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf || this.noiseBuf.sampleRate !== ctx.sampleRate) {
      const len = Math.floor(ctx.sampleRate * 0.35)
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = this.noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1
      }
    }
    return this.noiseBuf
  }

  public scheduleHit(
    sound: DrumSoundId,
    startTime: number,
    velocityLevel: number,
    volumeMultiplier = 1,
  ): void {
    const clampedVel = Math.max(1, Math.min(3, Math.round(velocityLevel)))
    const effectiveVol = Math.max(0.05, Math.min(1.4, this.volume * volumeMultiplier))

    if (isNativeAudioActive()) {
      void VocalLabAudio.scheduleDrum({
        sound: SOUND_TO_NATIVE[sound],
        startTime,
        velocityLevel: clampedVel,
        volume: effectiveVol,
      }).catch(() => {})
      return
    }

    const ctx = this.ensureWebBus()
    const dest = this.masterGain
    if (!dest) return
    const t = Math.max(ctx.currentTime + 0.002, startTime)

    switch (sound) {
      case 'pulse':
        this.playPulse(ctx, dest, t, clampedVel, volumeMultiplier)
        break
      case 'sub':
        this.playSub(ctx, dest, t, clampedVel, volumeMultiplier)
        break
      case 'kick':
        this.playKick(ctx, dest, t, clampedVel, volumeMultiplier)
        break
      case 'snare':
        this.playSnare(ctx, dest, t, clampedVel, volumeMultiplier)
        break
      case 'hat':
        this.playHat(ctx, dest, t, clampedVel, volumeMultiplier)
        break
      case 'fill':
        this.playFill(ctx, dest, t, clampedVel, volumeMultiplier)
        break
    }
  }

  public cancelAll(): void {
    if (isNativeAudioActive()) {
      void VocalLabAudio.cancelScheduledDrums().catch(() => {})
    }
  }

  private playPulse(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    accentLevel: number,
    volMul: number,
  ): void {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    const freq = accentLevel === 3 ? 1980 : accentLevel === 2 ? 1560 : 1280
    const amp = (accentLevel === 3 ? 0.42 : accentLevel === 2 ? 0.28 : 0.18) * volMul
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, amp), t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.042)
    osc.connect(g)
    g.connect(dest)
    osc.start(t)
    osc.stop(t + 0.055)
  }

  private playSub(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    vel: number,
    volMul: number,
  ): void {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(920, t)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.14 * velocityGain(vel) * volMul), t + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.028)
    osc.connect(g)
    g.connect(dest)
    osc.start(t)
    osc.stop(t + 0.04)
  }

  private playKick(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    vel: number,
    volMul: number,
  ): void {
    const k = velocityGain(vel) * volMul
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    const hi = vel === 3 ? 118 : vel === 2 ? 138 : 165
    const lo = vel === 3 ? 52 : 44
    osc.type = 'sine'
    osc.frequency.setValueAtTime(hi, t)
    osc.frequency.exponentialRampToValueAtTime(lo, t + 0.1)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, 1.05 * k), t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.21)
    osc.connect(g)
    g.connect(dest)
    osc.start(t)
    osc.stop(t + 0.23)
  }

  private playSnare(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    vel: number,
    volMul: number,
  ): void {
    const k = velocityGain(vel) * volMul
    const src = ctx.createBufferSource()
    src.buffer = this.getNoiseBuffer(ctx)
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = vel === 3 ? 2400 : 1900
    bp.Q.value = 0.65
    const g = ctx.createGain()
    g.gain.setValueAtTime(Math.max(0.001, 0.56 * k), t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13)
    src.connect(bp)
    bp.connect(g)
    g.connect(dest)
    src.start(t)
    src.stop(t + 0.15)

    const osc = ctx.createOscillator()
    const og = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(vel === 3 ? 240 : 198, t)
    og.gain.setValueAtTime(Math.max(0.001, 0.3 * k), t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.075)
    osc.connect(og)
    og.connect(dest)
    osc.start(t)
    osc.stop(t + 0.095)
  }

  private playHat(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    vel: number,
    volMul: number,
  ): void {
    const k = velocityGain(vel) * volMul
    const src = ctx.createBufferSource()
    src.buffer = this.getNoiseBuffer(ctx)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = vel === 3 ? 9200 : 7600
    const g = ctx.createGain()
    g.gain.setValueAtTime(Math.max(0.001, 0.24 * k), t)
    g.gain.exponentialRampToValueAtTime(0.0008, t + (vel === 3 ? 0.026 : 0.048))
    src.connect(hp)
    hp.connect(g)
    g.connect(dest)
    src.start(t)
    src.stop(t + 0.065)
  }

  private playFill(
    ctx: AudioContext,
    dest: AudioNode,
    t: number,
    vel: number,
    volMul: number,
  ): void {
    const k = velocityGain(vel) * volMul
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(vel === 3 ? 260 : 330, t)
    osc.frequency.exponentialRampToValueAtTime(105, t + 0.1)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, 0.72 * k), t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    osc.connect(g)
    g.connect(dest)
    osc.start(t)
    osc.stop(t + 0.17)
  }
}
