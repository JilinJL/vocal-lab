<script setup lang="ts">
import { computed } from 'vue'
import {
  BASIC_BEAT_PRESETS,
  GROOVE_CATEGORIES,
  GROOVE_PRESETS,
  RHYTHM_GAME_CHALLENGES,
} from '../../rhythm/grooves'
import { formatTimingBias } from '../../rhythm/scoring'
import type {
  GrooveCategory,
  MeterId,
  RhythmGameRecord,
  RhythmGameTargetMode,
  RhythmSubView,
} from '../../rhythm/types'

interface Props {
  subView: RhythmSubView
  activeBasicPresetId: string
  activeCategory: GrooveCategory
  activeGrooveId: string
  grooveMeter: MeterId
  swing: number
  selectedChallengeId: string
  gameTargetMode: RhythmGameTargetMode
  gameBars: number
  gameBlindBars: boolean
  history: RhythmGameRecord[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  selectBasicPreset: [id: string]
  'update:activeCategory': [cat: GrooveCategory]
  selectGroove: [id: string]
  'update:grooveMeter': [meter: MeterId]
  'update:swing': [swing: number]
  selectChallenge: [id: string]
  'update:gameTargetMode': [mode: RhythmGameTargetMode]
  'update:gameBars': [bars: number]
  'update:gameBlindBars': [blind: boolean]
  clearHistory: []
}>()

const filteredGrooves = computed(() =>
  GROOVE_PRESETS.filter((g) => g.category === props.activeCategory),
)

const TARGET_MODES: ReadonlyArray<{ id: RhythmGameTargetMode; label: string }> = [
  { id: 'beat', label: '正拍' },
  { id: 'kick', label: '底鼓' },
  { id: 'snare', label: '军鼓' },
  { id: 'backbone', label: '底+军' },
]

const BAR_OPTIONS = [4, 8, 12] as const
const SWING_OPTIONS = [
  { value: 0.5, label: '直拍 50%' },
  { value: 0.58, label: '轻摇摆 58%' },
  { value: 0.66, label: '硬摇摆 66%' },
] as const
const METERS: readonly MeterId[] = ['4/4', '3/4', '2/4', '6/8']
</script>

<template>
  <aside class="rhythm-sidebar" aria-label="节奏库与参数设置">
    <!-- BEAT PRESETS -->
    <template v-if="subView === 'beat'">
      <div class="panel-section">
        <h2 class="section-title">基础拍感练习</h2>
        <div class="preset-grid">
          <button
            v-for="p in BASIC_BEAT_PRESETS"
            :key="p.id"
            type="button"
            class="preset-card"
            :class="{ 'is-active': activeBasicPresetId === p.id }"
            @click="emit('selectBasicPreset', p.id)"
          >
            <strong>{{ p.name }}</strong>
            <span>{{ p.desc }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- GROOVE LIBRARY -->
    <template v-else-if="subView === 'groove'">
      <div class="panel-section">
        <h2 class="section-title">经典节奏库</h2>
        <div class="cat-bar">
          <button
            v-for="cat in GROOVE_CATEGORIES"
            :key="cat"
            type="button"
            class="cat-chip"
            :class="{ 'is-active': activeCategory === cat }"
            @click="emit('update:activeCategory', cat)"
          >
            {{ cat }}
          </button>
        </div>

        <div class="preset-grid">
          <button
            v-for="g in filteredGrooves"
            :key="g.id"
            type="button"
            class="preset-card"
            :class="{ 'is-active': activeGrooveId === g.id }"
            @click="emit('selectGroove', g.id)"
          >
            <strong>{{ g.name }}</strong>
            <span>{{ g.meter }} · {{ g.bpm }} BPM</span>
            <small>{{ g.desc }}</small>
          </button>
        </div>
      </div>

      <div class="panel-section">
        <h2 class="section-title">拍号与摇摆感</h2>
        <div class="inline-chips">
          <button
            v-for="m in METERS"
            :key="m"
            type="button"
            class="seg-chip tabular"
            :class="{ 'is-active': grooveMeter === m }"
            @click="emit('update:grooveMeter', m)"
          >
            {{ m }}
          </button>
        </div>

        <div class="inline-chips">
          <button
            v-for="s in SWING_OPTIONS"
            :key="s.value"
            type="button"
            class="seg-chip tabular"
            :class="{ 'is-active': Math.abs(swing - s.value) < 0.02 }"
            @click="emit('update:swing', s.value)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>
    </template>

    <!-- GAME CHALLENGES & SETTINGS -->
    <template v-else>
      <div class="panel-section">
        <h2 class="section-title">节奏闯关关卡</h2>
        <div class="challenge-list">
          <button
            v-for="ch in RHYTHM_GAME_CHALLENGES"
            :key="ch.id"
            type="button"
            class="challenge-card"
            :class="{ 'is-active': selectedChallengeId === ch.id }"
            @click="emit('selectChallenge', ch.id)"
          >
            <div class="challenge-head">
              <strong>{{ ch.name }}</strong>
              <span class="tabular">{{ ch.bpm }} BPM</span>
            </div>
            <p>{{ ch.desc }}</p>
          </button>
        </div>
      </div>

      <div class="panel-section">
        <h2 class="section-title">自定义关卡参数</h2>
        <div class="param-row">
          <span class="param-label">敲击目标</span>
          <div class="inline-chips">
            <button
              v-for="tm in TARGET_MODES"
              :key="tm.id"
              type="button"
              class="seg-chip"
              :class="{ 'is-active': gameTargetMode === tm.id }"
              @click="emit('update:gameTargetMode', tm.id)"
            >
              {{ tm.label }}
            </button>
          </div>
        </div>

        <div class="param-row">
          <span class="param-label">小节数</span>
          <div class="inline-chips">
            <button
              v-for="b in BAR_OPTIONS"
              :key="b"
              type="button"
              class="seg-chip tabular"
              :class="{ 'is-active': gameBars === b }"
              @click="emit('update:gameBars', b)"
            >
              {{ b }} 小节
            </button>
          </div>
        </div>

        <div class="param-row is-toggle">
          <div>
            <span class="param-label">盲拍挑战（2 有声 + 2 静音）</span>
            <p class="param-desc">静音小节不响鼓，专练内心稳定拍感</p>
          </div>
          <button
            type="button"
            class="toggle-pill"
            :class="{ 'is-on': gameBlindBars }"
            @click="emit('update:gameBlindBars', !gameBlindBars)"
          >
            {{ gameBlindBars ? '已开' : '关闭' }}
          </button>
        </div>
      </div>

      <div v-if="history.length > 0" class="panel-section">
        <div class="section-head-row">
          <h2 class="section-title">最近战绩</h2>
          <button type="button" class="text-btn" @click="emit('clearHistory')">清空</button>
        </div>
        <div class="history-list">
          <div v-for="rec in history.slice(0, 5)" :key="rec.id" class="history-item">
            <div class="history-left">
              <strong>{{ rec.challengeName }}</strong>
              <span class="tabular">
                {{ rec.bpm }} BPM · {{ formatTimingBias(rec.avgOffsetMs) }} · ±{{ rec.stabilityMs }}ms
              </span>
            </div>
            <span class="history-score tabular">{{ rec.score }}分</span>
          </div>
        </div>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.rhythm-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.85rem 0.9rem;
  background-color: var(--surface-panel);
  border-inline-end: 1px solid var(--border-hairline);
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.section-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-title {
  margin: 0;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ink-secondary);
}

.cat-bar {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.cat-chip {
  padding: 0.28rem 0.65rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-secondary);
  font-size: 0.76rem;
  font-weight: 600;
}

.cat-chip.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.preset-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.14rem;
  padding: 0.58rem 0.65rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  text-align: left;
}

