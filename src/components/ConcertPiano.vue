<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { isBlackKey, midiToFrequency, midiToNoteParts } from '../audio/pitchMath'
import type { PianoTimbre } from '../audio/pianoSynth'
import { KEYBOARD_NOTE_OFFSETS } from '../composables/usePiano'
import { triggerHaptic } from '../utils/haptics'

interface Props {
  keyboardOctave: number
  timbre: PianoTimbre
  volume: number
  sustainDrone: boolean
  showKeyShortcuts: boolean
  activeNotes: Set<number>
  sustainedMidi: number | null
  referenceMidi: number | null
  vocalMidi: number | null // Live sung or curve-hovered pitch
  a4Hz: number
  mobileDrawer?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  pressNote: [midi: number]
  releaseNote: [midi: number]
  toggleDrone: [midi: number]
  clearReference: []
  shiftOctave: [delta: number]
  'update:timbre': [value: PianoTimbre]
  'update:volume': [value: number]
  'update:sustainDrone': [value: boolean]
  'update:showKeyShortcuts': [value: boolean]
}>()

interface PianoKeyDef {
  midi: number
  isBlack: boolean
  noteName: string
  displayFullName: string
  solfege: string
  isC: boolean
  isFirst: boolean
  whiteIndex: number
  blackOffsetRatio?: number
  shortcut?: string
  freqLabel: string
}

// Realistic grand piano black-key offsets relative to the preceding white key's right edge
const BLACK_KEY_SHIFT: Record<number, number> = {
  1: -0.06, // C# / Db
  3: 0.06, // D# / Eb
  6: -0.08, // F# / Gb
  8: 0.0, // G# / Ab
  10: 0.08, // A# / Bb
}

// Full 88-key Concert Grand Piano: A0 (MIDI 21) to C8 (MIDI 108)
const START_MIDI = 21
const END_MIDI = 108

const scrollEl = useTemplateRef<HTMLDivElement>('scrollRef')

const shortcutByMidi = computed(() => {
  const map = new Map<number, string>()
  const baseMidi = (props.keyboardOctave + 1) * 12 // e.g., C4 = 60
  for (const item of KEYBOARD_NOTE_OFFSETS) {
    const m = baseMidi + item.offset
    if (m >= START_MIDI && m <= END_MIDI) {
      map.set(m, item.label)
    }
  }
  return map
})

const keys = computed(() => {
  const whites: PianoKeyDef[] = []
  const blacks: PianoKeyDef[] = []

  let whiteIdx = 0
  for (let m = START_MIDI; m <= END_MIDI; m++) {
    const parts = midiToNoteParts(m)
    const black = isBlackKey(m)
    const pc = ((m % 12) + 12) % 12
    const freqLabel = `${midiToFrequency(m, props.a4Hz).toFixed(1)} Hz`
    const shortcut = shortcutByMidi.value.get(m)

    if (black) {
      blacks.push({
        midi: m,
        isBlack: true,
        noteName: parts.noteName,
        displayFullName: parts.displayFullName,
        solfege: parts.solfege,
        isC: false,
        isFirst: false,
        whiteIndex: whiteIdx,
        blackOffsetRatio: BLACK_KEY_SHIFT[pc] ?? 0,
        shortcut,
        freqLabel,
      })
    } else {
      whites.push({
        midi: m,
        isBlack: false,
        noteName: parts.noteName,
        displayFullName: parts.displayFullName,
        solfege: parts.solfege,
        isC: pc === 0,
        isFirst: m === START_MIDI,
        whiteIndex: whiteIdx,
        shortcut,
        freqLabel,
      })
      whiteIdx++
    }
  }

  return { whites, blacks, whiteCount: whiteIdx }
})

const keyboardRangeLabel = computed(() => {
  const startMidi = (props.keyboardOctave + 1) * 12
  const endMidi = Math.min(END_MIDI, startMidi + 16)
  const first = midiToNoteParts(startMidi).displayFullName
  const last = midiToNoteParts(endMidi).displayFullName
  return `键位 ${first}–${last}`
})

const vocalNearestMidi = computed(() =>
  props.vocalMidi !== null ? Math.round(props.vocalMidi) : null,
)

