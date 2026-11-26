<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import type { PitchInfo } from './audio/pitchMath'
import { useMicrophonePitch } from './composables/useMicrophonePitch'
import { usePiano } from './composables/usePiano'
import { usePracticeSession } from './composables/usePracticeSession'
import { useSettings } from './composables/useSettings'
import { useSongPractice } from './composables/useSongPractice'
import StudioHeader, { type AppMode } from './components/StudioHeader.vue'
import LivePitchMonitor from './components/LivePitchMonitor.vue'
import PitchCurveCanvas from './components/PitchCurveCanvas.vue'
import ConcertPiano from './components/ConcertPiano.vue'
import PracticePanel from './components/practice/PracticePanel.vue'
import SongPanel from './components/songs/SongPanel.vue'

const settings = useSettings()
const a4Hz = toRef(settings, 'a4Hz')
const windowSeconds = toRef(settings, 'windowSeconds')
const autoFollow = toRef(settings, 'autoFollow')
const latencyOffsetMs = toRef(settings, 'latencyOffsetMs')

function readModeFromHash(): AppMode {
  const hash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase()
  if (hash === 'practice') return 'practice'
  if (hash === 'songs') return 'songs'
  return 'monitor'
}

const mode = ref<AppMode>(readModeFromHash())
const statusAnnouncement = ref('')

const hoveredPoint = ref<{ pitch: PitchInfo; time: number } | null>(null)

const mic = useMicrophonePitch(a4Hz)
const piano = usePiano(a4Hz)
const practice = usePracticeSession({
  engine: mic.engine,
  startMic: mic.start,
  synth: piano.synth,
  a4Hz,
})
const songPractice = useSongPractice({
  engine: mic.engine,
  startMic: mic.start,
  synth: piano.synth,
  a4Hz,
})

watch(
  mode,
  (nextMode, prevMode) => {
    mic.recordHistory.value = nextMode === 'monitor'
    hoveredPoint.value = null

    if (prevMode === 'practice' && nextMode !== 'practice') {
      practice.stop()
    }
    if (prevMode === 'songs' && nextMode !== 'songs') {
      songPractice.stop()
    }

    const targetHash = nextMode === 'monitor' ? '' : `#/${nextMode}`
    if (window.location.hash !== targetHash) {
      window.history.replaceState(null, '', targetHash || window.location.pathname + window.location.search)
    }
  },
  { immediate: true },
)

function handleHashChange() {
  const next = readModeFromHash()
  if (next !== mode.value) {
    mode.value = next
  }
}

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', handleHashChange)
})

const hasSamples = computed(() => {
  void mic.sampleVersion.value
  return mic.samples.value.length > 0
})

const canvasSamples = computed(() => {
  if (mode.value === 'practice') return practice.samples.value
  if (mode.value === 'songs') return songPractice.samples.value
  return mic.samples.value
})

const canvasSampleVersion = computed(() => {
  if (mode.value === 'practice') return practice.sampleVersion.value
  if (mode.value === 'songs') return songPractice.sampleVersion.value
  return mic.sampleVersion.value
})

const canvasCurrentTime = computed(() => {
  if (mode.value === 'practice') return practice.playheadTime.value
  if (mode.value === 'songs') return songPractice.playheadTime.value
  return mic.currentTime.value
})

const canvasTargets = computed(() => {
  if (mode.value === 'practice') return practice.targetBars.value
  if (mode.value === 'songs') return songPractice.targetBars.value
  return []
})

const canvasPlayheadTime = computed<number | null>(() => {
  if (mode.value === 'practice') return practice.playheadTime.value
  if (mode.value === 'songs') return songPractice.playheadTime.value
  return null
})

const canvasCountdownValue = computed<number | null>(() => {
  if (mode.value === 'practice' && practice.status.value === 'countdown') {
    return practice.countdownValue.value
  }
  if (mode.value === 'songs' && songPractice.status.value === 'countdown') {
    return songPractice.countdownValue.value
  }
  return null
})

const canvasGradePopup = computed(() => {
  if (mode.value === 'practice') return practice.lastGradePopup.value
  if (mode.value === 'songs') return songPractice.lastGradePopup.value
  return null
})

const activeReferenceMidi = computed<number | null>(() => {
  if (mode.value === 'practice') {
    return practice.currentSlot.value?.midi ?? piano.referenceMidi.value
  }
  if (mode.value === 'songs') {
    return songPractice.currentNote.value?.midi ?? piano.referenceMidi.value
  }
  return piano.referenceMidi.value
})

