<script setup lang="ts">
import type { AppMode } from '../StudioHeader.vue'
import type { PracticeStatus } from '../../practice/types'
import { triggerHaptic } from '../../utils/haptics'

interface Props {
  mode: AppMode
  isListening: boolean
  isDemo: boolean
  hasSamples: boolean
  pianoOpen: boolean
  hasSustainedDrone: boolean
  practiceStatus: PracticeStatus
  practiceMissedCount: number
  songStatus: PracticeStatus
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:mode': [value: AppMode]
  toggleListen: []
  clearMonitor: []
  loadDemo: []
  togglePiano: []
  openSheet: []
  startPractice: []
  retryMissed: []
  pausePractice: []
  resumePractice: []
  replayPractice: []
  stopPractice: []
  previewSong: []
  startSong: []
  pauseSong: []
  resumeSong: []
  stopSong: []
}>()

const MODE_ORDER: AppMode[] = ['monitor', 'practice', 'songs']
let navSwipeX = 0

function onNavPointerDown(event: PointerEvent) {
  navSwipeX = event.clientX
}

function onNavPointerUp(event: PointerEvent) {
  const dx = event.clientX - navSwipeX
  if (Math.abs(dx) < 42) return
  const idx = MODE_ORDER.indexOf(props.mode)
  const nextIdx = dx < 0 ? Math.min(MODE_ORDER.length - 1, idx + 1) : Math.max(0, idx - 1)
  if (nextIdx !== idx) {
    triggerHaptic(10)
    emit('update:mode', MODE_ORDER[nextIdx]!)
  }
}

function selectMode(next: AppMode) {
  if (next === props.mode) return
  triggerHaptic(8)
  emit('update:mode', next)
}
</script>

