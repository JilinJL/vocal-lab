<script setup lang="ts">
import { computed } from 'vue'
import { formatCents, midiToNoteParts } from '../../audio/pitchMath'
import {
  useSettings,
  type PracticeListenMode,
  type PracticePattern,
  type PracticeSpeed,
  type PracticeStrictness,
} from '../../composables/useSettings'
import { GRADE_LABELS } from '../../practice/grading'
import type {
  NoteResult,
  PracticeGrade,
  PracticeNoteSlot,
  PracticeSessionRecord,
  PracticeStatus,
} from '../../practice/types'

interface Props {
  status: PracticeStatus
  countdownValue: number
  currentIndex: number
  totalCount: number
  currentSlot: PracticeNoteSlot | null
  activePhase: 'demo' | 'gap' | 'sing' | null
  combo: number
  maxCombo: number
  results: NoteResult[]
  summary: {
    score: number
    counts: Record<PracticeGrade, number>
    maxCombo: number
    missedMidis: number[]
  }
  previewSequence: number[]
  history: PracticeSessionRecord[]
  statusMessage: string | null
  liveDirection: 'in-tune' | 'sharp' | 'flat' | null
  liveCents: number | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  start: [customMidis?: number[]]
  pause: []
  resume: []
  replayCurrent: []
  stop: []
  auditionMidi: [midi: number]
  clearHistory: []
}>()

const settings = useSettings()

const noteOptions = computed(() => {
  const list: Array<{ midi: number; label: string }> = []
  for (let m = 40; m <= 81; m++) {
    const p = midiToNoteParts(m)
    list.push({ midi: m, label: `${p.displayFullName} (${p.solfege})` })
  }
  return list
})

const rangePresets = [
  { label: '低音 C3–G3', min: 48, max: 55 },
  { label: '默认 A3–E4', min: 57, max: 64 },
  { label: '高音 C4–G4', min: 60, max: 67 },
] as const

const patternOptions: ReadonlyArray<{ id: PracticePattern; label: string }> = [
  { id: 'chromatic-up', label: '半音上行' },
  { id: 'chromatic-down', label: '半音下行' },
  { id: 'chromatic-up-down', label: '半音往返' },
  { id: 'major-scale', label: '大调音阶' },
  { id: 'pentatonic', label: '五声音阶' },
  { id: 'intervals-3rd', label: '三度跳进' },
  { id: 'intervals-5th', label: '五度跳进' },
  { id: 'random', label: '随机音高' },
]

const speedOptions: ReadonlyArray<{ id: PracticeSpeed; label: string }> = [
  { id: 'slow', label: '慢速' },
  { id: 'normal', label: '标准' },
  { id: 'fast', label: '快速' },
]

const listenModeOptions: ReadonlyArray<{ id: PracticeListenMode; label: string; tip: string }> = [
  { id: 'listen-then-sing', label: '先听后唱', tip: '外放推荐，避免琴声串音' },
  { id: 'simultaneous', label: '边听边唱', tip: '戴耳机跟唱，参考音同步伴奏' },
]

const strictnessOptions: ReadonlyArray<{ id: PracticeStrictness; label: string }> = [
  { id: 'relaxed', label: '宽松' },
  { id: 'standard', label: '标准' },
  { id: 'strict', label: '严格' },
]

function applyPreset(min: number, max: number) {
  settings.practiceRangeMin = min
  settings.practiceRangeMax = max
}

function onMinChange(e: Event) {
  const val = Number((e.target as HTMLSelectElement).value)
  settings.practiceRangeMin = val
  if (settings.practiceRangeMax < val) {
    settings.practiceRangeMax = val
  }
}

function onMaxChange(e: Event) {
  const val = Number((e.target as HTMLSelectElement).value)
  settings.practiceRangeMax = val
  if (settings.practiceRangeMin > val) {
    settings.practiceRangeMin = val
  }
}

const activeNoteParts = computed(() => {
  if (!props.currentSlot) return null
  return midiToNoteParts(props.currentSlot.midi)
})

const phaseBanner = computed(() => {
  if (props.status === 'countdown') return `倒计时 ${props.countdownValue}`
  if (props.status === 'paused') return '已暂停'
  if (props.activePhase === 'demo') return '聆听示范音'
  if (props.activePhase === 'gap') return '准备起唱'
  if (props.activePhase === 'sing') return '请跟唱当前音'
  return '进行中'
})

