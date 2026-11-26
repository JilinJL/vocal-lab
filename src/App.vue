<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import type { PitchInfo } from './audio/pitchMath'
import { setNativeKeepAwake, syncNativeClock } from './engine/nativeAudioPlugin'
import { useMicrophonePitch } from './composables/useMicrophonePitch'
import { usePiano } from './composables/usePiano'
import { usePracticeSession } from './composables/usePracticeSession'
import { useRhythmSession } from './composables/useRhythmSession'
import { useSettings } from './composables/useSettings'
import { useSongPractice } from './composables/useSongPractice'
import StudioHeader, { type AppMode } from './components/StudioHeader.vue'
import LivePitchMonitor from './components/LivePitchMonitor.vue'
import PitchCurveCanvas from './components/PitchCurveCanvas.vue'
import ConcertPiano from './components/ConcertPiano.vue'
import PracticePanel from './components/practice/PracticePanel.vue'
import RhythmStage from './components/rhythm/RhythmStage.vue'
import RhythmLibraryPanel from './components/rhythm/RhythmLibraryPanel.vue'
import SongPanel from './components/songs/SongPanel.vue'
import BottomSheet from './components/ui/BottomSheet.vue'
import MobileStageHud from './components/mobile/MobileStageHud.vue'
import MobileBottomDock from './components/mobile/MobileBottomDock.vue'

const settings = useSettings()
const a4Hz = toRef(settings, 'a4Hz')
const windowSeconds = toRef(settings, 'windowSeconds')
const autoFollow = toRef(settings, 'autoFollow')
const latencyOffsetMs = toRef(settings, 'latencyOffsetMs')

const isMobile = ref(false)
const mobileSheetOpen = ref(false)
const mobilePianoOpen = ref(false)
let mobileMediaQuery: MediaQueryList | null = null
let backButtonHandle: PluginListenerHandle | null = null

const PRACTICE_PRESETS = [
  { min: 48, max: 55 }, // C3-G3
  { min: 57, max: 64 }, // A3-E4
  { min: 60, max: 67 }, // C4-G4
] as const

