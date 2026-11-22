<script setup lang="ts">
import { useTemplateRef } from 'vue'
import { useToolbarFocusgroup } from '../composables/useToolbarFocusgroup'

interface Props {
  isListening: boolean
  isDemo: boolean
  hasSamples: boolean
  windowSeconds: number
  a4Hz: number
  autoFollow: boolean
}

const { isListening, isDemo, hasSamples, windowSeconds, a4Hz, autoFollow } = defineProps<Props>()

const emit = defineEmits<{
  toggleListen: []
  clear: []
  loadDemo: []
  'update:windowSeconds': [value: number]
  'update:a4Hz': [value: number]
  'update:autoFollow': [value: boolean]
}>()

const toolbarEl = useTemplateRef<HTMLElement>('toolbarRef')
useToolbarFocusgroup(toolbarEl)

const windowOptions = [6, 12, 24] as const

function handleClear() {
  if (!hasSamples) return
  emit('clear')
}

function stepA4(delta: number) {
  const next = Math.max(432, Math.min(446, a4Hz + delta))
  if (next !== a4Hz) {
    emit('update:a4Hz', next)
  }
}
</script>

<template>
  <header class="studio-header">
    <div class="brand">
      <svg
        class="brand-mark"
        viewBox="0 0 28 28"
        width="26"
        height="26"
        aria-hidden="true"
        fill="none"
      >
        <rect
          x="1.5"
          y="1.5"
          width="25"
          height="25"
          rx="7"
          stroke="currentColor"
          stroke-opacity="0.35"
          stroke-width="1.25"
        />
        <path
          d="M6.5 16.5C9.2 16.5 9.8 10 12.2 10C14.6 10 14.8 18.5 17.2 18.5C19.4 18.5 20.1 12.5 22 12.5"
          stroke="var(--accent-brass)"
          stroke-width="2"
          stroke-linecap="round"
        />
        <circle cx="22" cy="12.5" r="2" fill="var(--pitch-accurate)" />
      </svg>
      <div class="brand-text">
        <h1 class="brand-title">声镜</h1>
        <span class="brand-sub" lang="en">Sonic Mirror</span>
      </div>
    </div>

    <div
      ref="toolbarRef"
      role="toolbar"
      focusgroup="toolbar wrap"
      aria-label="声乐监测控制栏"
      aria-controls="pitch-stage"
      class="controls-toolbar"
    >
      <div role="group" aria-label="麦克风与录制控制" class="control-group">
        <button
          type="button"
          class="btn-primary"
          :class="{ 'is-live': isListening }"
          :aria-pressed="isListening"
          @click="emit('toggleListen')"
        >
          <span class="live-dot" aria-hidden="true"></span>
          <span>{{ isListening ? '停止检测' : '开始检测' }}</span>
        </button>

        <button
          type="button"
          class="btn-ghost"
          :aria-disabled="!hasSamples"
          title="清空当前音高曲线"
          @click="handleClear"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 4.5h10M6.2 4.5V3.2c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.3M5 4.5l.6 8.3c0 .4.4.7.8.7h3.2c.4 0 .8-.3.8-.7l.6-8.3"
              stroke="currentColor"
              stroke-width="1.35"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>清空</span>
        </button>

        <button
          type="button"
          class="btn-ghost"
          :aria-pressed="isDemo"
          title="载入一段模拟人声旋律曲线以便预览悬停查音"
          @click="emit('loadDemo')"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M2.5 11.5c2 0 2.5-6 4.5-6s2.5 7 4.5 7 1.8-4 2.5-4"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
          <span>示例</span>
        </button>
      </div>

      <span role="separator" aria-orientation="vertical" class="toolbar-sep"></span>

      <div role="group" aria-label="时间轴跨度" class="control-group segmented">
        <button
          v-for="sec in windowOptions"
          :key="sec"
          type="button"
          class="seg-btn tabular"
          :aria-pressed="windowSeconds === sec"
          @click="emit('update:windowSeconds', sec)"
        >
          {{ sec }}s
        </button>
      </div>

      <span role="separator" aria-orientation="vertical" class="toolbar-sep"></span>

      <div role="group" aria-label="视图与基准音" class="control-group">
        <button
          type="button"
          class="btn-ghost"
          :aria-pressed="autoFollow"
          title="纵轴音域自动跟随人声高度"
          @click="emit('update:autoFollow', !autoFollow)"
        >
          <span>自动跟随</span>
        </button>

        <div class="a4-stepper" aria-label="A4 标准音基准频率">
          <button
            type="button"
            class="step-btn"
            aria-label="降低 A4 基准频率 1 赫兹"
            :aria-disabled="a4Hz <= 432"
            @click="stepA4(-1)"
          >
            −
          </button>
          <span class="a4-value tabular">A4 {{ a4Hz }}Hz</span>
          <button
            type="button"
            class="step-btn"
            aria-label="提高 A4 基准频率 1 赫兹"
            :aria-disabled="a4Hz >= 446"
            @click="stepA4(1)"
          >
            +
          </button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 1.25rem;
  background-color: var(--surface-panel);
  border-bottom: 1px solid var(--border-hairline);
  flex-wrap: wrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-inline-size: 0;
}