.preset-card strong {
  font-size: 0.84rem;
  color: var(--ink-ivory);
}

.preset-card span {
  font-size: 0.7rem;
  color: var(--accent-brass);
}

.preset-card small {
  font-size: 0.68rem;
  color: var(--ink-muted);
  line-height: 1.3;
}

.preset-card.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
}

.inline-chips {
  display: flex;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.seg-chip {
  flex: 1 1 auto;
  min-block-size: 2rem;
  padding: 0.24rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-well);
  color: var(--ink-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.seg-chip.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

.challenge-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.challenge-card {
  display: flex;
  flex-direction: column;
  gap: 0.22rem;
  padding: 0.62rem 0.72rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  text-align: left;
}

.challenge-card.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
}

.challenge-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.challenge-head strong {
  font-size: 0.84rem;
  color: var(--ink-ivory);
}

.challenge-head span {
  font-size: 0.72rem;
  color: var(--accent-brass);
  font-weight: 600;
}

.challenge-card p {
  margin: 0;
  font-size: 0.72rem;
  color: var(--ink-muted);
  line-height: 1.35;
}

.param-row {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.param-row.is-toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.param-label {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--ink-ivory);
}

.param-desc {
  margin: 0.12rem 0 0;
  font-size: 0.69rem;
  color: var(--ink-muted);
}

.toggle-pill {
  min-inline-size: 3.4rem;
  min-block-size: 2rem;
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-well);
  color: var(--ink-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.toggle-pill.is-on {
  border-color: var(--rhythm-fill);
  background-color: color-mix(in oklab, var(--rhythm-fill) 18%, var(--surface-well));
  color: var(--rhythm-fill);
}

.text-btn {
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-size: 0.74rem;
  padding: 0.15rem 0.3rem;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
}

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
}

.history-left {
  display: flex;
  flex-direction: column;
  gap: 0.08rem;
  min-inline-size: 0;
}

.history-left strong {
  font-size: 0.76rem;
  color: var(--ink-ivory);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-left span {
  font-size: 0.68rem;
  color: var(--ink-muted);
}

.history-score {
  font-size: 0.86rem;
  font-weight: 700;
  color: var(--accent-brass);
  flex-shrink: 0;
}
</style>