const directionLabel = computed(() => {
  if (props.liveDirection === 'in-tune') return '音准稳定'
  if (props.liveDirection === 'sharp') return '偏高 ↓ 略降'
  if (props.liveDirection === 'flat') return '偏低 ↑ 略提'
  return '等待人声…'
})
</script>

<template>
  <aside class="practice-panel studio-scroll" aria-label="音准跟练控制台">
    <div v-if="statusMessage" role="status" class="panel-notice">
      {{ statusMessage }}
    </div>

    <!-- SETUP STATE -->
    <template v-if="status === 'idle'">
      <div class="panel-section">
        <div class="section-head">
          <span class="section-title">练习音域</span>
          <span class="section-meta tabular">共 {{ previewSequence.length }} 音</span>
        </div>

        <div class="preset-row">
          <button
            v-for="preset in rangePresets"
            :key="preset.label"
            type="button"
            class="chip-btn"
            :class="{
              'is-active':
                settings.practiceRangeMin === preset.min &&
                settings.practiceRangeMax === preset.max,
            }"
            @click="applyPreset(preset.min, preset.max)"
          >
            {{ preset.label }}
          </button>
        </div>

        <div class="range-selectors">
          <div class="range-field">
            <label for="prac-min">起始音</label>
            <div class="select-with-audition">
              <select
                id="prac-min"
                :value="settings.practiceRangeMin"
                @change="onMinChange"
              >
                <option v-for="opt in noteOptions" :key="opt.midi" :value="opt.midi">
                  {{ opt.label }}
                </option>
              </select>
              <button
                type="button"
                class="mini-audition"
                title="试听起始音"
                @click="emit('auditionMidi', settings.practiceRangeMin)"
              >
                试听
              </button>
            </div>
          </div>

          <div class="range-field">
            <label for="prac-max">结束音</label>
            <div class="select-with-audition">
              <select
                id="prac-max"
                :value="settings.practiceRangeMax"
                @change="onMaxChange"
              >
                <option v-for="opt in noteOptions" :key="opt.midi" :value="opt.midi">
                  {{ opt.label }}
                </option>
              </select>
              <button
                type="button"
                class="mini-audition"
                title="试听结束音"
                @click="emit('auditionMidi', settings.practiceRangeMax)"
              >
                试听
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="panel-section">
        <label class="section-title" for="prac-pattern">练习音型</label>
        <select id="prac-pattern" v-model="settings.practicePattern" class="full-select">
          <option v-for="opt in patternOptions" :key="opt.id" :value="opt.id">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="panel-section">
        <span class="section-title">跟唱方式</span>
        <div class="seg-row">
          <button
            v-for="mode in listenModeOptions"
            :key="mode.id"
            type="button"
            class="seg-choice"
            :class="{ 'is-active': settings.practiceListenMode === mode.id }"
            :title="mode.tip"
            @click="settings.practiceListenMode = mode.id"
          >
            {{ mode.label }}
          </button>
        </div>
        <p class="helper-text">
          {{ listenModeOptions.find((m) => m.id === settings.practiceListenMode)?.tip }}
        </p>
      </div>

      <div class="panel-section two-col">
        <div>
          <span class="section-title">速度</span>
          <div class="seg-row compact">
            <button
              v-for="sp in speedOptions"
              :key="sp.id"
              type="button"
              class="seg-choice"
              :class="{ 'is-active': settings.practiceSpeed === sp.id }"
              @click="settings.practiceSpeed = sp.id"
            >
              {{ sp.label }}
            </button>
          </div>
        </div>
        <div>
          <span class="section-title">评分严格度</span>
          <div class="seg-row compact">
            <button
              v-for="st in strictnessOptions"
              :key="st.id"
              type="button"
              class="seg-choice"
              :class="{ 'is-active': settings.practiceStrictness === st.id }"
              @click="settings.practiceStrictness = st.id"
            >
              {{ st.label }}
            </button>
          </div>
        </div>
      </div>

      <label class="toggle-line">
        <input v-model="settings.allowOctaveTolerance" type="checkbox" />
        <span>允许八度容错（唱高/低八度仍计分）</span>
      </label>

      <div class="cta-sticky-bar">
        <button type="button" class="cta-start" @click="emit('start')">
          开始逐音练习
        </button>
      </div>

      <!-- Grade Legend -->
      <div class="grade-legend" aria-label="评分等级说明">
        <span class="legend-chip g-perfect">Perfect</span>
        <span class="legend-chip g-great">Great</span>
        <span class="legend-chip g-good">Good</span>
        <span class="legend-chip g-miss">Miss</span>
      </div>

      <!-- Recent History -->
      <div v-if="history.length > 0" class="history-box">
        <div class="section-head">
          <span class="section-title">最近练习</span>
          <button type="button" class="text-btn" @click="emit('clearHistory')">清空</button>
        </div>
        <ul class="history-list">
          <li v-for="item in history.slice(0, 4)" :key="item.id" class="history-item">
            <span class="h-title">{{ item.title }}</span>
            <span class="h-score tabular">{{ item.score }} 分</span>
          </li>
        </ul>
      </div>
    </template>

    <!-- RUNNING / COUNTDOWN / PAUSED HUD -->
    <template v-else-if="status === 'running' || status === 'countdown' || status === 'paused'">
      <div class="hud-top">
        <span
          class="phase-pill"
          :class="{
            'is-demo': activePhase === 'demo',
            'is-sing': activePhase === 'sing',
            'is-paused': status === 'paused',
          }"
        >
          {{ phaseBanner }}
        </span>
        <span class="progress-text tabular">
          {{ Math.min(currentIndex + 1, totalCount) }} / {{ totalCount }}
        </span>
      </div>

      <div class="target-card">
        <span class="target-caption">当前目标音</span>
        <div v-if="activeNoteParts" class="target-glyph">
          <span class="t-letter">{{ activeNoteParts.noteLetter }}</span>
          <span v-if="activeNoteParts.accidental" class="t-acc">{{ activeNoteParts.accidental }}</span>
          <span class="t-oct tabular">{{ activeNoteParts.octave }}</span>
        </div>
        <div v-if="activeNoteParts" class="target-sub">
          {{ activeNoteParts.solfege }} · 简谱 {{ activeNoteParts.jianpu }}
        </div>

        <div
          class="direction-badge tabular"
          :class="{
            'dir-ok': liveDirection === 'in-tune',
            'dir-sharp': liveDirection === 'sharp',
            'dir-flat': liveDirection === 'flat',
          }"
        >
          <span>{{ directionLabel }}</span>
          <span v-if="liveCents !== null">{{ formatCents(liveCents) }}</span>
        </div>
      </div>

      <div class="live-stats">
        <div class="stat-pill">
          <span class="stat-label">连击</span>
          <strong class="stat-val tabular">{{ combo }}</strong>
        </div>
        <div class="stat-pill">
          <span class="stat-label">当前均分</span>
          <strong class="stat-val tabular">{{ summary.score }}</strong>
        </div>
      </div>

      <div class="grade-counters tabular">
        <span class="gc g-perfect">Perfect {{ summary.counts.perfect }}</span>
        <span class="gc g-great">Great {{ summary.counts.great }}</span>
        <span class="gc g-good">Good {{ summary.counts.good }}</span>
        <span class="gc g-miss">Miss {{ summary.counts.miss }}</span>
      </div>

      <div class="hud-actions">
        <button
          v-if="status === 'paused'"
          type="button"
          class="cta-start"
          @click="emit('resume')"
        >
          继续练习
        </button>
        <button
          v-else
          type="button"
          class="btn-secondary"
          @click="emit('pause')"
        >
          暂停
        </button>
        <button type="button" class="btn-secondary" @click="emit('replayCurrent')">
          重听本音
        </button>
        <button type="button" class="btn-danger-ghost" @click="emit('stop')">
          结束
        </button>
      </div>
    </template>

    <!-- FINISHED SUMMARY -->
    <template v-else-if="status === 'finished'">
      <div class="summary-hero">
        <span class="target-caption">本轮成绩</span>
        <div class="summary-score tabular">{{ summary.score }}<span> 分</span></div>
        <span class="summary-meta tabular">最高连击 {{ summary.maxCombo }} · 共 {{ results.length }} 音</span>
      </div>

      <div class="grade-counters tabular">
        <span class="gc g-perfect">Perfect {{ summary.counts.perfect }}</span>
        <span class="gc g-great">Great {{ summary.counts.great }}</span>
        <span class="gc g-good">Good {{ summary.counts.good }}</span>
        <span class="gc g-miss">Miss {{ summary.counts.miss }}</span>
      </div>

      <div class="result-list studio-scroll">
        <div v-for="res in results" :key="res.noteId" class="result-row">
          <span class="res-note">{{ midiToNoteParts(res.midi).displayFullName }}</span>
          <span class="res-badge" :class="`g-${res.grade}`">
            {{ GRADE_LABELS[res.grade].title }}
          </span>
          <span class="res-cents tabular">
            {{ res.voicedRatio > 0 ? formatCents(res.meanCents) : '未发声' }}
          </span>
        </div>
      </div>

      <div class="summary-actions">
        <button
          v-if="summary.missedMidis.length > 0"
          type="button"
          class="cta-start"
          @click="emit('start', summary.missedMidis)"
        >
          只练薄弱音 ({{ summary.missedMidis.length }})
        </button>
        <button type="button" class="btn-secondary" @click="emit('start')">
          再来一次
        </button>
        <button type="button" class="btn-danger-ghost" @click="emit('stop')">
          返回设置
        </button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.practice-panel {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  padding: 0.8rem 0.9rem;
  background-color: var(--surface-panel);
  border-inline-end: 1px solid var(--border-hairline);
  overflow-y: auto;
}

