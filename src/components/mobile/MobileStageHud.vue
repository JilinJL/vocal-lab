<script setup lang="ts">
import { computed } from 'vue'
import { formatCents, midiToNoteParts, type PitchInfo } from '../../audio/pitchMath'
import type { AppMode } from '../StudioHeader.vue'
import type { PracticeNoteSlot, PracticeStatus } from '../../practice/types'
import type { ImportedSong, SongNote } from '../../songs/types'
import type { PracticePattern } from '../../composables/useSettings'
import type { MeterId, RhythmSubView } from '../../rhythm/types'
import { triggerHaptic } from '../../utils/haptics'

interface Props {
  mode: AppMode
  // Monitor
  isListening: boolean
  currentPitch: PitchInfo | null
  lastStablePitch: PitchInfo | null
  hoveredPoint: { pitch: PitchInfo; time: number } | null
  inputLevel: number
  // Practice
  practiceStatus: PracticeStatus
  practiceRangeMin: number
  practiceRangeMax: number
  practicePattern: PracticePattern
  practiceSlot: PracticeNoteSlot | null
  practicePhase: 'demo' | 'gap' | 'sing' | null
  practiceIndex: number
  practiceTotal: number
  practiceCombo: number
  practiceScore: number
  practiceLiveDir: 'in-tune' | 'sharp' | 'flat' | null
  practiceLiveCents: number | null
  practicePreviewCount: number
  // Songs
  songStatus: PracticeStatus
  songTitle: string
  songTranspose: number
  songTempo: number
  songNote: SongNote | null
  songIsPreview: boolean
  songCombo: number
  songScore: number
  songLiveDir: 'in-tune' | 'sharp' | 'flat' | null
  songLiveCents: number | null
  songs: ImportedSong[]
  selectedSongId: string
  // Rhythm
  rhythmSubView?: RhythmSubView
  rhythmTitle?: string
  rhythmBpm?: number
  rhythmMeter?: MeterId
  rhythmIsPlaying?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  openSheet: []
  cyclePreset: [delta: number]
  cycleSong: [delta: number]
  cycleRhythm: [delta: number]
}>()

const PATTERN_SHORT: Record<PracticePattern, string> = {
  'chromatic-up': '半音上行',
  'chromatic-down': '半音下行',
  'chromatic-up-down': '半音往返',
  'major-scale': '大调音阶',
  pentatonic: '五声音阶',
  'intervals-3rd': '三度音程',
  'intervals-5th': '五度音程',
  random: '随机单音',
}

const activePitch = computed<PitchInfo | null>(() => {
  if (props.hoveredPoint) return props.hoveredPoint.pitch
  if (props.currentPitch) return props.currentPitch
  return props.lastStablePitch
})

const needlePercent = computed(() => {
  if (!activePitch.value) return 50
  const clamped = Math.max(-50, Math.min(50, activePitch.value.cents))
  return 50 + clamped
})

const rangeLabel = computed(() => {
  const low = midiToNoteParts(props.practiceRangeMin).displayFullName
  const high = midiToNoteParts(props.practiceRangeMax).displayFullName
  return `${low}–${high}`
})

const transposeLabel = computed(() => {
  if (props.songTranspose === 0) return '原调'
  return `${props.songTranspose > 0 ? '+' : ''}${props.songTranspose}`
})

const songShortTitle = computed(() =>
  props.songTitle.replace(/（公共领域示例）|\(公共领域示例\)/g, '').trim(),
)

let swipeStartX = 0
let swipeConsumed = false

function onPillPointerDown(event: PointerEvent) {
  swipeStartX = event.clientX
  swipeConsumed = false
}

function onPillPointerUp(event: PointerEvent, kind: 'practice' | 'songs' | 'rhythm') {
  const dx = event.clientX - swipeStartX
  if (Math.abs(dx) >= 36) {
    swipeConsumed = true
    triggerHaptic(10)
    const delta = dx < 0 ? 1 : -1
    if (kind === 'practice') {
      emit('cyclePreset', delta)
    } else if (kind === 'rhythm') {
      emit('cycleRhythm', delta)
    } else {
      emit('cycleSong', delta)
    }
  }
}

