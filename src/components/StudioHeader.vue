<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import { useToolbarFocusgroup } from '../composables/useToolbarFocusgroup'

export type AppMode = 'monitor' | 'practice' | 'songs'

interface Props {
  mode: AppMode
  isListening: boolean
  isDemo: boolean
  hasSamples: boolean
  windowSeconds: number
  a4Hz: number
  autoFollow: boolean
  latencyOffsetMs: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:mode': [value: AppMode]
  toggleListen: []
  clear: []
  loadDemo: []
  'update:windowSeconds': [value: number]
  'update:a4Hz': [value: number]
  'update:autoFollow': [value: boolean]
  'update:latencyOffsetMs': [value: number]
}>()

const toolbarEl = useTemplateRef<HTMLElement>('toolbarRef')
useToolbarFocusgroup(toolbarEl)

const windowOptions = [6, 12, 24] as const
const modeOptions: ReadonlyArray<{ id: AppMode; label: string }> = [
  { id: 'monitor', label: '自由监测' },
  { id: 'practice', label: '音准练习' },
  { id: 'songs', label: '歌曲跟练' },
]

const settingsOpen = ref(false)

function handleClear() {
  if (!props.hasSamples) return
  emit('clear')
}

function stepA4(delta: number) {
  const next = Math.max(432, Math.min(446, props.a4Hz + delta))
  if (next !== props.a4Hz) {
    emit('update:a4Hz', next)
  }
}

function onLatencyInput(event: Event) {
  const val = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(val)) {
    emit('update:latencyOffsetMs', Math.round(val))
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && settingsOpen.value) {
    settingsOpen.value = false
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <header class="studio-header">
    <div class="header-left">
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
          <h1 class="brand-title" lang="en">VocalLab</h1>
          <span class="brand-sub">声乐实验室</span>
        </div>
      </div>

      <nav class="mode-nav" aria-label="功能模式切换">
        <button
          v-for="tab in modeOptions"
          :key="tab.id"
          type="button"
          class="mode-tab"
          :aria-current="mode === tab.id ? 'page' : undefined"
          :class="{ 'is-active': mode === tab.id }"
          @click="emit('update:mode', tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>
    </div>

    <div
      ref="toolbarRef"
      role="toolbar"
      focusgroup="toolbar wrap"
      aria-label="声乐监测控制栏"
      aria-controls="pitch-stage"
      class="controls-toolbar"
    >
      <div
        v-if="mode === 'monitor'"
        role="group"
        aria-label="麦克风与录制控制"
        class="control-group desktop-only"
      >
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

      <span
        v-if="mode === 'monitor'"
        role="separator"
        aria-orientation="vertical"
        class="toolbar-sep desktop-only"
      ></span>

      <div
        v-if="mode === 'monitor'"
        role="group"
        aria-label="时间轴跨度"
        class="control-group segmented desktop-only"
      >
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

      <span
        v-if="mode === 'monitor'"
        role="separator"
        aria-orientation="vertical"
        class="toolbar-sep desktop-only"
      ></span>

      <div role="group" aria-label="视图与基准音" class="control-group">
        <button
          v-if="mode === 'monitor'"
          type="button"
          class="btn-ghost desktop-only"
          :aria-pressed="autoFollow"
          title="纵轴音域自动跟随人声高度"
          @click="emit('update:autoFollow', !autoFollow)"
        >
          <span>自动跟随</span>
        </button>

        <div class="a4-stepper desktop-only" aria-label="A4 标准音基准频率">
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

        <button
          type="button"
          class="btn-ghost settings-trigger"
          :aria-expanded="settingsOpen"
          aria-haspopup="dialog"
          title="打开调音、时间轴与音频延迟设置"
          @click="settingsOpen = !settingsOpen"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="2.2" stroke="currentColor" stroke-width="1.35" />
            <path
              d="M8 2.2v1.6M8 12.2v1.6M2.2 8h1.6M12.2 8h1.6M3.9 3.9l1.1 1.1M11 11l1.1 1.1M12.1 3.9L11 5M5 11l-1.1 1.1"
              stroke="currentColor"
              stroke-width="1.35"
              stroke-linecap="round"
            />
          </svg>
          <span class="settings-label">设置</span>
          <span class="mobile-a4-chip tabular">{{ a4Hz }}Hz</span>
        </button>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="settingsOpen"
        class="settings-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="VocalLab 参数设置"
        @click.self="settingsOpen = false"
      >
        <div class="settings-sheet">
          <div class="sheet-head">
            <h2 class="sheet-title">调音与延迟设置</h2>
            <button
              type="button"
              class="sheet-close"
              aria-label="关闭设置面板"
              @click="settingsOpen = false"
            >
              ×
            </button>
          </div>

          <div class="sheet-body">
            <div class="sheet-row">
              <div class="sheet-label-group">
                <span class="sheet-label">A4 标准音基准</span>
                <span class="sheet-desc">默认 440Hz，可按乐器微调</span>
              </div>
              <div class="a4-stepper">
                <button
                  type="button"
                  class="step-btn"
                  aria-label="降低 A4 基准频率 1 赫兹"
                  :aria-disabled="a4Hz <= 432"
                  @click="stepA4(-1)"
                >
                  −
                </button>
                <span class="a4-value tabular">{{ a4Hz }}Hz</span>
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

            <div class="sheet-row">
              <div class="sheet-label-group">
                <span class="sheet-label">时间轴显示跨度</span>
                <span class="sheet-desc">自由监测模式下的横向窗口时长</span>
              </div>
              <div class="control-group segmented">
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
            </div>

            <div class="sheet-row">
              <div class="sheet-label-group">
                <span class="sheet-label">纵轴自动跟随</span>
                <span class="sheet-desc">根据实时人声音域平滑居中画布</span>
              </div>
              <button
                type="button"
                class="btn-ghost"
                :aria-pressed="autoFollow"
                @click="emit('update:autoFollow', !autoFollow)"
              >
                {{ autoFollow ? '已开启' : '已关闭' }}
              </button>
            </div>

            <div class="sheet-row sheet-row-stack">
              <div class="sheet-label-row">
                <label for="latency-offset-range" class="sheet-label">跟练延迟补偿</label>
                <span class="latency-val tabular">
                  {{ latencyOffsetMs > 0 ? `+${latencyOffsetMs}` : latencyOffsetMs }} ms
                </span>
              </div>
              <p class="sheet-desc">
                使用蓝牙耳机或外放时若感觉判定偏慢，可调正补偿值（常用 +40 ~ +120ms）。
              </p>
              <div class="latency-ctrl">
                <input
                  id="latency-offset-range"
                  type="range"
                  min="-250"
                  max="350"
                  step="10"
                  :value="latencyOffsetMs"
                  class="latency-slider"
                  @input="onLatencyInput"
                />
                <button
                  type="button"
                  class="btn-ghost btn-xs"
                  @click="emit('update:latencyOffsetMs', 0)"
                >
                  归零
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </header>
</template>

<style scoped>
.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  padding: max(0.6rem, env(safe-area-inset-top)) 1.15rem 0.6rem;
  background-color: var(--surface-panel);
  border-bottom: 1px solid var(--border-hairline);
  flex-wrap: wrap;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  min-inline-size: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-inline-size: 0;
}