.panel-notice {
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  background-color: var(--accent-brass-soft);
  border: 1px solid var(--accent-brass);
  color: var(--ink-ivory);
  font-size: 0.8rem;
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.section-title {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--ink-secondary);
  letter-spacing: 0.03em;
}

.section-meta {
  font-size: 0.74rem;
  color: var(--accent-brass);
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip-btn {
  padding: 0.28rem 0.55rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-secondary);
  font-size: 0.75rem;
  font-weight: 500;
}

.chip-btn.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

.range-selectors {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.45rem;
}

.range-field {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.range-field label {
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.select-with-audition {
  display: flex;
  gap: 0.35rem;
}

.select-with-audition select,
.full-select {
  flex: 1 1 auto;
  min-inline-size: 0;
  padding: 0.38rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-well);
  color: var(--ink-ivory);
  font-size: 0.82rem;
}

.mini-audition {
  padding: 0.35rem 0.58rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-raised);
  color: var(--accent-brass);
  font-size: 0.76rem;
  font-weight: 600;
}

.seg-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.32rem;
}

.seg-row.compact {
  grid-template-columns: repeat(3, 1fr);
}

.seg-choice {
  padding: 0.35rem 0.4rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-well);
  color: var(--ink-secondary);
  font-size: 0.78rem;
  font-weight: 500;
}

