<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PitchInfo } from './audio/pitchMath'
import { useMicrophonePitch } from './composables/useMicrophonePitch'
import { usePiano } from './composables/usePiano'
import StudioHeader from './components/StudioHeader.vue'
import LivePitchMonitor from './components/LivePitchMonitor.vue'
import PitchCurveCanvas from './components/PitchCurveCanvas.vue'
import ConcertPiano from './components/ConcertPiano.vue'

const a4Hz = ref(440)
const windowSeconds = ref(12)
const autoFollow = ref(true)
const statusAnnouncement = ref('')

const hoveredPoint = ref<{ pitch: PitchInfo; time: number } | null>(null)

const mic = useMicrophonePitch(a4Hz)
const piano = usePiano(a4Hz)

const hasSamples = computed(() => {
  void mic.sampleVersion.value
  return mic.samples.value.length > 0
})

// Highlight hovered pitch on piano when inspecting curve, otherwise live sung pitch
const pianoVocalMidi = computed<number | null>(() => {
  if (hoveredPoint.value) return hoveredPoint.value.pitch.midi
  if (mic.currentPitch.value) return mic.currentPitch.value.midi
  return null
})

function announce(msg: string) {
  statusAnnouncement.value = ''
  window.setTimeout(() => {
    statusAnnouncement.value = msg
  }, 40)
}

async function handleToggleListen() {
  if (mic.isListening.value) {
    mic.stop()
    announce('已停止麦克风音高检测')
  } else {
    const ok = await mic.start()
    if (ok) {
      announce('已开启麦克风实时音高检测')
    }
  }
}

async function handleStartMic() {
  const ok = await mic.start()
  if (ok) {
    announce('已开启麦克风实时音高检测')
  }
}

function handleClear() {
  mic.clear()
  hoveredPoint.value = null
  announce('已清空音高曲线记录')
}

function handleLoadDemo() {
  mic.loadDemo()
  hoveredPoint.value = null
  announce('已载入示例人声音高曲线，可将鼠标悬停在曲线上查看音高')
}

function handleAuditionMidi(midi: number) {
  piano.pressNote(midi)
  if (!piano.sustainDrone.value) {
    window.setTimeout(() => {
      piano.releaseNote(midi)
    }, 480)
  }
}
</script>

<template>
  <div class="studio-shell">
    <StudioHeader
      :is-listening="mic.isListening.value"
      :is-demo="mic.isDemo.value"
      :has-samples="hasSamples"
      v-model:window-seconds="windowSeconds"
      v-model:a4-hz="a4Hz"
      v-model:auto-follow="autoFollow"
      @toggle-listen="handleToggleListen"
      @clear="handleClear"
      @load-demo="handleLoadDemo"
    />

    <p role="status" class="visually-hidden">{{ statusAnnouncement }}</p>

    <main class="studio-workspace">
      <LivePitchMonitor
        class="workspace-monitor"
        :is-listening="mic.isListening.value"
        :is-demo="mic.isDemo.value"
        :current-pitch="mic.currentPitch.value"
        :last-stable-pitch="mic.lastStablePitch.value"
        :hovered-point="hoveredPoint"
        :reference-midi="piano.referenceMidi.value"
        :input-level="mic.inputLevel.value"
        :a4-hz="a4Hz"
        :voiced-range="mic.voicedRange.value"
        @clear-reference="piano.clearReference()"
      />

      <PitchCurveCanvas
        :samples="mic.samples.value"
        :sample-version="mic.sampleVersion.value"
        :is-listening="mic.isListening.value"
        :is-demo="mic.isDemo.value"
        :current-time="mic.currentTime.value"
        :window-seconds="windowSeconds"
        :a4-hz="a4Hz"
        v-model:auto-follow="autoFollow"
        :reference-midi="piano.referenceMidi.value"
        :error-message="mic.errorMessage.value"
        @hover="hoveredPoint = $event"
        @start-mic="handleStartMic"
        @load-demo="handleLoadDemo"
        @audition-midi="handleAuditionMidi"
      />
    </main>

    <ConcertPiano
      :keyboard-octave="piano.keyboardOctave.value"
      v-model:timbre="piano.timbre.value"
      v-model:volume="piano.volume.value"
      v-model:sustain-drone="piano.sustainDrone.value"
      v-model:show-key-shortcuts="piano.showKeyShortcuts.value"
      :active-notes="piano.activeNotes.value"
      :sustained-midi="piano.sustainedMidi.value"
      :reference-midi="piano.referenceMidi.value"
      :vocal-midi="pianoVocalMidi"
      :a4-hz="a4Hz"
      @press-note="piano.pressNote"
      @release-note="piano.releaseNote"
      @shift-octave="piano.shiftOctave"
    />
  </div>
</template>

<style scoped>
.studio-shell {
  display: flex;
  flex-direction: column;
  min-block-size: 100dvh;
  block-size: 100dvh;
  background-color: var(--surface-chassis);
  overflow: hidden;
}

.studio-workspace {
  display: flex;
  flex: 1 1 auto;
  min-block-size: 0;
  min-inline-size: 0;
}

.workspace-monitor {
  flex: 0 0 264px;
}

@media (max-width: 900px) {
  .studio-shell {
    block-size: auto;
    overflow: visible;
  }

  .studio-workspace {
    flex-direction: column;
  }

  .workspace-monitor {
    flex: 0 0 auto;
  }
}
</style>