const isPointerGlissando = ref(false)
const pointerHeldMidi = ref<number | null>(null)
const keyboardHeldMidis = new Set<number>()
const isCollapsed = ref(false)
const activeOctaveJump = ref(4)
const droneHint = ref<string | null>(null)
let droneHintTimer: number | null = null
let keyLongPressTimer: number | null = null
let keyLongPressMidi: number | null = null
let keyDownX = 0
let keyDownY = 0

const quickOctaves = [
  { oct: 2, midi: 42, label: 'C2' },
  { oct: 3, midi: 54, label: 'C3' },
  { oct: 4, midi: 66, label: 'C4' },
  { oct: 5, midi: 78, label: 'C5' },
  { oct: 6, midi: 90, label: 'C6' },
] as const

function centerScrollOnMidi(midi: number, smooth = false) {
  const scroller = scrollEl.value
  if (!scroller) return
  if (scroller.scrollWidth <= scroller.clientWidth + 2) return

  // Compute fractional horizontal position of target MIDI among the 52 white keys
  const ratio = (midi - START_MIDI) / (END_MIDI - START_MIDI)
  const targetLeft = ratio * scroller.scrollWidth - scroller.clientWidth / 2
  scroller.scrollTo({
    left: Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, targetLeft)),
    behavior: smooth ? 'smooth' : 'auto',
  })
}

watch(
  () => props.keyboardOctave,
  (oct) => {
    const centerMidi = (oct + 1) * 12 + 6
    centerScrollOnMidi(centerMidi, true)
  },
)

function jumpToOctave(oct: number, midi: number) {
  activeOctaveJump.value = oct
  centerScrollOnMidi(midi, true)
  triggerHaptic(8)
}

function cycleTimbre() {
  const idx = timbreOptions.findIndex((t) => t.id === props.timbre)
  const next = timbreOptions[(idx + 1) % timbreOptions.length]!
  emit('update:timbre', next.id)
  triggerHaptic(8)
}

function clearKeyLongPress() {
  if (keyLongPressTimer !== null) {
    window.clearTimeout(keyLongPressTimer)
    keyLongPressTimer = null
  }
}

function showDroneHint(msg: string) {
  droneHint.value = msg
  if (droneHintTimer !== null) {
    window.clearTimeout(droneHintTimer)
  }
  droneHintTimer = window.setTimeout(() => {
    droneHint.value = null
    droneHintTimer = null
  }, 1500)
}

function onKeyPointerDown(midi: number, e: PointerEvent) {
  e.preventDefault()
  isPointerGlissando.value = true
  pointerHeldMidi.value = midi
  keyLongPressMidi = null
  keyDownX = e.clientX
  keyDownY = e.clientY
  clearKeyLongPress()

  // If tapping the currently sustained drone key directly, release it
  if (props.sustainedMidi === midi) {
    emit('toggleDrone', midi)
    triggerHaptic(10)
    showDroneHint('已关闭持续音')
    isPointerGlissando.value = false
    pointerHeldMidi.value = null
    return
  }

  triggerHaptic(8)
  emit('pressNote', midi)

  // Long-press any key (>460ms) to lock a sustained reference drone
  if (!props.sustainDrone) {
    keyLongPressTimer = window.setTimeout(() => {
      keyLongPressTimer = null
      if (pointerHeldMidi.value === midi) {
        keyLongPressMidi = midi
        emit('toggleDrone', midi)
        triggerHaptic([14, 30, 14])
        showDroneHint(`持续音 ${midiToNoteParts(midi).displayFullName}（再按停止）`)
      }
    }, 460)
  }
}

function onKeyPointerEnter(midi: number, e: PointerEvent) {
  if (!isPointerGlissando.value || e.buttons !== 1) return
  clearKeyLongPress()
  if (pointerHeldMidi.value !== null && pointerHeldMidi.value !== midi) {
    emit('releaseNote', pointerHeldMidi.value)
  }
  pointerHeldMidi.value = midi
  emit('pressNote', midi)
}