.seg-choice.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--ink-ivory);
  font-weight: 600;
}

.helper-text {
  margin: 0;
  font-size: 0.73rem;
  color: var(--ink-muted);
}

.two-col {
  gap: 0.65rem;
}

.toggle-line {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  font-size: 0.78rem;
  color: var(--ink-secondary);
  cursor: pointer;
}

.cta-start {
  width: 100%;
  min-block-size: 2.55rem;
  padding: 0.55rem 0.9rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-brass);
  background-color: var(--accent-brass);
  color: var(--accent-brass-ink);
  font-size: 0.9rem;
  font-weight: 700;
}

.cta-sticky-bar {
  position: sticky;
  bottom: 0;
  z-index: 2;
  padding-top: 0.35rem;
  background: linear-gradient(180deg, transparent 0%, var(--surface-panel) 28%);
}

.btn-secondary {
  min-block-size: 2.3rem;
  padding: 0.45rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.84rem;
  font-weight: 600;
}

.btn-danger-ghost {
  min-block-size: 2.2rem;
  padding: 0.42rem 0.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: transparent;
  color: var(--ink-secondary);
  font-size: 0.82rem;
}

.grade-legend {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.3rem;
}

.legend-chip,
.gc,
.res-badge {
  text-align: center;
  padding: 0.22rem 0.32rem;
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
  font-weight: 700;
  border: 1px solid transparent;
}

.g-perfect {
  color: var(--grade-perfect);
  background-color: var(--grade-perfect-soft);
  border-color: color-mix(in oklab, var(--grade-perfect) 55%, transparent);
}

.g-great {
  color: var(--grade-great);
  background-color: var(--grade-great-soft);
  border-color: color-mix(in oklab, var(--grade-great) 55%, transparent);
}

