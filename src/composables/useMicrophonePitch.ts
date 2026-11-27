import { computed, onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  describePitchFromFrequency,
  describePitchFromMidi,
  frequencyToMidi,
  type PitchInfo,
  type PitchSample,
} from '../audio/pitchMath'
import { generateDemoVocalPhrase } from '../audio/demoPhrase'
import { PitchStabilizer } from '../audio/pitchStabilizer'
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
  const stabilizer = new PitchStabilizer()

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

  function handleFrame(frame: PitchFrame) {
    // Smooth VU meter visually
    const normalizedRms = Math.min(1, Math.pow(frame.rms * 8.0, 0.68))
    inputLevel.value = inputLevel.value * 0.65 + normalizedRms * 0.35

    const elapsed = Math.max(sessionBaseTime, sessionBaseTime + (frame.time - segmentStartAudioTime))
    currentTime.value = elapsed

    const stabilized = stabilizer.process(
      {
        time: elapsed,
        frequency: frame.frequency,
        clarity: frame.clarity,
        rms: frame.rms,
      },
      a4Hz.value,
    )

    if (stabilized.midi !== null && stabilized.frequency !== null) {
      clarity.value = stabilized.clarity
      const info = describePitchFromMidi(stabilized.midi, a4Hz.value, stabilized.frequency)
      currentPitch.value = info
      lastStablePitch.value = info
    } else {
      clarity.value = 0
      currentPitch.value = null
    }

    if (recordHistory.value) {
      const list = samples.value
      list.push({
        time: elapsed,
        frequency: stabilized.frequency,
        midi: stabilized.midi,
        clarity: stabilized.clarity,
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
      stabilizer.reset()
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

    stabilizer.reset()
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
    stabilizer.reset()
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