function onBedPointerMove(e: PointerEvent) {
  if (!isPointerGlissando.value) return
  if (Math.hypot(e.clientX - keyDownX, e.clientY - keyDownY) > 10) {
    clearKeyLongPress()
  }
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
  const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
  const keyEl = el?.closest?.('[data-midi]') as HTMLElement | null
  if (!keyEl) return
  const midi = Number(keyEl.dataset.midi)
  if (!Number.isFinite(midi) || midi === pointerHeldMidi.value) return
  if (pointerHeldMidi.value !== null) {
    emit('releaseNote', pointerHeldMidi.value)
  }
  pointerHeldMidi.value = midi
  triggerHaptic(6)
  emit('pressNote', midi)
}

function releasePointerNote() {
  clearKeyLongPress()
  if (pointerHeldMidi.value !== null) {
    if (keyLongPressMidi !== pointerHeldMidi.value) {
      emit('releaseNote', pointerHeldMidi.value)
    }
    pointerHeldMidi.value = null
  }
  keyLongPressMidi = null
  isPointerGlissando.value = false
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
    return
  }

  const lower = e.key.toLowerCase()
  const match = KEYBOARD_NOTE_OFFSETS.find((k) => k.key === lower)
  if (!match) return

  const baseMidi = (props.keyboardOctave + 1) * 12
  const midi = baseMidi + match.offset
  if (midi < START_MIDI || midi > END_MIDI) return

  if (!keyboardHeldMidis.has(midi)) {
    keyboardHeldMidis.add(midi)
    emit('pressNote', midi)
  }
}

function handleKeyUp(e: KeyboardEvent) {
  const lower = e.key.toLowerCase()
  const match = KEYBOARD_NOTE_OFFSETS.find((k) => k.key === lower)
  if (!match) return

  const baseMidi = (props.keyboardOctave + 1) * 12
  const midi = baseMidi + match.offset
  if (keyboardHeldMidis.has(midi)) {
    keyboardHeldMidis.delete(midi)
    emit('releaseNote', midi)
  }
}

function releaseAllHeldNotes() {
  releasePointerNote()
  for (const midi of Array.from(keyboardHeldMidis)) {
    keyboardHeldMidis.delete(midi)
    emit('releaseNote', midi)
  }
}

function handleVisibilityRelease() {
  if (document.hidden) {
    releaseAllHeldNotes()
  }
}

function onVolumeInput(e: Event) {
  const val = Number((e.target as HTMLInputElement).value)
  emit('update:volume', val)
}

const timbreOptions: ReadonlyArray<{ id: PianoTimbre; label: string }> = [
  { id: 'sampled', label: '真实钢琴' },
  { id: 'rhodes', label: '柔和电钢' },
  { id: 'sine', label: '纯净正弦' },
]

onMounted(() => {
  if (!props.mobileDrawer && window.matchMedia('(max-width: 768px)').matches) {
    isCollapsed.value = true
  } else {
    // Center the 88-key bed around middle C (C4–E4) on smaller screens
    window.requestAnimationFrame(() => centerScrollOnMidi(64, false))
  }
  window.addEventListener('pointerup', releasePointerNote)
  window.addEventListener('pointercancel', releasePointerNote)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  window.addEventListener('blur', releaseAllHeldNotes)
  document.addEventListener('visibilitychange', handleVisibilityRelease)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerup', releasePointerNote)
  window.removeEventListener('pointercancel', releasePointerNote)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('keyup', handleKeyUp)
  window.removeEventListener('blur', releaseAllHeldNotes)
  document.removeEventListener('visibilitychange', handleVisibilityRelease)
})

watch(isCollapsed, (collapsed) => {
  if (!collapsed) {
    window.requestAnimationFrame(() => centerScrollOnMidi(64, false))
  }
})
</script>