.g-good {
  color: var(--grade-good);
  background-color: var(--grade-good-soft);
  border-color: color-mix(in oklab, var(--grade-good) 55%, transparent);
}

.g-miss {
  color: var(--grade-miss);
  background-color: var(--grade-miss-soft);
  border-color: color-mix(in oklab, var(--grade-miss) 55%, transparent);
}

/* HUD */
.hud-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.phase-pill {
  padding: 0.24rem 0.65rem;
  border-radius: var(--radius-pill);
  font-size: 0.76rem;
  font-weight: 700;
  background-color: var(--surface-raised);
  color: var(--ink-secondary);
}

.phase-pill.is-demo {
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

.phase-pill.is-sing {
  background-color: var(--grade-great-soft);
  color: var(--grade-great);
}

.phase-pill.is-paused {
  background-color: var(--grade-miss-soft);
  color: var(--grade-miss);
}

.progress-text {
  font-size: 0.82rem;
  color: var(--ink-secondary);
  font-weight: 600;
}

.target-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  padding: 0.9rem 0.75rem;
  border-radius: var(--radius-md);
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
}

.target-caption {
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.target-glyph {
  display: inline-flex;
  align-items: baseline;
  line-height: 1;
}

.t-letter {
  font-family: var(--font-display);
  font-size: 3.1rem;
  color: var(--ink-ivory);
}

.t-acc {
  font-family: var(--font-display);
  font-size: 1.6rem;
  color: var(--accent-brass);
}

.t-oct {
  font-size: 1.35rem;
  color: var(--ink-secondary);
  margin-left: 0.1rem;
}

.target-sub {
  font-size: 0.8rem;
  color: var(--ink-secondary);
}

.direction-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.2rem;
  padding: 0.26rem 0.7rem;
  border-radius: var(--radius-pill);
  font-size: 0.78rem;
  font-weight: 600;
  background-color: var(--surface-raised);
  color: var(--ink-muted);
}

.direction-badge.dir-ok {
  background-color: var(--grade-great-soft);
  color: var(--grade-great);
}

.direction-badge.dir-sharp {
  background-color: var(--pitch-sharp-soft);
  color: var(--pitch-sharp);
}

.direction-badge.dir-flat {
  background-color: var(--pitch-flat-soft);
  color: var(--pitch-flat);
}

.live-stats {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.45rem;
}

.stat-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
}

.stat-label {
  font-size: 0.7rem;
  color: var(--ink-muted);
}

.stat-val {
  font-size: 1.15rem;
  color: var(--ink-ivory);
}

.grade-counters {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.35rem;
}

.hud-actions,
.summary-actions {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

/* Summary */
.summary-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.85rem;
  border-radius: var(--radius-md);
  background-color: var(--surface-well);
  border: 1px solid var(--border-strong);
}

.summary-score {
  font-family: var(--font-display);
  font-size: 2.7rem;
  line-height: 1.05;
  color: var(--accent-brass);
}

.summary-score span {
  font-family: var(--font-sans);
  font-size: 0.9rem;
  color: var(--ink-secondary);
}

.summary-meta {
  font-size: 0.76rem;
  color: var(--ink-secondary);
  margin-top: 0.2rem;
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  max-block-size: 190px;
  overflow-y: auto;
}

.result-row {
  display: grid;
  grid-template-columns: 46px 1fr 56px;
  align-items: center;
  gap: 0.45rem;
  padding: 0.32rem 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--surface-well);
  font-size: 0.8rem;
}

.res-note {
  font-weight: 700;
  color: var(--ink-ivory);
}

.res-cents {
  text-align: right;
  font-size: 0.76rem;
  color: var(--ink-secondary);
}

.history-box {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.45rem;
  border-top: 1px solid var(--border-hairline);
}

.text-btn {
  border: none;
  background: none;
  color: var(--ink-muted);
  font-size: 0.74rem;
  padding: 0;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.history-item {
  display: flex;
  justify-content: space-between;
  font-size: 0.76rem;
  color: var(--ink-secondary);
}

.h-score {
  color: var(--accent-brass);
  font-weight: 600;
}

@media (max-width: 900px) {
  .practice-panel {
    border-inline-end: none;
    border-block-end: 1px solid var(--border-hairline);
  }

  .range-selectors {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