// Highlight hovered pitch on piano when inspecting curve, otherwise live sung pitch
const pianoVocalMidi = computed<number | null>(() => {
  if (mode.value === 'monitor' && hoveredPoint.value) return hoveredPoint.value.pitch.midi
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
      v-model:mode="mode"
      :is-listening="mic.isListening.value"
      :is-demo="mic.isDemo.value"
      :has-samples="hasSamples"
      v-model:window-seconds="windowSeconds"
      v-model:a4-hz="a4Hz"
      v-model:auto-follow="autoFollow"
      v-model:latency-offset-ms="latencyOffsetMs"
      @toggle-listen="handleToggleListen"
      @clear="handleClear"
      @load-demo="handleLoadDemo"
    />

    <p role="status" class="visually-hidden">{{ statusAnnouncement }}</p>

    <main class="studio-workspace">
      <LivePitchMonitor
        v-if="mode === 'monitor'"
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

      <PracticePanel
        v-else-if="mode === 'practice'"
        class="workspace-sidebar studio-scroll"
        :status="practice.status.value"
        :countdown-value="practice.countdownValue.value"
        :current-index="practice.currentIndex.value"
        :total-count="practice.slots.value.length"
        :current-slot="practice.currentSlot.value"
        :active-phase="practice.activePhase.value"
        :combo="practice.combo.value"
        :max-combo="practice.maxCombo.value"
        :results="practice.results.value"
        :summary="practice.summary.value"
        :preview-sequence="practice.previewSequence.value"
        :history="practice.history.value"
        :status-message="practice.statusMessage.value"
        :live-direction="practice.liveDirection.value"
        :live-cents="practice.liveCents.value"
        @start="practice.start($event)"
        @pause="practice.pause()"
        @resume="practice.resume()"
        @replay-current="practice.replayCurrentNote()"
        @stop="practice.stop()"
        @audition-midi="practice.auditionNote($event)"
        @clear-history="practice.clearHistory()"
      />

      <SongPanel
        v-else
        class="workspace-sidebar studio-scroll"
        :songs="songPractice.songs.value"
        :selected-song="songPractice.selectedSong.value"
        :scaled-notes="songPractice.scaledNotes.value"
        :current-note="songPractice.currentNote.value"
        v-model:transpose-semitones="songPractice.transposeSemitones.value"
        v-model:tempo-rate="songPractice.tempoRate.value"
        v-model:mute-guide-melody="songPractice.muteGuideMelody.value"
        v-model:play-backing-audio="songPractice.playBackingAudio.value"
        v-model:loop-enabled="songPractice.loopEnabled.value"
        v-model:loop-start="songPractice.loopStart.value"
        v-model:loop-end="songPractice.loopEnd.value"
        :is-importing="songPractice.isImporting.value"
        :import-progress="songPractice.importProgress.value"
        :import-error="songPractice.importError.value"
        :status="songPractice.status.value"
        :is-preview-only="songPractice.isPreviewOnly.value"
        :countdown-value="songPractice.countdownValue.value"
        :combo="songPractice.combo.value"
        :results="songPractice.results.value"
        :summary="songPractice.summary.value"
        :status-message="songPractice.statusMessage.value"
        :live-direction="songPractice.liveDirection.value"
        :live-cents="songPractice.liveCents.value"
        @select-song="songPractice.selectSong($event)"
        @select-midi-track="songPractice.selectMidiTrack($event)"
        @import-file="songPractice.importFile($event)"
        @cancel-import="songPractice.cancelImport()"
        @remove-song="songPractice.removeSong($event)"
        @preview-melody="songPractice.previewMelody()"
        @start-sing-along="songPractice.startSingAlong()"
        @pause="songPractice.pause()"
        @resume="songPractice.resume()"
        @stop="songPractice.stop()"
      />

      <PitchCurveCanvas
        class="workspace-canvas"
        :samples="canvasSamples"
        :sample-version="canvasSampleVersion"
        :is-listening="mic.isListening.value"
        :is-demo="mode === 'monitor' && mic.isDemo.value"
        :current-time="canvasCurrentTime"
        :window-seconds="windowSeconds"
        :a4-hz="a4Hz"
        v-model:auto-follow="autoFollow"
        :reference-midi="activeReferenceMidi"
        :error-message="mic.errorMessage.value"
        :targets="canvasTargets"
        :playhead-time="canvasPlayheadTime"
        :guided-mode="mode !== 'monitor'"
        :countdown-value="canvasCountdownValue"
        :grade-popup="canvasGradePopup"
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
      :reference-midi="activeReferenceMidi"
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

.workspace-sidebar {
  flex: 0 0 328px;
  min-block-size: 0;
  overflow-y: auto;
}

.workspace-canvas {
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 0;
}

@media (max-width: 900px) {
  .studio-shell {
    block-size: auto;
    overflow: visible;
  }

  .studio-workspace {
    flex-direction: column;
  }

  .workspace-monitor,
  .workspace-sidebar {
    flex: 0 0 auto;
    overflow-y: visible;
  }

  .workspace-canvas {
    min-block-size: 320px;
    block-size: 44dvh;
  }
}
</style>