function readModeFromHash(): AppMode {
  const hash = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase()
  if (hash === 'practice') return 'practice'
  if (hash === 'rhythm') return 'rhythm'
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
const rhythm = useRhythmSession()

watch(
  mode,
  (nextMode, prevMode) => {
    mic.recordHistory.value = nextMode === 'monitor'
    hoveredPoint.value = null
    mobileSheetOpen.value = false

    if (prevMode === 'practice' && nextMode !== 'practice') {
      practice.stop()
    }
    if (prevMode === 'rhythm' && nextMode !== 'rhythm') {
      rhythm.stopAll()
    }
    if (prevMode === 'songs' && nextMode !== 'songs') {
      songPractice.stop()
    }
    if (nextMode === 'rhythm' && mic.isListening.value) {
      mic.stop()
    }

    const targetHash = nextMode === 'monitor' ? '' : `#/${nextMode}`
    if (window.location.hash !== targetHash) {
      window.history.replaceState(null, '', targetHash || window.location.pathname + window.location.search)
    }
  },
  { immediate: true },
)

watch(
  () => practice.status.value,
  (next, prev) => {
    if (isMobile.value && next === 'finished' && prev !== 'finished') {
      mobileSheetOpen.value = true
    }
  },
)

watch(
  () => songPractice.status.value,
  (next, prev) => {
    if (isMobile.value && next === 'finished' && prev !== 'finished') {
      mobileSheetOpen.value = true
    }
  },
)

watch(
  () =>
    mic.isListening.value ||
    practice.status.value === 'running' ||
    practice.status.value === 'countdown' ||
    songPractice.status.value === 'running' ||
    songPractice.status.value === 'countdown' ||
    rhythm.isActive.value,
  (active) => {
    setNativeKeepAwake(active)
  },
  { immediate: true },
)

function syncIsMobile() {
  isMobile.value = mobileMediaQuery ? mobileMediaQuery.matches : window.innerWidth <= 900
  if (!isMobile.value) {
    mobileSheetOpen.value = false
    mobilePianoOpen.value = false
  }
}

function handleHashChange() {
  const next = readModeFromHash()
  if (next !== mode.value) {
    mode.value = next
  }
}

onMounted(() => {
  mobileMediaQuery = window.matchMedia('(max-width: 900px)')
  syncIsMobile()
  mobileMediaQuery.addEventListener('change', syncIsMobile)
  window.addEventListener('hashchange', handleHashChange)

  if (Capacitor.isNativePlatform()) {
    void syncNativeClock()
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
    void StatusBar.setBackgroundColor({ color: '#11161c' }).catch(() => {})
    void CapApp.addListener('backButton', () => {
      if (mobilePianoOpen.value) {
        mobilePianoOpen.value = false
        return
      }
      if (mobileSheetOpen.value) {
        mobileSheetOpen.value = false
        return
      }
      if (mode.value !== 'monitor') {
        mode.value = 'monitor'
        return
      }
      void CapApp.exitApp()
    }).then((handle) => {
      backButtonHandle = handle
    })
  }
})

onBeforeUnmount(() => {
  mobileMediaQuery?.removeEventListener('change', syncIsMobile)
  window.removeEventListener('hashchange', handleHashChange)
  if (backButtonHandle) {
    void backButtonHandle.remove()
    backButtonHandle = null
  }
  setNativeKeepAwake(false)
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

function handleCyclePreset(delta: number) {
  const currentIdx = PRACTICE_PRESETS.findIndex(
    (p) => p.min === settings.practiceRangeMin && p.max === settings.practiceRangeMax,
  )
  const baseIdx = currentIdx === -1 ? 1 : currentIdx
  const nextIdx = (baseIdx + delta + PRACTICE_PRESETS.length) % PRACTICE_PRESETS.length
  const preset = PRACTICE_PRESETS[nextIdx]!
  settings.practiceRangeMin = preset.min
  settings.practiceRangeMax = preset.max
}

function handleCycleSong(delta: number) {
  const list = songPractice.songs.value
  if (list.length <= 1) return
  const idx = list.findIndex((s) => s.id === songPractice.selectedSong.value.id)
  const nextIdx = (Math.max(0, idx) + delta + list.length) % list.length
  songPractice.selectSong(list[nextIdx]!.id)
}

function handleStartPractice(customMidis?: number[]) {
  mobileSheetOpen.value = false
  mobilePianoOpen.value = false
  void practice.start(customMidis)
}

function handlePreviewSong() {
  mobileSheetOpen.value = false
  mobilePianoOpen.value = false
  void songPractice.previewMelody()
}

function handleStartSong() {
  mobileSheetOpen.value = false
  mobilePianoOpen.value = false
  void songPractice.startSingAlong()
}

function handleToggleMobilePiano() {
  mobileSheetOpen.value = false
  mobilePianoOpen.value = !mobilePianoOpen.value
}

function handleSelectRhythmPreset(kind: 'basic' | 'groove' | 'challenge', id: string) {
  if (kind === 'basic') rhythm.selectBasicPreset(id)
  else if (kind === 'groove') rhythm.loadGroove(id)
  else rhythm.selectChallenge(id)
  if (isMobile.value) {
    mobileSheetOpen.value = false
  }
}

function handleBoostBpmAndReplay() {
  rhythm.stepBpm(5)
  void rhythm.startGame()
}

function handleOpenRhythmLibrary() {
  if (isMobile.value) {
    mobileSheetOpen.value = true
  } else {
    rhythm.stopAll()
    rhythm.gameStatus.value = 'idle'
  }
}

const mobileRhythmTitle = computed(() => {
  if (rhythm.subView.value === 'beat') return rhythm.activeBasicPreset.value.name
  if (rhythm.subView.value === 'game') return rhythm.activeChallenge.value.name
  return rhythm.activeGroove.value.name
})

const mobileSheetTitle = computed(() => {
  if (mode.value === 'practice') {
    return practice.status.value === 'finished' ? '练习成绩' : '音准练习设置'
  }
  if (mode.value === 'rhythm') {
    if (rhythm.subView.value === 'beat') return '基础节拍练习'
    if (rhythm.subView.value === 'game') return '节奏闯关关卡与设置'
    return '经典节奏库与律动设置'
  }
  if (mode.value === 'songs') {
    return songPractice.status.value === 'finished' ? '跟唱成绩' : '曲库与跟唱设置'
  }
  return ''
})
</script>

<template>
  <div class="studio-shell" :class="{ 'is-mobile': isMobile }">
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

    <MobileStageHud
      v-if="isMobile"
      :mode="mode"
      :is-listening="mic.isListening.value"
      :current-pitch="mic.currentPitch.value"
      :last-stable-pitch="mic.lastStablePitch.value"
      :hovered-point="hoveredPoint"
      :input-level="mic.inputLevel.value"
      :practice-status="practice.status.value"
      :practice-range-min="settings.practiceRangeMin"
      :practice-range-max="settings.practiceRangeMax"
      :practice-pattern="settings.practicePattern"
      :practice-slot="practice.currentSlot.value"
      :practice-phase="practice.activePhase.value"
      :practice-index="practice.currentIndex.value"
      :practice-total="practice.slots.value.length"
      :practice-combo="practice.combo.value"
      :practice-score="practice.summary.value.score"
      :practice-live-dir="practice.liveDirection.value"
      :practice-live-cents="practice.liveCents.value"
      :practice-preview-count="practice.previewSequence.value.length"
      :song-status="songPractice.status.value"
      :song-title="songPractice.selectedSong.value.title"
      :song-transpose="songPractice.transposeSemitones.value"
      :song-tempo="songPractice.tempoRate.value"
      :song-note="songPractice.currentNote.value"
      :song-is-preview="songPractice.isPreviewOnly.value"
      :song-combo="songPractice.combo.value"
      :song-score="songPractice.summary.value.score"
      :song-live-dir="songPractice.liveDirection.value"
      :song-live-cents="songPractice.liveCents.value"
      :songs="songPractice.songs.value"
      :selected-song-id="songPractice.selectedSong.value.id"
      :rhythm-sub-view="rhythm.subView.value"
      :rhythm-title="mobileRhythmTitle"
      :rhythm-bpm="rhythm.bpm.value"
      :rhythm-meter="rhythm.activeMeter.value"
      :rhythm-is-playing="rhythm.isPlaying.value"
      @open-sheet="mobileSheetOpen = true"
      @cycle-preset="handleCyclePreset"
      @cycle-song="handleCycleSong"
      @cycle-rhythm="rhythm.cycleActivePreset"
    />

    <main class="studio-workspace">
      <template v-if="mode === 'rhythm'">
        <RhythmLibraryPanel
          v-if="!isMobile"
          class="workspace-sidebar studio-scroll"
          :sub-view="rhythm.subView.value"
          :active-basic-preset-id="rhythm.activeBasicPresetId.value"
          v-model:active-category="rhythm.activeCategory.value"
          :active-groove-id="rhythm.activeGrooveId.value"
          :groove-meter="rhythm.grooveMeter.value"
          v-model:swing="rhythm.swing.value"
          :selected-challenge-id="rhythm.selectedChallengeId.value"
          v-model:game-target-mode="rhythm.gameTargetMode.value"
          v-model:game-bars="rhythm.gameBars.value"
          v-model:game-blind-bars="rhythm.gameBlindBars.value"
          :history="rhythm.gameHistory.value"
          @select-basic-preset="rhythm.selectBasicPreset($event)"
          @select-groove="rhythm.loadGroove($event)"
          @update:groove-meter="rhythm.setGrooveMeter($event)"
          @select-challenge="rhythm.selectChallenge($event)"
          @clear-history="rhythm.clearHistory()"
        />

        <RhythmStage
          :is-mobile="isMobile"
          :sub-view="rhythm.subView.value"
          :bpm="rhythm.bpm.value"
          v-model:pulse-only="rhythm.pulseOnly.value"
          :swing="rhythm.swing.value"
          :basic-meter="rhythm.basicMeter.value"
          :basic-sub="rhythm.basicSub.value"
          :active-basic-preset="rhythm.activeBasicPreset.value"
          :groove-meter="rhythm.grooveMeter.value"
          :active-groove="rhythm.activeGroove.value"
          :active-meter-spec="rhythm.activeMeterSpec.value"
          :pattern="rhythm.pattern"
          :groove-stats="rhythm.grooveStats.value"
          :is-playing="rhythm.isPlaying.value"
          :current-step="rhythm.currentStep.value"
          :current-beat="rhythm.currentBeat.value"
          :current-sub-pos="rhythm.currentSubPos.value"
          :current-bar="rhythm.currentBar.value"
          :active-challenge="rhythm.activeChallenge.value"
          :game-target-mode="rhythm.gameTargetMode.value"
          :game-bars="rhythm.gameBars.value"
          :game-blind-bars="rhythm.gameBlindBars.value"
          :game-status="rhythm.gameStatus.value"
          :game-countdown="rhythm.gameCountdown.value"
          :game-targets="rhythm.gameTargets.value"
          :game-combo="rhythm.gameCombo.value"
          :game-popup="rhythm.gamePopup.value"
          :game-playhead-sec="rhythm.gamePlayheadSec.value"
          :game-in-blind-bar="rhythm.gameInBlindBar.value"
          :game-summary="rhythm.gameSummary.value"
          :last-tap-flash-at="rhythm.lastTapFlashAt.value"
          @update:sub-view="rhythm.setSubView($event)"
          @update:bpm="rhythm.setBpm($event)"
          @update:basic-meter="rhythm.setBasicMeter($event)"
          @update:basic-sub="rhythm.setBasicSub($event)"
          @step-bpm="rhythm.stepBpm($event)"
          @tap-tempo="rhythm.tapTempo()"
          @toggle-play="rhythm.togglePlayback()"
          @cycle-cell="rhythm.cycleCell"
          @start-game="rhythm.startGame()"
          @stop-all="rhythm.stopAll()"
          @game-tap="rhythm.registerGameTap()"
          @open-library="handleOpenRhythmLibrary"
          @boost-bpm-and-replay="handleBoostBpmAndReplay"
        />
      </template>

      <template v-else>
        <template v-if="!isMobile">
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
          @start="handleStartPractice($event)"
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
          @preview-melody="handlePreviewSong"
          @start-sing-along="handleStartSong"
          @pause="songPractice.pause()"
          @resume="songPractice.resume()"
          @stop="songPractice.stop()"
        />
      </template>

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
      </template>
    </main>

    <!-- Desktop docked 88-key Concert Piano -->
    <ConcertPiano
      v-if="!isMobile && mode !== 'rhythm'"
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
      @toggle-drone="piano.toggleDrone"
      @clear-reference="piano.clearReference()"
      @shift-octave="piano.shiftOctave"
    />

    <!-- Mobile thumb-zone dock & bottom tab bar -->
    <MobileBottomDock
      v-if="isMobile"
      v-model:mode="mode"
      :is-listening="mic.isListening.value"
      :is-demo="mic.isDemo.value"
      :has-samples="hasSamples"
      :piano-open="mobilePianoOpen"
      :has-sustained-drone="piano.sustainedMidi.value !== null"
      :practice-status="practice.status.value"
      :practice-missed-count="practice.summary.value.missedMidis.length"
      :song-status="songPractice.status.value"
      :rhythm-sub-view="rhythm.subView.value"
      :rhythm-playing="rhythm.isPlaying.value"
      :rhythm-pulse-only="rhythm.pulseOnly.value"
      :rhythm-game-status="rhythm.gameStatus.value"
      @toggle-listen="handleToggleListen"
      @clear-monitor="handleClear"
      @load-demo="handleLoadDemo"
      @toggle-piano="handleToggleMobilePiano"
      @open-sheet="mobileSheetOpen = true"
      @start-practice="handleStartPractice()"
      @retry-missed="handleStartPractice(practice.summary.value.missedMidis)"
      @pause-practice="practice.pause()"
      @resume-practice="practice.resume()"
      @replay-practice="practice.replayCurrentNote()"
      @stop-practice="practice.stop()"
      @preview-song="handlePreviewSong"
      @start-song="handleStartSong"
      @pause-song="songPractice.pause()"
      @resume-song="songPractice.resume()"
      @stop-song="songPractice.stop()"
      @toggle-rhythm="rhythm.togglePlayback()"
      @tap-rhythm-tempo="rhythm.tapTempo()"
      @toggle-rhythm-pulse-only="rhythm.pulseOnly.value = !rhythm.pulseOnly.value"
      @stop-rhythm="rhythm.stopAll()"
    />

    <!-- Mobile swipeable Config / Song Library / Results Bottom Sheet -->
    <BottomSheet
      v-if="isMobile"
      :open="mobileSheetOpen"
      :title="mobileSheetTitle"
      @close="mobileSheetOpen = false"
    >
      <PracticePanel
        v-if="mode === 'practice'"
        class="sheet-embedded-panel"
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
        @start="handleStartPractice($event)"
        @pause="practice.pause()"
        @resume="practice.resume()"
        @replay-current="practice.replayCurrentNote()"
        @stop="practice.stop()"
        @audition-midi="practice.auditionNote($event)"
        @clear-history="practice.clearHistory()"
      />
      <RhythmLibraryPanel
        v-else-if="mode === 'rhythm'"
        class="sheet-embedded-panel"
        :sub-view="rhythm.subView.value"
        :active-basic-preset-id="rhythm.activeBasicPresetId.value"
        v-model:active-category="rhythm.activeCategory.value"
        :active-groove-id="rhythm.activeGrooveId.value"
        :groove-meter="rhythm.grooveMeter.value"
        v-model:swing="rhythm.swing.value"
        :selected-challenge-id="rhythm.selectedChallengeId.value"
        v-model:game-target-mode="rhythm.gameTargetMode.value"
        v-model:game-bars="rhythm.gameBars.value"
        v-model:game-blind-bars="rhythm.gameBlindBars.value"
        :history="rhythm.gameHistory.value"
        @select-basic-preset="handleSelectRhythmPreset('basic', $event)"
        @select-groove="handleSelectRhythmPreset('groove', $event)"
        @update:groove-meter="rhythm.setGrooveMeter($event)"
        @select-challenge="handleSelectRhythmPreset('challenge', $event)"
        @clear-history="rhythm.clearHistory()"
      />
      <SongPanel
        v-else-if="mode === 'songs'"
        class="sheet-embedded-panel"
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
        @preview-melody="handlePreviewSong"
        @start-sing-along="handleStartSong"
        @pause="songPractice.pause()"
        @resume="songPractice.resume()"
        @stop="songPractice.stop()"
      />
    </BottomSheet>

    <!-- Mobile swipeable Piano Bottom Sheet -->
    <BottomSheet
      v-if="isMobile"
      :open="mobilePianoOpen"
      title="参考钢琴（滑奏 · 长按锁定持续音）"
      max-height="46dvh"
      light-backdrop
      @close="mobilePianoOpen = false"
    >
      <ConcertPiano
        mobile-drawer
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
        @toggle-drone="piano.toggleDrone"
        @clear-reference="piano.clearReference()"
        @shift-octave="piano.shiftOctave"
      />
    </BottomSheet>
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

.sheet-embedded-panel {
  border-inline-end: none !important;
  overflow-y: visible !important;
}

@media (max-width: 900px) {
  .studio-shell {
    block-size: 100dvh;
    max-block-size: 100dvh;
    overflow: hidden;
  }

  .studio-workspace {
    flex-direction: column;
    flex: 1 1 auto;
    min-block-size: 0;
  }

  .workspace-canvas {
    flex: 1 1 auto;
    min-block-size: 0;
    block-size: auto;
  }
}
</style>
