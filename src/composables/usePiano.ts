import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { PianoSynthesizer, type PianoTimbre } from '../audio/pianoSynth'

// Computer keyboard mapping starting at keyboardOctave (default C4 = MIDI 60)
export const KEYBOARD_NOTE_OFFSETS: ReadonlyArray<{ key: string; label: string; offset: number }> = [
  { key: 'a', label: 'A', offset: 0 }, // C
  { key: 'w', label: 'W', offset: 1 }, // C#
  { key: 's', label: 'S', offset: 2 }, // D
  { key: 'e', label: 'E', offset: 3 }, // D#
  { key: 'd', label: 'D', offset: 4 }, // E
  { key: 'f', label: 'F', offset: 5 }, // F
  { key: 't', label: 'T', offset: 6 }, // F#
  { key: 'g', label: 'G', offset: 7 }, // G
  { key: 'y', label: 'Y', offset: 8 }, // G#
  { key: 'h', label: 'H', offset: 9 }, // A
  { key: 'u', label: 'U', offset: 10 }, // A#
  { key: 'j', label: 'J', offset: 11 }, // B
  { key: 'k', label: 'K', offset: 12 }, // C+1
  { key: 'o', label: 'O', offset: 13 }, // C#+1
  { key: 'l', label: 'L', offset: 14 }, // D+1
  { key: 'p', label: 'P', offset: 15 }, // D#+1
  { key: ';', label: ';', offset: 16 }, // E+1
]

export function usePiano(a4Hz: Ref<number>) {
  const synth = new PianoSynthesizer()

  // Which octave computer keyboard shortcuts (A..;) map to (C1..C6)
  const keyboardOctave = ref(4)
  const timbre = ref<PianoTimbre>('sampled')
  const volume = ref(0.76)
  const sustainDrone = ref(false)
  const showKeyShortcuts = ref(true)

  const activeNotes = ref<Set<number>>(new Set())
  const referenceMidi = ref<number | null>(null)
  const sustainedMidi = ref<number | null>(null)

  watch(
    a4Hz,
    (hz) => {
      synth.setA4Hz(hz)
    },
    { immediate: true },
  )

  watch(
    timbre,
    (t) => {
      synth.setTimbre(t)
    },
    { immediate: true },
  )

  watch(
    volume,
    (v) => {
      synth.setVolume(v)
    },
    { immediate: true },
  )

  watch(sustainDrone, (enabled) => {
    if (!enabled && sustainedMidi.value !== null) {
      synth.noteOff(sustainedMidi.value, 0.28)
      const next = new Set(activeNotes.value)
      next.delete(sustainedMidi.value)
      activeNotes.value = next
      sustainedMidi.value = null
    }
  })

  function pressNote(midi: number) {
    if (sustainDrone.value) {
      if (sustainedMidi.value === midi) {
        synth.noteOff(midi, 0.28)
        const next = new Set(activeNotes.value)
        next.delete(midi)
        activeNotes.value = next
        sustainedMidi.value = null
        return
      }
      if (sustainedMidi.value !== null) {
        synth.noteOff(sustainedMidi.value, 0.16)
        const next = new Set(activeNotes.value)
        next.delete(sustainedMidi.value)
        activeNotes.value = next
      }
      synth.noteOn(midi, { sustain: true, velocity: 0.82 })
      const next = new Set(activeNotes.value)
      next.add(midi)
      activeNotes.value = next
      sustainedMidi.value = midi
      referenceMidi.value = midi
      return
    }

    synth.noteOn(midi, { sustain: false, velocity: 0.88 })
    const next = new Set(activeNotes.value)
    next.add(midi)
    activeNotes.value = next
    referenceMidi.value = midi
  }

  function releaseNote(midi: number) {
    if (sustainDrone.value && sustainedMidi.value === midi) {
      return
    }
    // Natural piano damper decay when releasing a sampled key
    synth.noteOff(midi, timbre.value === 'sampled' ? 0.55 : 0.32)
    if (activeNotes.value.has(midi)) {
      const next = new Set(activeNotes.value)
      next.delete(midi)
      activeNotes.value = next
    }
  }

  function clearReference() {
    if (sustainedMidi.value !== null) {
      synth.noteOff(sustainedMidi.value, 0.2)
      sustainedMidi.value = null
    }
    synth.stopAll()
    activeNotes.value = new Set()
    referenceMidi.value = null
  }

  function shiftOctave(delta: number) {
    keyboardOctave.value = Math.max(1, Math.min(6, keyboardOctave.value + delta))
  }

  onBeforeUnmount(() => {
    synth.dispose()
  })

  return {
    keyboardOctave,
    timbre,
    volume,
    sustainDrone,
    showKeyShortcuts,
    activeNotes,
    referenceMidi,
    sustainedMidi,
    pressNote,
    releaseNote,
    clearReference,
    shiftOctave,
  }
}