<template>
  <div class="mobile-dock">
    <!-- Row 1: Thumb-zone primary controls -->
    <div class="action-bar">
      <!-- MONITOR ACTIONS -->
      <template v-if="mode === 'monitor'">
        <button
          type="button"
          class="dock-icon-btn"
          :class="{ 'is-active': isDemo }"
          @click="emit('loadDemo')"
        >
          <span>示例</span>
        </button>

        <button
          type="button"
          class="dock-primary-btn"
          :class="{ 'is-live': isListening }"
          @click="emit('toggleListen')"
        >
          <span class="live-dot" aria-hidden="true"></span>
          <span>{{ isListening ? '停止' : '开始检测' }}</span>
        </button>

        <button
          type="button"
          class="dock-icon-btn"
          :disabled="!hasSamples"
          @click="emit('clearMonitor')"
        >
          <span>清空</span>
        </button>

        <button
          type="button"
          class="dock-icon-btn"
          :class="{ 'is-active': pianoOpen || hasSustainedDrone }"
          aria-label="打开标准音钢琴"
          @click="emit('togglePiano')"
        >
          <span>钢琴</span>
        </button>
      </template>

      <!-- PRACTICE ACTIONS -->
      <template v-else-if="mode === 'practice'">
        <template v-if="practiceStatus === 'idle'">
          <button type="button" class="dock-icon-btn" @click="emit('openSheet')">
            <span>调音域</span>
          </button>
          <button type="button" class="dock-primary-btn" @click="emit('startPractice')">
            <span>开始练习</span>
          </button>
          <button
            type="button"
            class="dock-icon-btn"
            :class="{ 'is-active': pianoOpen || hasSustainedDrone }"
            @click="emit('togglePiano')"
          >
            <span>钢琴</span>
          </button>
        </template>

        <template v-else-if="practiceStatus === 'finished'">
          <button
            v-if="practiceMissedCount > 0"
            type="button"
            class="dock-icon-btn is-accent"
            @click="emit('retryMissed')"
          >
            <span>重练错音</span>
          </button>
          <button type="button" class="dock-primary-btn" @click="emit('startPractice')">
            <span>再练一次</span>
          </button>
          <button type="button" class="dock-icon-btn" @click="emit('openSheet')">
            <span>成绩</span>
          </button>
        </template>

        <template v-else>
          <button type="button" class="dock-icon-btn" @click="emit('replayPractice')">
            <span>重听</span>
          </button>
          <button
            type="button"
            class="dock-primary-btn"
            @click="practiceStatus === 'paused' ? emit('resumePractice') : emit('pausePractice')"
          >
            <span>{{ practiceStatus === 'paused' ? '继续' : '暂停' }}</span>
          </button>
          <button type="button" class="dock-icon-btn is-danger" @click="emit('stopPractice')">
            <span>结束</span>
          </button>
        </template>
      </template>

      <!-- SONGS ACTIONS -->
      <template v-else>
        <template v-if="songStatus === 'idle'">
          <button type="button" class="dock-icon-btn" @click="emit('previewSong')">
            <span>试听</span>
          </button>
          <button type="button" class="dock-primary-btn" @click="emit('startSong')">
            <span>开始跟唱</span>
          </button>
          <button type="button" class="dock-icon-btn" @click="emit('openSheet')">
            <span>曲库</span>
          </button>
          <button
            type="button"
            class="dock-icon-btn"
            :class="{ 'is-active': pianoOpen || hasSustainedDrone }"
            @click="emit('togglePiano')"
          >
            <span>钢琴</span>
          </button>
        </template>

        <template v-else-if="songStatus === 'finished'">
          <button type="button" class="dock-icon-btn" @click="emit('previewSong')">
            <span>试听</span>
          </button>
          <button type="button" class="dock-primary-btn" @click="emit('startSong')">
            <span>再唱一次</span>
          </button>
          <button type="button" class="dock-icon-btn" @click="emit('openSheet')">
            <span>成绩</span>
          </button>
        </template>

        <template v-else>
          <button
            type="button"
            class="dock-primary-btn"
            @click="songStatus === 'paused' ? emit('resumeSong') : emit('pauseSong')"
          >
            <span>{{ songStatus === 'paused' ? '继续' : '暂停' }}</span>
          </button>
          <button type="button" class="dock-icon-btn is-danger" @click="emit('stopSong')">
            <span>结束</span>
          </button>
        </template>
      </template>
    </div>

    <!-- Row 2: Native bottom tab bar (swipeable left/right) -->
    <nav
      class="tab-bar"
      aria-label="底部模式导航"
      @pointerdown="onNavPointerDown"
      @pointerup="onNavPointerUp"
    >
      <button
        type="button"
        class="tab-item"
        :class="{ 'is-active': mode === 'monitor' }"
        :aria-current="mode === 'monitor' ? 'page' : undefined"
        @click="selectMode('monitor')"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M2.5 12.5c2.2 0 3-6.5 5-6.5s2.8 8 5 8 2.4-4.5 5-4.5"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
        <span>监测</span>
      </button>

      <button
        type="button"
        class="tab-item"
        :class="{ 'is-active': mode === 'practice' }"
        :aria-current="mode === 'practice' ? 'page' : undefined"
        @click="selectMode('practice')"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="12.5" width="4.5" height="3.5" rx="1.2" stroke="currentColor" stroke-width="1.6" />
          <rect x="7.75" y="8.2" width="4.5" height="3.5" rx="1.2" stroke="currentColor" stroke-width="1.6" />
          <rect x="12.5" y="4" width="4.5" height="3.5" rx="1.2" stroke="currentColor" stroke-width="1.6" />
        </svg>
        <span>练习</span>
      </button>

      <button
        type="button"
        class="tab-item"
        :class="{ 'is-active': mode === 'songs' }"
        :aria-current="mode === 'songs' ? 'page' : undefined"
        @click="selectMode('songs')"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M8 14.5V5.2l8-1.7v9.2"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <circle cx="6" cy="14.5" r="2.2" stroke="currentColor" stroke-width="1.6" />
          <circle cx="14" cy="12.8" r="2.2" stroke="currentColor" stroke-width="1.6" />
        </svg>
        <span>跟唱</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.mobile-dock {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--surface-panel);
  border-top: 1px solid var(--border-strong);
  padding-bottom: env(safe-area-inset-bottom);
}

.action-bar {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.7rem 0.42rem;
}

.dock-primary-btn {
  flex: 1.5 1 0;
  min-block-size: 2.7rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0.4rem 0.9rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--accent-brass);
  background-color: var(--accent-brass);
  color: var(--accent-brass-ink);
  font-size: 0.92rem;
  font-weight: 700;
  white-space: nowrap;
}

.dock-primary-btn.is-live {
  background-color: var(--pitch-sharp);
  border-color: var(--pitch-sharp);
  color: #11161c;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: currentColor;
}

.dock-icon-btn {
  flex: 0.85 1 0;
  min-block-size: 2.55rem;
  padding: 0.3rem 0.5rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.dock-icon-btn:disabled {
  opacity: 0.36;
}

.dock-icon-btn.is-active,
.dock-icon-btn.is-accent {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

.dock-icon-btn.is-danger {
  border-color: var(--grade-miss);
  color: var(--grade-miss);
}

.tab-bar {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-top: 1px solid var(--border-hairline);
  background-color: var(--surface-chassis);
  touch-action: pan-y;
}

.tab-item {
  min-block-size: 3rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.14rem;
  border: none;
  background: transparent;
  color: var(--ink-muted);
  font-size: 0.7rem;
  font-weight: 600;
}

.tab-item.is-active {
  color: var(--accent-brass);
}
</style>