.brand-mark {
  flex-shrink: 0;
  color: var(--ink-ivory);
}

.brand-text {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
}

.brand-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 1.1rem + 0.4vw, 1.5rem);
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--ink-ivory);
  line-height: 1.1;
}

.brand-sub {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.92rem;
  color: var(--ink-secondary);
}

.controls-toolbar {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}

.control-group {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.toolbar-sep {
  display: inline-block;
  inline-size: 1px;
  block-size: 1.35rem;
  border-inline-start: 1px solid var(--border-strong);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-inline-size: 2.5rem;
  min-block-size: 2.25rem;
  padding: 0.4rem 1.05rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--accent-brass);
  background-color: var(--accent-brass);
  color: var(--accent-brass-ink);
  font-weight: 600;
  font-size: 0.88rem;
}

.btn-primary.is-live {
  background-color: var(--pitch-sharp);
  border-color: var(--pitch-sharp);
  color: #11161c;
}

.live-dot {
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background-color: currentColor;
  opacity: 0.85;
}

.btn-primary.is-live .live-dot {
  animation: studio-pulse 1.3s ease-in-out infinite;
}

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-inline-size: 2rem;
  min-block-size: 2.15rem;
  padding: 0.35rem 0.72rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.84rem;
  font-weight: 500;
}

.btn-ghost[aria-pressed='true'] {
  background-color: var(--accent-brass-soft);
  border-color: var(--accent-brass);
  color: var(--accent-brass);
}

.btn-ghost[aria-disabled='true'],
.step-btn[aria-disabled='true'] {
  opacity: 0.42;
  cursor: not-allowed;
}

.segmented {
  background-color: var(--surface-well);
  padding: 2px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  gap: 2px;
}

.seg-btn {
  min-inline-size: 2.3rem;
  min-block-size: 1.9rem;
  padding: 0.2rem 0.55rem;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.82rem;
  font-weight: 500;
}

.seg-btn[aria-pressed='true'] {
  background-color: var(--surface-raised);
  border-color: var(--border-strong);
  color: var(--ink-ivory);
}

.a4-stepper {
  display: inline-flex;
  align-items: center;
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.step-btn {
  min-inline-size: 1.85rem;
  min-block-size: 2.05rem;
  border: none;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.95rem;
  font-weight: 600;
}

.a4-value {
  padding: 0 0.45rem;
  font-size: 0.82rem;
  color: var(--ink-ivory);
  white-space: nowrap;
}

@media (hover: hover) {
  .btn-primary:hover {
    filter: brightness(1.07);
  }

  .btn-ghost:not([aria-disabled='true']):hover,
  .step-btn:not([aria-disabled='true']):hover,
  .seg-btn:hover {
    background-color: var(--surface-hover);
    color: var(--ink-ivory);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .btn-primary,
  .btn-ghost,
  .seg-btn,
  .step-btn {
    transition:
      background-color 140ms ease,
      border-color 140ms ease,
      color 140ms ease,
      filter 140ms ease;
  }
}

@media (prefers-reduced-motion: reduce) {
  .btn-primary.is-live .live-dot {
    animation: none;
  }
}

@media (pointer: coarse) {
  .btn-primary,
  .btn-ghost,
  .seg-btn,
  .step-btn {
    min-block-size: 2.65rem;
    min-inline-size: 2.65rem;
  }
}

@keyframes studio-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.8);
  }
}
</style>