<template>
  <section
    class="piano-deck"
    :class="{ 'is-mobile-drawer': mobileDrawer }"
    aria-label="88 键标准音参考钢琴"
  >
    <!-- Top Hardware Console Rail -->
    <div v-if="mobileDrawer" class="mobile-piano-rail">
      <div class="octave-jump-strip" role="group" aria-label="快速跳转八度">
        <button
          v-for="item in quickOctaves"
          :key="item.oct"
          type="button"
          class="oct-chip tabular"
          :class="{ 'is-active': activeOctaveJump === item.oct }"
          @click="jumpToOctave(item.oct, item.midi)"
        >
          {{ item.label }}
        </button>
      </div>
      <div class="mobile-rail-actions">
        <button
          v-if="sustainedMidi !== null"
          type="button"
          class="drone-stop-chip"
          @click="emit('clearReference')"
        >
          停 {{ midiToNoteParts(sustainedMidi).displayFullName }}
        </button>
        <button type="button" class="timbre-cycle-chip" @click="cycleTimbre">
          {{ timbreOptions.find((t) => t.id === timbre)?.label }}
        </button>
      </div>
    </div>

    <div v-else class="piano-rail">
      <div class="rail-left">
        <button
          type="button"
          class="rail-toggle collapse-btn"
          :aria-expanded="!isCollapsed"
          @click="isCollapsed = !isCollapsed"
        >
          <span>{{ isCollapsed ? '展开钢琴' : '收起钢琴' }}</span>
        </button>
        <span class="deck-name">88 键标准音钢琴</span>
        <span class="deck-range tabular">A0 – C8</span>

        <div class="timbre-group" role="group" aria-label="钢琴音色选择">
          <button
            v-for="opt in timbreOptions"
            :key="opt.id"
            type="button"
            class="timbre-btn"
            :aria-pressed="timbre === opt.id"
            @click="emit('update:timbre', opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>

        <div class="octave-ctrl desktop-only" role="group" aria-label="电脑键盘映射八度切换">
          <button
            type="button"
            class="rail-icon-btn"
            aria-label="电脑键盘八度降一档"
            :aria-disabled="keyboardOctave <= 1"
            @click="keyboardOctave > 1 && emit('shiftOctave', -1)"
          >
            ‹
          </button>
          <span class="octave-label tabular">{{ keyboardRangeLabel }}</span>
          <button
            type="button"
            class="rail-icon-btn"
            aria-label="电脑键盘八度升一档"
            :aria-disabled="keyboardOctave >= 6"
            @click="keyboardOctave < 6 && emit('shiftOctave', 1)"
          >
            ›
          </button>
        </div>
      </div>

      <div class="rail-right">
        <button
          type="button"
          class="rail-toggle"
          :aria-pressed="sustainDrone"
          title="开启后点击琴键将持续发声作为定音参考，再次点击同键停止"
          @click="emit('update:sustainDrone', !sustainDrone)"
        >
          <span class="toggle-led" aria-hidden="true"></span>
          <span>持续参考音</span>
        </button>

        <button
          type="button"
          class="rail-toggle desktop-only"
          :aria-pressed="showKeyShortcuts"
          title="显示或隐藏电脑键盘弹奏键位提示"
          @click="emit('update:showKeyShortcuts', !showKeyShortcuts)"
        >
          <span>键位提示</span>
        </button>

        <div class="volume-ctrl">
          <label for="piano-volume" class="vol-label">音量</label>
          <input
            id="piano-volume"
            type="range"
            min="0"
            max="1"
            step="0.02"
            :value="volume"
            class="vol-slider"
            @input="onVolumeInput"
          />
        </div>
      </div>
    </div>

    <div v-if="droneHint" class="drone-toast" role="status" aria-live="polite">
      {{ droneHint }}
    </div>

    <!-- Tactile 88-Key Concert Piano Keyboard Bed -->
    <div v-show="!isCollapsed" ref="scrollRef" class="keyboard-scroll studio-scroll">
      <div
        class="keyboard-bed"
        :style="{ '--white-count': keys.whiteCount }"
        role="group"
        aria-label="88 键标准音钢琴键盘，点击琴键或按电脑键盘 A 至 ; 键弹奏标准音"
        @pointermove="onBedPointerMove"
      >
        <!-- White keys layer (52 white keys) -->
        <button
          v-for="k in keys.whites"
          :key="k.midi"
          type="button"
          class="key-white"
          :data-midi="k.midi"
          :class="{
            'is-active': activeNotes.has(k.midi),
            'is-sustained': sustainedMidi === k.midi,
            'is-reference': referenceMidi === k.midi,
            'is-vocal': vocalNearestMidi === k.midi,
            'is-c': k.isC,
            'is-middle-c': k.midi === 60,
          }"
          :aria-label="`${k.displayFullName} (${k.solfege}, ${k.freqLabel})`"
          :aria-pressed="activeNotes.has(k.midi)"
          @pointerdown="onKeyPointerDown(k.midi, $event)"
          @pointerenter="onKeyPointerEnter(k.midi, $event)"
          @keydown.enter.prevent="emit('pressNote', k.midi)"
          @keyup.enter.prevent="emit('releaseNote', k.midi)"
          @keydown.space.prevent="emit('pressNote', k.midi)"
          @keyup.space.prevent="emit('releaseNote', k.midi)"
        >
          <span v-if="vocalNearestMidi === k.midi" class="vocal-beacon" aria-hidden="true"></span>
          <span class="white-labels" aria-hidden="true">
            <span v-if="!mobileDrawer && showKeyShortcuts && k.shortcut" class="keycap">{{ k.shortcut }}</span>
            <span
              v-if="
                mobileDrawer ||
                k.isC ||
                k.isFirst ||
                vocalNearestMidi === k.midi ||
                referenceMidi === k.midi ||
                activeNotes.has(k.midi)
              "
              class="note-tag tabular"
            >
              {{ mobileDrawer && !k.isC ? k.noteName : k.displayFullName }}
            </span>
          </span>
        </button>

        <!-- Black keys overlay (36 black keys) -->
        <button
          v-for="k in keys.blacks"
          :key="k.midi"
          type="button"
          class="key-black"
          :data-midi="k.midi"
          :class="{
            'is-active': activeNotes.has(k.midi),
            'is-sustained': sustainedMidi === k.midi,
            'is-reference': referenceMidi === k.midi,
            'is-vocal': vocalNearestMidi === k.midi,
          }"
          :style="{
            left: `calc((${k.whiteIndex} + ${k.blackOffsetRatio ?? 0}) * (100% / var(--white-count)))`,
          }"
          :aria-label="`${k.displayFullName} (${k.solfege}, ${k.freqLabel})`"
          :aria-pressed="activeNotes.has(k.midi)"
          @pointerdown="onKeyPointerDown(k.midi, $event)"
          @pointerenter="onKeyPointerEnter(k.midi, $event)"
          @keydown.enter.prevent="emit('pressNote', k.midi)"
          @keyup.enter.prevent="emit('releaseNote', k.midi)"
          @keydown.space.prevent="emit('pressNote', k.midi)"
          @keyup.space.prevent="emit('releaseNote', k.midi)"
        >
          <span
            v-if="vocalNearestMidi === k.midi"
            class="vocal-beacon vocal-beacon-black"
            aria-hidden="true"
          ></span>
          <span v-if="!mobileDrawer && showKeyShortcuts && k.shortcut" class="keycap-black" aria-hidden="true">
            {{ k.shortcut }}
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.piano-deck {
  position: relative;
  display: flex;
  flex-direction: column;
  background-color: var(--surface-panel);
  border-top: 1px solid var(--border-strong);
  user-select: none;
  flex-shrink: 0;
}