.brand-mark {
  flex-shrink: 0;
  color: var(--ink-ivory);
}

.brand-text {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
}

.brand-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1.18rem, 1.05rem + 0.35vw, 1.42rem);
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--ink-ivory);
  line-height: 1.1;
}

.brand-sub {
  font-size: 0.78rem;
  color: var(--ink-secondary);
}

.mode-nav {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-sm);
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
}

.mode-tab {
  min-block-size: 2rem;
  padding: 0.25rem 0.78rem;
  border-radius: 5px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.84rem;
  font-weight: 500;
  white-space: nowrap;
}

.mode-tab.is-active {
  background-color: var(--accent-brass-soft);
  border-color: var(--accent-brass);
  color: var(--accent-brass);
  font-weight: 600;
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

.btn-xs {
  min-block-size: 1.85rem;
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
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

.settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background-color: rgba(6, 9, 13, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.settings-sheet {
  width: min(440px, 100%);
  background-color: var(--surface-panel);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-lg);
  box-shadow: 0 24px 54px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.1rem;
  border-bottom: 1px solid var(--border-hairline);
  background-color: var(--surface-chassis);
}

.sheet-title {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--ink-ivory);
}

.sheet-close {
  min-inline-size: 2rem;
  min-block-size: 2rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 1.15rem;
  line-height: 1;
}

.sheet-body {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1rem 1.1rem max(1.1rem, env(safe-area-inset-bottom));
}

.sheet-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
}

.sheet-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 0.45rem;
}

.sheet-label-group {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.sheet-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sheet-label {
  font-size: 0.86rem;
  font-weight: 600;
  color: var(--ink-ivory);
}

.sheet-desc {
  margin: 0;
  font-size: 0.74rem;
  color: var(--ink-muted);
  line-height: 1.4;
}

.latency-val {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--accent-brass);
}

.latency-ctrl {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.latency-slider {
  flex: 1 1 auto;
  accent-color: var(--accent-brass);
}

@media (hover: hover) {
  .btn-primary:hover {
    filter: brightness(1.07);
  }

  .btn-ghost:not([aria-disabled='true']):hover,
  .step-btn:not([aria-disabled='true']):hover,
  .seg-btn:hover,
  .mode-tab:not(.is-active):hover {
    background-color: var(--surface-hover);
    color: var(--ink-ivory);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .btn-primary,
  .btn-ghost,
  .seg-btn,
  .step-btn,
  .mode-tab {
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
  .step-btn,
  .mode-tab {
    min-block-size: 2.65rem;
    min-inline-size: 2.65rem;
  }
}

.mobile-a4-chip {
  display: none;
  font-size: 0.74rem;
  color: var(--ink-secondary);
}

@media (max-width: 900px) {
  .studio-header {
    padding: max(0.38rem, env(safe-area-inset-top)) 0.75rem 0.38rem;
    gap: 0.5rem;
    flex-wrap: nowrap;
  }

  .header-left {
    width: auto;
    gap: 0.45rem;
  }

  .brand-sub,
  .mode-nav {
    display: none;
  }

  .controls-toolbar {
    width: auto;
    justify-content: flex-end;
  }

  .desktop-only {
    display: none;
  }

  .settings-trigger {
    min-block-size: 2.1rem;
    padding: 0.22rem 0.62rem;
    border-radius: var(--radius-pill);
  }

  .settings-label {
    display: none;
  }

  .mobile-a4-chip {
    display: inline;
  }

  .settings-backdrop {
    align-items: flex-end;
    padding: 0;
  }

  .settings-sheet {
    width: 100%;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    border-bottom: none;
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