function onPillClick() {
  if (swipeConsumed) {
    swipeConsumed = false
    return
  }
  emit('openSheet')
}
</script>

<template>
  <section class="mobile-hud" aria-label="实时状态栏">
    <!-- MONITOR HUD -->
    <div v-if="mode === 'monitor'" class="hud-monitor">
      <div class="hud-note-box">
        <template v-if="activePitch">
          <span class="hud-note-main">
            {{ activePitch.noteLetter
            }}<sup v-if="activePitch.accidental">{{ activePitch.accidental }}</sup
            ><sub class="tabular">{{ activePitch.octave }}</sub>
          </span>
          <div class="hud-note-sub">
            <span>{{ activePitch.solfege }}</span>
            <span class="tabular">{{ activePitch.frequency.toFixed(0) }}Hz</span>
          </div>
        </template>
        <template v-else>
          <span class="hud-note-main is-muted">—</span>
          <span class="hud-note-idle">{{ isListening ? '请发声' : '待机' }}</span>
        </template>
      </div>

      <div class="hud-tuner">
        <div class="tuner-top">
          <span class="tuner-cents tabular" :class="{ 'is-on': !!activePitch }">
            {{ activePitch ? formatCents(activePitch.cents) : '0¢' }}
          </span>
          <div class="vu-line" aria-hidden="true">
            <div class="vu-fill" :style="{ width: `${Math.min(100, Math.round(inputLevel * 100))}%` }"></div>
          </div>
        </div>
        <div class="tuner-track" aria-hidden="true">
          <span class="tuner-zero"></span>
          <span
            v-if="activePitch"
            class="tuner-dot"
            :style="{ left: `${needlePercent}%` }"
          ></span>
        </div>
      </div>
    </div>

    <!-- PRACTICE HUD -->
    <div v-else-if="mode === 'practice'" class="hud-guided">
      <template v-if="practiceStatus === 'idle'">
        <button
          type="button"
          class="swipe-pill"
          @pointerdown="onPillPointerDown"
          @pointerup="onPillPointerUp($event, 'practice')"
          @click="onPillClick"
        >
          <span class="pill-main tabular">{{ rangeLabel }}</span>
          <span class="pill-sep">·</span>
          <span class="pill-sub">{{ PATTERN_SHORT[practicePattern] }}</span>
          <span class="pill-count tabular">{{ practicePreviewCount }}音</span>
          <span class="pill-chevron" aria-hidden="true">▾</span>
        </button>
        <span class="swipe-hint" aria-hidden="true">← 滑切音域 →</span>
      </template>

      <template v-else-if="practiceStatus === 'finished'">
        <button type="button" class="swipe-pill is-score" @click="emit('openSheet')">
          <span class="pill-main tabular">{{ practiceScore }} 分</span>
          <span class="pill-sep">·</span>
          <span class="pill-sub">查看成绩与错音</span>
          <span class="pill-chevron" aria-hidden="true">▾</span>
        </button>
      </template>

      <template v-else>
        <div class="live-guided-row">
          <div class="live-target-badge">
            <span class="phase-chip" :class="`phase-${practicePhase ?? 'demo'}`">
              {{ practicePhase === 'sing' ? '跟唱' : '示范' }}
            </span>
            <span class="live-note-big tabular">
              {{ practiceSlot ? midiToNoteParts(practiceSlot.midi).displayFullName : '—' }}
            </span>
          </div>
          <div class="live-metrics">
            <span
              v-if="practiceLiveDir"
              class="dir-chip tabular"
              :class="`dir-${practiceLiveDir}`"
            >
              {{
                practiceLiveDir === 'in-tune'
                  ? '音准稳'
                  : practiceLiveDir === 'sharp'
                    ? `偏高 ${practiceLiveCents !== null ? formatCents(practiceLiveCents) : ''}`
                    : `偏低 ${practiceLiveCents !== null ? formatCents(practiceLiveCents) : ''}`
              }}
            </span>
            <span class="progress-chip tabular">{{ practiceIndex + 1 }}/{{ practiceTotal }}</span>
            <span v-if="practiceCombo >= 2" class="combo-chip tabular">×{{ practiceCombo }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- RHYTHM HUD -->
    <div v-else-if="mode === 'rhythm'" class="hud-guided">
      <button
        type="button"
        class="swipe-pill"
        @pointerdown="onPillPointerDown"
        @pointerup="onPillPointerUp($event, 'rhythm')"
        @click="onPillClick"
      >
        <span class="pill-main pill-ellipsis">{{ rhythmTitle ?? '抒情慢歌' }}</span>
        <span class="pill-sep">·</span>
        <span class="pill-sub tabular">{{ rhythmMeter ?? '4/4' }} · {{ rhythmBpm ?? 80 }} BPM</span>
        <span class="pill-chevron" aria-hidden="true">▾</span>
      </button>
      <span class="swipe-hint" aria-hidden="true">
        {{ rhythmSubView === 'game' ? '← 滑切关卡 →' : '← 滑切节奏 →' }}
      </span>
    </div>

    <!-- SONGS HUD -->
    <div v-else class="hud-guided">
      <template v-if="songStatus === 'idle'">
        <button
          type="button"
          class="swipe-pill"
          @pointerdown="onPillPointerDown"
          @pointerup="onPillPointerUp($event, 'songs')"
          @click="onPillClick"
        >
          <span class="pill-main pill-ellipsis">{{ songShortTitle }}</span>
          <span class="pill-sep">·</span>
          <span class="pill-sub tabular">{{ transposeLabel }} · {{ songTempo }}×</span>
          <span class="pill-chevron" aria-hidden="true">▾</span>
        </button>
        <span v-if="songs.length > 1" class="swipe-hint" aria-hidden="true">← 滑切曲目 →</span>
      </template>

      <template v-else-if="songStatus === 'finished'">
        <button type="button" class="swipe-pill is-score" @click="emit('openSheet')">
          <span class="pill-main tabular">{{ songScore }} 分</span>
          <span class="pill-sep">·</span>
          <span class="pill-sub">查看评分详情</span>
          <span class="pill-chevron" aria-hidden="true">▾</span>
        </button>
      </template>

      <template v-else>
        <div class="live-guided-row">
          <div class="live-target-badge">
            <span class="phase-chip" :class="songIsPreview ? 'phase-demo' : 'phase-sing'">
              {{ songIsPreview ? '试听' : '跟唱' }}
            </span>
            <span class="live-note-big tabular">
              {{ songNote ? midiToNoteParts(songNote.midi).displayFullName : '—' }}
            </span>
          </div>
          <div class="live-metrics">
            <span
              v-if="!songIsPreview && songLiveDir"
              class="dir-chip tabular"
              :class="`dir-${songLiveDir}`"
            >
              {{
                songLiveDir === 'in-tune'
                  ? '音准稳'
                  : songLiveDir === 'sharp'
                    ? `偏高 ${songLiveCents !== null ? formatCents(songLiveCents) : ''}`
                    : `偏低 ${songLiveCents !== null ? formatCents(songLiveCents) : ''}`
              }}
            </span>
            <span v-if="!songIsPreview && songCombo >= 2" class="combo-chip tabular">
              ×{{ songCombo }}
            </span>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.mobile-hud {
  flex-shrink: 0;
  padding: 0.42rem 0.75rem;
  background-color: var(--surface-panel);
  border-bottom: 1px solid var(--border-hairline);
}

.hud-monitor {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  min-block-size: 46px;
}

.hud-note-box {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-inline-size: 108px;
}

.hud-note-main {
  font-family: var(--font-display);
  font-size: 1.7rem;
  font-weight: 600;
  line-height: 1;
  color: var(--ink-ivory);
}

.hud-note-main.is-muted {
  color: var(--ink-muted);
}

.hud-note-main sup {
  font-size: 0.95rem;
  color: var(--accent-brass);
}

.hud-note-main sub {
  font-size: 0.85rem;
  color: var(--ink-secondary);
}

.hud-note-sub {
  display: flex;
  flex-direction: column;
  font-size: 0.72rem;
  line-height: 1.25;
  color: var(--ink-secondary);
}

.hud-note-idle {
  font-size: 0.78rem;
  color: var(--ink-muted);
}

.hud-tuner {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
  min-inline-size: 0;
}

.tuner-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.tuner-cents {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-muted);
}