.piano-deck.is-mobile-drawer {
  border-top: none;
}

.mobile-piano-rail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.75rem;
  background-color: var(--surface-chassis);
  border-bottom: 1px solid var(--border-hairline);
}

.octave-jump-strip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.oct-chip {
  min-inline-size: 2.15rem;
  min-block-size: 1.9rem;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.oct-chip.is-active {
  background-color: var(--surface-raised);
  border-color: var(--border-strong);
  color: var(--ink-ivory);
}

.mobile-rail-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.timbre-cycle-chip,
.drone-stop-chip {
  min-block-size: 2rem;
  padding: 0.18rem 0.58rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
}

.drone-stop-chip {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

.drone-toast {
  position: absolute;
  left: 50%;
  top: 3.1rem;
  transform: translateX(-50%);
  z-index: 12;
  padding: 0.24rem 0.68rem;
  border-radius: var(--radius-pill);
  background-color: rgba(15, 20, 26, 0.92);
  border: 1px solid var(--accent-brass);
  color: var(--accent-brass);
  font-size: 0.74rem;
  font-weight: 600;
  pointer-events: none;
}

.piano-rail {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.45rem 1.15rem;
  background-color: var(--surface-chassis);
  border-bottom: 1px solid var(--border-hairline);
  flex-wrap: wrap;
}

.rail-left,
.rail-right {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}

.deck-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-ivory);
}

.deck-range {
  font-size: 0.74rem;
  color: var(--ink-muted);
  padding: 0.12rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-well);
}

