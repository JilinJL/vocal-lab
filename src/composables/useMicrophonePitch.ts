import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  describePitchFromFrequency,
  describePitchFromMidi,
  frequencyToMidi,
  type PitchInfo,
  type PitchSample,
} from '../audio/pitchMath'
import { generateDemoVocalPhrase } from '../audio/demoPhrase'
import { PitchEngine, type PitchFrame } from '../engine/pitchEngine'
import { getAudioTime } from '../engine/audioContext'

const MAX_SAMPLES = 24000 // ~8 minutes at ~50Hz sampling

export function useMicrophonePitch(a4Hz: Ref<number>) {
  const isListening = ref(false)
  const isDemo = ref(false)
  const errorMessage = ref<string | null>(null)
  const inputLevel = ref(0) // 0..1 normalized meter
  const clarity = ref(0)
  const currentTime = ref(0)
  const currentPitch = ref<PitchInfo | null>(null)
  const lastStablePitch = ref<PitchInfo | null>(null)
  const recordHistory = ref(true)

  // Raw sample array kept out of deep reactivity for smooth 60fps canvas rendering
  const samples = shallowRef<PitchSample[]>([])
  const sampleVersion = ref(0)

  const engine = new PitchEngine({
    fftSize: 4096,
    minIntervalMs: 20,
    minFrequency: 60,
    maxFrequency: 1250,
  })

  let sessionBaseTime = 0
  let segmentStartAudioTime = 0
  let recentMidis: number[] = []
  let smoothedMidi: number | null = null
  let silenceFrames = 0

  // Recalculate MIDI/pitch description if A4 calibration changes
  watch(a4Hz, (newA4) => {
    if (samples.value.length > 0) {
      for (const s of samples.value) {
        if (s.frequency !== null) {
          s.midi = frequencyToMidi(s.frequency, newA4)
        }
      }
      sampleVersion.value++
    }
    if (currentPitch.value) {
      currentPitch.value = describePitchFromFrequency(currentPitch.value.frequency, newA4)
    }
    if (lastStablePitch.value) {
      lastStablePitch.value = describePitchFromFrequency(lastStablePitch.value.frequency, newA4)
    }
  })

  const voicedRange = computed(() => {
    // Depend on sampleVersion so it updates incrementally without deep watching
    void sampleVersion.value
    const list = samples.value
    let minMidi = Infinity
    let maxMidi = -Infinity
    let voicedCount = 0

    for (let i = 0; i < list.length; i++) {
      const m = list[i]!.midi
      if (m !== null) {
        voicedCount++
        if (m < minMidi) minMidi = m
        if (m > maxMidi) maxMidi = m
      }
    }

    if (voicedCount === 0) {
      return null
    }

    return {
      min: describePitchFromMidi(minMidi, a4Hz.value),
      max: describePitchFromMidi(maxMidi, a4Hz.value),
      semitoneSpan: Math.max(0, Math.round(maxMidi) - Math.round(minMidi)),
      voicedCount,
    }
  })

  function medianOfThree(a: number, b: number, c: number): number {
    if ((a >= b && a <= c) || (a <= b && a >= c)) return a
    if ((b >= a && b <= c) || (b <= a && b >= c)) return b
    return c
  }

  function handleFrame(frame: PitchFrame) {
    // Smooth VU meter visually
    const normalizedRms = Math.min(1, Math.pow(frame.rms * 6.5, 0.72))
    inputLevel.value = inputLevel.value * 0.65 + normalizedRms * 0.35

    const elapsed = Math.max(sessionBaseTime, sessionBaseTime + (frame.time - segmentStartAudioTime))
    currentTime.value = elapsed

    let acceptedMidi: number | null = null
    let acceptedFreq: number | null = null

    if (frame.frequency !== null && frame.clarity >= 0.76) {
      silenceFrames = 0
      const rawMidi = frequencyToMidi(frame.frequency, a4Hz.value)

      // Keep short 3-sample median window to suppress single-frame consonant glitches
      recentMidis.push(rawMidi)
      if (recentMidis.length > 3) recentMidis.shift()

      const filteredMidi =
        recentMidis.length === 3
          ? medianOfThree(recentMidis[0]!, recentMidis[1]!, recentMidis[2]!)
          : rawMidi

      // Smooth gently while preserving vocal vibrato and runs
      if (smoothedMidi === null || Math.abs(filteredMidi - smoothedMidi) > 1.8) {
        smoothedMidi = filteredMidi
      } else {
        smoothedMidi = smoothedMidi * 0.32 + filteredMidi * 0.68
      }

      acceptedMidi = smoothedMidi
      acceptedFreq = frame.frequency
      clarity.value = frame.clarity

      const info = describePitchFromMidi(acceptedMidi, a4Hz.value, acceptedFreq)
      currentPitch.value = info
      lastStablePitch.value = info
    } else {
      silenceFrames++
      clarity.value = 0
      if (silenceFrames >= 3) {
        recentMidis = []
        smoothedMidi = null
        currentPitch.value = null
      }
    }

    if (recordHistory.value) {
      const list = samples.value
      list.push({
        time: elapsed,
        frequency: acceptedFreq,
        midi: acceptedMidi,
        clarity: frame.clarity,
        rms: frame.rms,
      })
      if (list.length > MAX_SAMPLES) {
        list.splice(0, list.length - MAX_SAMPLES)
      }
      sampleVersion.value++
    }
  }

  const unsubFrame = engine.subscribe(handleFrame)
  const unsubError = engine.onError((msg) => {
    errorMessage.value = msg
  })
  const unsubState = engine.onStateChange((active) => {
    isListening.value = active
    if (!active) {
      sessionBaseTime = currentTime.value
      inputLevel.value = 0
      clarity.value = 0
      currentPitch.value = null
    }
  })

  async function start(): Promise<boolean> {
    errorMessage.value = null

    if (isListening.value) return true

    // If switching from demo preview to live mic, clear demo data first
    if (isDemo.value) {
      clear()
    }

    if (samples.value.length > 0 && recordHistory.value) {
      const lastT = samples.value[samples.value.length - 1]!.time
      sessionBaseTime = lastT + 0.35
      samples.value.push({
        time: lastT + 0.12,
        frequency: null,
        midi: null,
        clarity: 0,
        rms: 0,
      })
    } else if (!recordHistory.value) {
      sessionBaseTime = currentTime.value
    } else {
      sessionBaseTime = 0
    }

    recentMidis = []
    smoothedMidi = null
    silenceFrames = 0
    isDemo.value = false

    const res = await engine.start()
    if (!res.ok) {
      return false
    }
    segmentStartAudioTime = getAudioTime()
    return true
  }

  function stop() {
    engine.stop()
  }

  function clear() {
    samples.value = []
    sampleVersion.value++
    sessionBaseTime = 0
    currentTime.value = 0
    currentPitch.value = null
    lastStablePitch.value = null
    recentMidis = []
    smoothedMidi = null
    isDemo.value = false
    errorMessage.value = null
    if (isListening.value) {
      segmentStartAudioTime = getAudioTime()
    }
  }

  function loadDemo() {
    stop()
    errorMessage.value = null
    const demoData = generateDemoVocalPhrase(a4Hz.value)
    samples.value = demoData
    sampleVersion.value++
    const last = demoData[demoData.length - 1]
    currentTime.value = last ? last.time : 0
    sessionBaseTime = currentTime.value
    // Highlight last voiced note in the readout
    for (let i = demoData.length - 1; i >= 0; i--) {
      if (demoData[i]!.midi !== null) {
        lastStablePitch.value = describePitchFromMidi(
          demoData[i]!.midi!,
          a4Hz.value,
          demoData[i]!.frequency ?? undefined,
        )
        break
      }
    }
    isDemo.value = true
  }

  onBeforeUnmount(() => {
    unsubFrame()
    unsubError()
    unsubState()
    stop()
  })

  return {
    engine,
    recordHistory,
    isListening,
    isDemo,
    errorMessage,
    inputLevel,
    clarity,
    currentTime,
    currentPitch,
    lastStablePitch,
    samples,
    sampleVersion,
    voicedRange,
    start,
    stop,
    clear,
    loadDemo,
  }
}