.tuner-cents.is-on {
  color: var(--pitch-accurate);
}

.vu-line {
  flex: 1 1 auto;
  height: 4px;
  border-radius: 999px;
  background-color: var(--surface-well);
  overflow: hidden;
}

.vu-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--pitch-accurate), var(--accent-brass));
  transition: width 70ms linear;
}

.tuner-track {
  position: relative;
  height: 8px;
  border-radius: 999px;
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
}

.tuner-zero {
  position: absolute;
  left: 50%;
  top: -1px;
  bottom: -1px;
  width: 2px;
  transform: translateX(-50%);
  background-color: var(--border-strong);
}

.tuner-dot {
  position: absolute;
  top: 50%;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background-color: var(--pitch-accurate);
  box-shadow: 0 0 8px var(--pitch-accurate);
  transition: left 55ms linear;
}

.hud-guided {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-block-size: 44px;
}

.swipe-pill {
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 2.35rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.72rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.84rem;
  touch-action: pan-y;
}

.swipe-pill.is-score {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
}

.pill-main {
  font-weight: 700;
  color: var(--accent-brass);
  white-space: nowrap;
}

.pill-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-sep {
  color: var(--ink-muted);
}

.pill-sub {
  color: var(--ink-ivory);
  font-size: 0.8rem;
  white-space: nowrap;
}