.octave-ctrl {
  display: inline-flex;
  align-items: center;
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.rail-icon-btn {
  min-inline-size: 1.7rem;
  min-block-size: 1.8rem;
  border: none;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 1rem;
  font-weight: 600;
  line-height: 1;
}

.rail-icon-btn[aria-disabled='true'] {
  opacity: 0.35;
  cursor: not-allowed;
}

.octave-label {
  padding: 0 0.45rem;
  font-size: 0.76rem;
  color: var(--ink-ivory);
}

.timbre-group {
  display: inline-flex;
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
  border-radius: var(--radius-sm);
  padding: 2px;
  gap: 2px;
}

.timbre-btn {
  min-block-size: 1.65rem;
  padding: 0.15rem 0.55rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.76rem;
  font-weight: 500;
}

.timbre-btn[aria-pressed='true'] {
  background-color: var(--surface-raised);
  border-color: var(--border-strong);
  color: var(--ink-ivory);
}

.rail-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-block-size: 1.8rem;
  padding: 0.18rem 0.62rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-secondary);
  font-size: 0.76rem;
  font-weight: 500;
}

.rail-toggle[aria-pressed='true'] {
  background-color: var(--accent-brass-soft);
  border-color: var(--accent-brass);
  color: var(--accent-brass);
}

.toggle-led {
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background-color: var(--ink-muted);
}

.rail-toggle[aria-pressed='true'] .toggle-led {
  background-color: var(--accent-brass);
  box-shadow: 0 0 8px var(--accent-brass);
}

.volume-ctrl {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
}

.vol-label {
  font-size: 0.76rem;
  color: var(--ink-secondary);
}

.vol-slider {
  inline-size: 80px;
  accent-color: var(--accent-brass);
  cursor: pointer;
}

/* Piano Keyboard Bed — sleek narrow keys (28px–38px white keys) showing all 88 keys on 2K */
.keyboard-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  background: linear-gradient(180deg, #0b0e13 0%, #141a22 100%);
  padding: 0 0.75rem max(0.7rem, env(safe-area-inset-bottom));
  -webkit-overflow-scrolling: touch;
}

.keyboard-bed {
  position: relative;
  display: flex;
  inline-size: 100%;
  min-inline-size: 1456px; /* 52 white keys * 28px minimum */
  max-inline-size: 1976px; /* 52 white keys * 38px maximum -> slim & authentic on 2K/4K */
  margin-inline: auto;
  block-size: clamp(128px, 18dvh, 168px);
  border-top: 3px solid #7d2f2b;
  border-inline: 8px solid #161d26;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  box-shadow:
    inset 0 6px 10px rgba(0, 0, 0, 0.45),
    0 8px 24px rgba(0, 0, 0, 0.45);
}

