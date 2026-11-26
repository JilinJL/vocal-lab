<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Props {
  open: boolean
  title?: string
  maxHeight?: string
  lightBackdrop?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  maxHeight: '82dvh',
  lightBackdrop: false,
})

const emit = defineEmits<{
  close: []
}>()

const dragOffsetY = ref(0)
const isDragging = ref(false)
let dragStartY = 0
let dragStartTime = 0

function onHandlePointerDown(event: PointerEvent) {
  isDragging.value = true
  dragStartY = event.clientY
  dragStartTime = performance.now()
  dragOffsetY.value = 0
  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)
}

function onHandlePointerMove(event: PointerEvent) {
  if (!isDragging.value) return
  const delta = event.clientY - dragStartY
  dragOffsetY.value = delta > 0 ? delta : delta * 0.18
}

function onHandlePointerUp() {
  if (!isDragging.value) return
  const elapsed = Math.max(1, performance.now() - dragStartTime)
  const velocity = dragOffsetY.value / elapsed
  const shouldClose = dragOffsetY.value > 88 || (dragOffsetY.value > 32 && velocity > 0.45)
  isDragging.value = false
  dragOffsetY.value = 0
  if (shouldClose) {
    emit('close')
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      isDragging.value = false
      dragOffsetY.value = 0
    }
  },
)

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet-fade">
      <div
        v-if="open"
        class="sheet-backdrop"
        :class="{ 'is-light': lightBackdrop }"
        role="dialog"
        aria-modal="true"
        :aria-label="title || '参数抽屉'"
        @click.self="emit('close')"
      >
        <div
          class="sheet-panel"
          :class="{ 'is-dragging': isDragging }"
          :style="{
            maxBlockSize: maxHeight,
            transform: dragOffsetY !== 0 ? `translateY(${dragOffsetY}px)` : undefined,
          }"
        >
          <div
            class="sheet-grab-area"
            @pointerdown="onHandlePointerDown"
            @pointermove="onHandlePointerMove"
            @pointerup="onHandlePointerUp"
            @pointercancel="onHandlePointerUp"
          >
            <span class="sheet-pill" aria-hidden="true"></span>
            <div v-if="title" class="sheet-header">
              <h2 class="sheet-title">{{ title }}</h2>
              <button
                type="button"
                class="sheet-done-btn"
                @pointerdown.stop
                @click="emit('close')"
              >
                完成
              </button>
            </div>
          </div>
          <div class="sheet-scroll studio-scroll">
            <slot></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  background-color: rgba(6, 9, 13, 0.66);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet-backdrop.is-light {
  background-color: rgba(6, 9, 13, 0.22);
  backdrop-filter: none;
}

.sheet-panel {
  width: min(520px, 100%);
  display: flex;
  flex-direction: column;
  background-color: var(--surface-panel);
  border-top: 1px solid var(--border-strong);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -16px 48px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sheet-panel.is-dragging {
  transition: none;
}

.sheet-grab-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.55rem 1rem 0.45rem;
  touch-action: none;
  cursor: grab;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-hairline);
}

.sheet-pill {
  width: 38px;
  height: 4px;
  border-radius: 999px;
  background-color: var(--border-strong);
  margin-bottom: 0.45rem;
}

.sheet-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.sheet-title {
  margin: 0;
  font-size: 0.94rem;
  font-weight: 600;
  color: var(--ink-ivory);
}

.sheet-done-btn {
  min-block-size: 2rem;
  padding: 0.2rem 0.72rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-raised);
  color: var(--accent-brass);
  font-size: 0.82rem;
  font-weight: 600;
}

.sheet-scroll {
  flex: 1 1 auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: max(0.85rem, env(safe-area-inset-bottom));
}

.sheet-fade-enter-active,
.sheet-fade-leave-active {
  transition: opacity 180ms ease;
}

.sheet-fade-enter-active .sheet-panel,
.sheet-fade-leave-active .sheet-panel {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.sheet-fade-enter-from,
.sheet-fade-leave-to {
  opacity: 0;
}

.sheet-fade-enter-from .sheet-panel,
.sheet-fade-leave-to .sheet-panel {
  transform: translateY(100%);
}
</style>