.pill-count {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--ink-muted);
  white-space: nowrap;
}

.pill-chevron {
  color: var(--ink-secondary);
  font-size: 0.78rem;
}

.swipe-hint {
  font-size: 0.68rem;
  color: var(--ink-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.live-guided-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.live-target-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}

.phase-chip {
  padding: 0.14rem 0.48rem;
  border-radius: var(--radius-pill);
  font-size: 0.72rem;
  font-weight: 700;
}

.phase-demo {
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
  border: 1px solid var(--accent-brass);
}

.phase-sing,
.phase-gap {
  background-color: var(--grade-great-soft);
  color: var(--grade-great);
  border: 1px solid var(--grade-great);
}

.live-note-big {
  font-family: var(--font-display);
  font-size: 1.55rem;
  font-weight: 700;
  color: var(--ink-ivory);
  line-height: 1;
}

.live-metrics {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.dir-chip {
  padding: 0.14rem 0.5rem;
  border-radius: var(--radius-pill);
  font-size: 0.74rem;
  font-weight: 600;
}

.dir-in-tune {
  background-color: var(--grade-great-soft);
  color: var(--grade-great);
}

.dir-sharp {
  background-color: var(--grade-miss-soft);
  color: var(--grade-miss);
}

.dir-flat {
  background-color: var(--grade-good-soft);
  color: var(--grade-good);
}

.progress-chip {
  font-size: 0.76rem;
  color: var(--ink-secondary);
}

.combo-chip {
  padding: 0.12rem 0.42rem;
  border-radius: var(--radius-pill);
  background-color: var(--grade-perfect-soft);
  color: var(--grade-perfect);
  font-size: 0.74rem;
  font-weight: 700;
}
</style>