.key-white {
  position: relative;
  flex: 1 1 0;
  min-inline-size: 0;
  height: 100%;
  margin: 0;
  padding: 0 1px 6px;
  border: none;
  border-right: 1px solid #b8b0a3;
  border-bottom: 5px solid #c5bdb0;
  border-radius: 0 0 4px 4px;
  background: linear-gradient(180deg, #ece7de 0%, #f6f3ec 14%, #f2ede4 85%, #e5dfd3 100%);
  color: #3a424d;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  touch-action: none;
}

.key-white:last-of-type {
  border-right: none;
}

.key-white.is-c {
  background: linear-gradient(180deg, #f0ebe2 0%, #faf7f0 16%, #f4efe6 85%, #e8e1d5 100%);
}

.key-white.is-active,
.key-white.is-sustained {
  border-bottom-width: 2px;
  transform: translateY(2px);
  background: linear-gradient(180deg, #f3dca3 0%, #f5e5bd 45%, #ecd392 100%);
  box-shadow: inset 0 3px 8px rgba(130, 88, 12, 0.28);
}

.key-white.is-reference:not(.is-active) {
  box-shadow: inset 0 -4px 0 0 var(--accent-brass);
}

.key-white.is-vocal {
  background: linear-gradient(180deg, #d7f6ea 0%, #e7fbf3 40%, #c8f0e1 100%);
  box-shadow: inset 0 -4px 0 0 var(--pitch-accurate);
}

.white-labels {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  pointer-events: none;
  overflow: hidden;
  max-inline-size: 100%;
}

.keycap {
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
  padding: 1.5px 3px;
  border-radius: 3px;
  background-color: rgba(17, 22, 28, 0.11);
  color: #4c5868;
}

.note-tag {
  font-size: 0.64rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #5b6573;
  white-space: nowrap;
}

.key-white.is-c .note-tag {
  color: #1c242e;
  font-weight: 700;
}

.key-white.is-middle-c .note-tag {
  color: #8f5c00;
}

.key-white.is-vocal .note-tag {
  color: #0e5a42;
  font-weight: 700;
}

/* Sculpted Matte Ebony Black Keys */
.key-black {
  position: absolute;
  top: 0;
  z-index: 3;
  width: calc((100% / var(--white-count)) * 0.62);
  height: 61%;
  transform: translateX(-50%);
  padding: 0 1px 6px;
  border: 1px solid #090c10;
  border-top: none;
  border-bottom: 5px solid #090c10;
  border-radius: 0 0 3px 3px;
  background: linear-gradient(180deg, #2b3440 0%, #1d242d 16%, #13181f 86%, #1f2731 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    0 4px 7px rgba(0, 0, 0, 0.55);
  color: #a5b2c2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  touch-action: none;
}

.key-black.is-active,
.key-black.is-sustained {
  height: 60%;
  border-bottom-width: 2px;
  transform: translateX(-50%) translateY(2px);
  background: linear-gradient(180deg, #8c6b27 0%, #5e4719 35%, #3d2e11 100%);
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.45),
    0 0 12px rgba(228, 182, 83, 0.45);
  color: #f6e7c1;
}

.key-black.is-reference:not(.is-active) {
  box-shadow:
    inset 0 -3px 0 0 var(--accent-brass),
    0 4px 7px rgba(0, 0, 0, 0.55);
}

.key-black.is-vocal {
  background: linear-gradient(180deg, #2b7a61 0%, #1d5846 40%, #133b2f 100%);
  box-shadow:
    inset 0 -3px 0 0 var(--pitch-accurate),
    0 0 12px rgba(79, 209, 165, 0.42);
  color: #e6fff6;
}

.keycap-black {
  font-size: 0.56rem;
  font-weight: 600;
  line-height: 1;
  color: inherit;
  opacity: 0.82;
  pointer-events: none;
}

/* Vocal pitch indicator beacon on matching piano key */
.vocal-beacon {
  position: absolute;
  top: 8px;
  inline-size: 7px;
  block-size: 7px;
  border-radius: 50%;
  background-color: var(--pitch-accurate);
  box-shadow: 0 0 9px var(--pitch-accurate);
  pointer-events: none;
}

.vocal-beacon-black {
  top: 7px;
  inline-size: 6px;
  block-size: 6px;
}

@media (hover: hover) {
  .key-white:hover:not(.is-active):not(.is-vocal) {
    background: linear-gradient(180deg, #f3efe7 0%, #ffffff 18%, #f5f1e9 100%);
  }

  .key-black:hover:not(.is-active):not(.is-vocal) {
    background: linear-gradient(180deg, #374250 0%, #242d38 18%, #181e27 100%);
  }

  .rail-icon-btn:not([aria-disabled='true']):hover,
  .timbre-btn:hover,
  .rail-toggle:hover {
    background-color: var(--surface-hover);
    color: var(--ink-ivory);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .key-white,
  .key-black {
    transition:
      transform 45ms ease,
      background 80ms ease,
      box-shadow 80ms ease;
  }
}

@media (max-width: 900px) {
  .piano-rail {
    padding: 0.45rem 0.75rem;
    gap: 0.45rem;
  }

  .deck-range,
  .desktop-only {
    display: none;
  }

  .keyboard-bed {
    min-inline-size: 2184px;
    block-size: 150px;
  }

  .vol-slider {
    inline-size: 68px;
  }
}

@media (forced-colors: active) {
  .key-white {
    background: Canvas;
    border: 1px solid CanvasText;
    color: CanvasText;
  }

  .key-black {
    background: CanvasText;
    border: 1px solid Canvas;
    color: Canvas;
  }

  .key-white.is-active,
  .key-black.is-active,
  .key-white.is-vocal,
  .key-black.is-vocal {
    background: Highlight;
    color: HighlightText;
  }
}
</style>
