import type { PluginListenerHandle } from '@capacitor/core'
import { detectPitchYin } from '../audio/yinDetector'
import { ensureAudioContextRunning, getSharedAudioContext } from './audioContext'
import {
  isNativeAudioActive,
  updateNativeClockAnchor,
  VocalLabAudio,
} from './nativeAudioPlugin'

export interface PitchFrame {
  /** AudioContext timestamp (seconds) centered on the analyzed buffer */
  time: number
  /** Fundamental frequency in Hz, or null when unvoiced / silent */
  frequency: number | null
  /** Periodic clarity 0..1 */
  clarity: number
  /** Signal RMS energy */
  rms: number
}

export type PitchEngineListener = (frame: PitchFrame) => void
export type PitchEngineErrorListener = (message: string) => void

export interface PitchEngineOptions {
  fftSize?: number
  minIntervalMs?: number
  minFrequency?: number
  maxFrequency?: number
}

export class PitchEngine {
  private mediaStream: MediaStream | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private timeDomainBuffer: Float32Array<ArrayBuffer> | null = null
  private rafId: number | null = null
  private nativeListener: PluginListenerHandle | null = null
  private running = false
  private starting = false
  private sessionToken = 0
  private lastEmitPerf = 0

  private readonly fftSize: number
  private readonly minIntervalMs: number
  private minFrequency: number
  private maxFrequency: number

  private readonly frameListeners = new Set<PitchEngineListener>()
  private readonly errorListeners = new Set<PitchEngineErrorListener>()
  private readonly stateListeners = new Set<(active: boolean) => void>()

  constructor(options: PitchEngineOptions = {}) {
    this.fftSize = options.fftSize ?? 4096
    this.minIntervalMs = options.minIntervalMs ?? 20
    this.minFrequency = options.minFrequency ?? 60
    this.maxFrequency = options.maxFrequency ?? 1250
  }

  public isRunning(): boolean {
    return this.running
  }

  public isStarting(): boolean {
    return this.starting
  }

  public setFrequencyBounds(minFrequency: number, maxFrequency: number): void {
    this.minFrequency = Math.max(40, minFrequency)
    this.maxFrequency = Math.min(2400, maxFrequency)
  }

  public subscribe(listener: PitchEngineListener): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  public onError(listener: PitchEngineErrorListener): () => void {
    this.errorListeners.add(listener)
    return () => {
      this.errorListeners.delete(listener)
    }
  }

