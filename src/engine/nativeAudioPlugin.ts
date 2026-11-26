import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface NativePitchFrameEvent {
  time: number
  frequency: number | null
  clarity: number
  rms: number
  sampleRate: number
}

export interface VocalLabAudioPlugin {
  isAvailable(): Promise<{ available: boolean; engine: string; route: string }>
  getClockTime(): Promise<{ time: number }>
  startCapture(options?: {
    minHz?: number
    maxHz?: number
  }): Promise<{ started: boolean; clockTime: number; route: string }>
  stopCapture(): Promise<void>
  noteOn(options: {
    midi: number
    velocity?: number
    sustain?: boolean
    timbre?: number
    a4Hz?: number
  }): Promise<void>
  noteOff(options: { midi: number; releaseSec?: number }): Promise<void>
  scheduleNote(options: {
    id: number
    midi: number
    startTime: number
    duration: number
    velocity?: number
    timbre?: number
    a4Hz?: number
  }): Promise<void>
  cancelScheduled(options: { id: number }): Promise<void>
  stopAllNotes(): Promise<void>
  setSynthParams(options: { volume: number; timbre: number; a4Hz: number }): Promise<void>
  scheduleDrum(options: {
    sound: number
    startTime: number
    velocityLevel: number
    volume?: number
  }): Promise<void>
  cancelScheduledDrums(): Promise<void>
  setKeepAwake(options: { enabled: boolean }): Promise<void>
  addListener(
    eventName: 'pitchFrame',
    listenerFunc: (event: NativePitchFrameEvent) => void,
  ): Promise<PluginListenerHandle>
}

export const VocalLabAudio = registerPlugin<VocalLabAudioPlugin>('VocalLabAudio')

let nativeClockOffsetSec: number | null = null
let syncInFlight: Promise<void> | null = null
let nextScheduleId = 1

export function isNativeAudioActive(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function updateNativeClockAnchor(nativeTimeSec: number): void {
  const perfSec = performance.now() / 1000
  const measuredOffset = nativeTimeSec - perfSec
  if (nativeClockOffsetSec === null || Math.abs(measuredOffset - nativeClockOffsetSec) > 0.05) {
    nativeClockOffsetSec = measuredOffset
  } else {
    nativeClockOffsetSec = nativeClockOffsetSec * 0.8 + measuredOffset * 0.2
  }
}

export function syncNativeClock(): Promise<void> {
  if (!isNativeAudioActive()) return Promise.resolve()
  if (syncInFlight) return syncInFlight
  syncInFlight = VocalLabAudio.getClockTime()
    .then((res) => {
      if (typeof res?.time === 'number' && Number.isFinite(res.time)) {
        updateNativeClockAnchor(res.time)
      }
    })
    .catch(() => {
      // ignore bridge error
    })
    .finally(() => {
      syncInFlight = null
    })
  return syncInFlight
}

export function getNativeClockTime(): number {
  const perfSec = performance.now() / 1000
  if (nativeClockOffsetSec === null) {
    void syncNativeClock()
    return perfSec
  }
  return perfSec + nativeClockOffsetSec
}

export function allocateScheduleId(): number {
  nextScheduleId = (nextScheduleId % 2000000000) + 1
  return nextScheduleId
}

export function setNativeKeepAwake(enabled: boolean): void {
  if (!isNativeAudioActive()) return
  void VocalLabAudio.setKeepAwake({ enabled }).catch(() => {
    // ignore
  })
}