  public onStateChange(listener: (active: boolean) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener(message)
    }
  }

  private emitState(active: boolean): void {
    for (const listener of this.stateListeners) {
      listener(active)
    }
  }

  public async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.running) return { ok: true }
    if (this.starting) return { ok: false }

    if (isNativeAudioActive()) {
      return this.startNative()
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      const message = '当前浏览器不支持麦克风访问，请在 HTTPS 或 localhost 环境下使用现代浏览器。'
      this.emitError(message)
      return { ok: false, error: message }
    }

    const token = ++this.sessionToken
    this.starting = true

    try {
      // Create and resume shared AudioContext synchronously inside user gesture
      const ctx = getSharedAudioContext()
      const resumePromise = ensureAudioContextRunning()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })

      // Cancelled or replaced while waiting for permission
      if (token !== this.sessionToken) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return { ok: false }
      }

      await resumePromise

      if (token !== this.sessionToken) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
        return { ok: false }
      }

      this.mediaStream = stream
      this.sourceNode = ctx.createMediaStreamSource(stream)
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = this.fftSize
      this.analyser.smoothingTimeConstant = 0
      this.sourceNode.connect(this.analyser)
      this.timeDomainBuffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))

      // Handle microphone disconnect / OS interruption cleanly
      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (token === this.sessionToken && this.running) {
            this.stop()
            this.emitError('麦克风输入已断开或被系统中断，请重新开启检测。')
          }
        }
      }

      this.running = true
      this.starting = false
      this.lastEmitPerf = 0
      this.emitState(true)

      const tick = (now: number) => {
        if (!this.running || token !== this.sessionToken || !this.analyser || !this.timeDomainBuffer) {
          return
        }
        if (now - this.lastEmitPerf >= this.minIntervalMs) {
          this.lastEmitPerf = now
          this.analyser.getFloatTimeDomainData(this.timeDomainBuffer)
          const sampleRate = ctx.sampleRate
          const detection = detectPitchYin(this.timeDomainBuffer, sampleRate, {
            minFrequency: this.minFrequency,
            maxFrequency: this.maxFrequency,
            threshold: 0.14,
            rmsThreshold: 0.0085,
          })
          const windowCenterTime = Math.max(
            0,
            ctx.currentTime - this.timeDomainBuffer.length / (2 * sampleRate),
          )
          const frame: PitchFrame = {
            time: windowCenterTime,
            frequency: detection.frequency,
            clarity: detection.clarity,
            rms: detection.rms,
          }
          for (const listener of this.frameListeners) {
            listener(frame)
          }
        }
        this.rafId = window.requestAnimationFrame(tick)
      }

      this.rafId = window.requestAnimationFrame(tick)
      return { ok: true }
    } catch (err) {
      this.starting = false
      this.cleanupNodes()
      const domErr = err as DOMException | undefined
      let message: string
      if (domErr?.name === 'NotAllowedError' || domErr?.name === 'PermissionDeniedError') {
        message = '麦克风权限被拒绝。请在浏览器地址栏或系统设置中允许麦克风访问后重试。'
      } else if (domErr?.name === 'NotFoundError' || domErr?.name === 'DevicesNotFoundError') {
        message = '未检测到可用的麦克风设备，请检查音频输入连接。'
      } else if (domErr?.name === 'NotReadableError' || domErr?.name === 'AbortError') {
        message = '麦克风正被其他应用占用或音频会话被中断，请稍后重试。'
      } else {
        message = `无法启动麦克风：${domErr?.message ?? '未知音频设备错误'}`
      }
      this.emitError(message)
      return { ok: false, error: message }
    }
  }

  private async startNative(): Promise<{ ok: boolean; error?: string }> {
    const token = ++this.sessionToken
    this.starting = true
    try {
      const handle = await VocalLabAudio.addListener('pitchFrame', (ev) => {
        if (!this.running || token !== this.sessionToken) return
        updateNativeClockAnchor(ev.time)
        const frame: PitchFrame = {
          time: ev.time,
          frequency:
            typeof ev.frequency === 'number' && Number.isFinite(ev.frequency) ? ev.frequency : null,
          clarity: ev.clarity ?? 0,
          rms: ev.rms ?? 0,
        }
        for (const listener of this.frameListeners) {
          listener(frame)
        }
      })

      if (token !== this.sessionToken) {
        await handle.remove()
        return { ok: false }
      }

      const res = await VocalLabAudio.startCapture({
        minHz: this.minFrequency,
        maxHz: this.maxFrequency,
      })

      if (token !== this.sessionToken) {
        await handle.remove()
        await VocalLabAudio.stopCapture().catch(() => {})
        return { ok: false }
      }

      if (typeof res?.clockTime === 'number') {
        updateNativeClockAnchor(res.clockTime)
      }
      this.nativeListener = handle
      this.running = true
      this.starting = false
      this.emitState(true)
      return { ok: true }
    } catch (err) {
      this.starting = false
      if (this.nativeListener) {
        void this.nativeListener.remove()
        this.nativeListener = null
      }
      const message =
        err instanceof Error ? err.message : '无法启动原生音频采集，请检查麦克风权限。'
      this.emitError(message)
      return { ok: false, error: message }
    }
  }

  private cleanupNodes(): void {
    if (this.nativeListener) {
      void this.nativeListener.remove()
      this.nativeListener = null
    }
    if (isNativeAudioActive()) {
      void VocalLabAudio.stopCapture().catch(() => {})
    }
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect()
      } catch {
        // ignore
      }
      this.sourceNode = null
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect()
      } catch {
        // ignore
      }
      this.analyser = null
    }
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.onended = null
        track.stop()
      }
      this.mediaStream = null
    }
    this.timeDomainBuffer = null
  }

  public stop(): void {
    this.sessionToken++
    const wasActive = this.running
    this.running = false
    this.starting = false
    this.cleanupNodes()
    if (wasActive) {
      this.emitState(false)
    }
  }
}
