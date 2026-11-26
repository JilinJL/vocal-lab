<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatTimingBias, RHYTHM_GRADE_LABELS } from '../../rhythm/scoring'
import type {
  BasicBeatPreset,
  DrumLayer,
  GroovePatternData,
  GroovePreset,
  MeterId,
  MeterSpec,
  RhythmGameChallenge,
  RhythmGameStatus,
  RhythmGameSummary,
  RhythmGameTargetMode,
  RhythmGradePopup,
  RhythmHitTarget,
  RhythmSubView,
} from '../../rhythm/types'
import { triggerHaptic } from '../../utils/haptics'

interface Props {
  isMobile: boolean
  subView: RhythmSubView
  bpm: number
  pulseOnly: boolean
  swing: number
  basicMeter: MeterId
  basicSub: 1 | 2 | 3 | 4
  activeBasicPreset: BasicBeatPreset
  grooveMeter: MeterId
  activeGroove: GroovePreset
  activeMeterSpec: MeterSpec
  pattern: GroovePatternData
  grooveStats: {
    beats: number
    strong: number
    mediumBeat: number
    weak: number
    heavy: number
    medium: number
    light: number
    total: number
  }
  isPlaying: boolean
  currentStep: number
  currentBeat: number
  currentSubPos: number
  currentBar: number
  // Game
  activeChallenge: RhythmGameChallenge
  gameTargetMode: RhythmGameTargetMode
  gameBars: number
  gameBlindBars: boolean
  gameStatus: RhythmGameStatus
  gameCountdown: number | null
  gameTargets: RhythmHitTarget[]
  gameCombo: number
  gamePopup: RhythmGradePopup | null
  gamePlayheadSec: number
  gameInBlindBar: boolean
  gameSummary: RhythmGameSummary
  lastTapFlashAt: number
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:subView': [value: RhythmSubView]
  'update:bpm': [value: number]
  'update:pulseOnly': [value: boolean]
  'update:basicMeter': [value: MeterId]
  'update:basicSub': [value: 1 | 2 | 3 | 4]
  stepBpm: [delta: number]
  tapTempo: []
  togglePlay: []
  cycleCell: [layer: DrumLayer, index: number]
  startGame: []
  stopAll: []
  gameTap: []
  openLibrary: []
  boostBpmAndReplay: []
}>()

const METER_OPTIONS: readonly MeterId[] = ['4/4', '3/4', '2/4', '6/8']
const SUB_OPTIONS: ReadonlyArray<{ value: 1 | 2 | 3 | 4; label: string }> = [
  { value: 1, label: '四分' },
  { value: 2, label: '八分' },
  { value: 3, label: '三连音' },
  { value: 4, label: '十六分' },
]
const DRUM_ROWS: ReadonlyArray<{ id: DrumLayer; label: string; color: string }> = [
  { id: 'kick', label: '底鼓', color: 'var(--rhythm-kick)' },
  { id: 'snare', label: '军鼓', color: 'var(--rhythm-snare)' },
  { id: 'hat', label: '踩镲', color: 'var(--rhythm-hat)' },
  { id: 'fill', label: '加花', color: 'var(--rhythm-fill)' },
]

const TARGET_MODE_LABELS: Record<RhythmGameTargetMode, string> = {
  beat: '打正拍',
  kick: '打底鼓',
  snare: '打军鼓',
  backbone: '底鼓+军鼓',
}

const totalSteps = computed(() => props.activeMeterSpec.beats * props.activeMeterSpec.grooveSub)

const beatAccentClass = computed(() => {
  if (!props.isPlaying) return ''
  const accent = props.activeMeterSpec.pulse[props.currentBeat] ?? 1
  if (accent === 3) return 'is-strong'
  if (accent === 2) return 'is-medium'
  return 'is-weak'
})

const beatSubHint = computed(() => {
  if (!props.isPlaying) return '按开始或空格启动 · 颜色区分强弱拍'
  if (props.currentSubPos === 0) {
    const accent = props.activeMeterSpec.pulse[props.currentBeat] ?? 1
    return accent === 3 ? '强拍' : accent === 2 ? '次强拍' : '弱拍'
  }
  return `细分 ${props.currentSubPos + 1} / ${props.basicSub}`
})

const padPressed = ref(false)
let padPressTimer: number | null = null

function handlePadPointerDown(event: PointerEvent) {
  event.preventDefault()
  padPressed.value = true
  if (padPressTimer !== null) window.clearTimeout(padPressTimer)
  padPressTimer = window.setTimeout(() => {
    padPressed.value = false
  }, 110)
  emit('gameTap')
}

function onBpmSlider(event: Event) {
  const val = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(val)) {
    emit('update:bpm', val)
  }
}

function selectSub(next: RhythmSubView) {
  if (next === props.subView) return
  triggerHaptic(8)
  emit('update:subView', next)
}

// ================= 60fps Rhythm Game Highway Canvas =================
const canvasRef = ref<HTMLCanvasElement | null>(null)
let resizeObserver: ResizeObserver | null = null
let canvasCssW = 640
let canvasCssH = 220

function resizeCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvasCssW = rect.width
  canvasCssH = rect.height
  canvas.width = Math.round(rect.width * dpr)
  canvas.height = Math.round(rect.height * dpr)
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawHighway()
}

function colorForLayer(layer: RhythmHitTarget['layer'], accent: number): string {
  if (layer === 'kick') return '#ff7a59'
  if (layer === 'snare') return '#ffb454'
  return accent === 3 ? '#e4b653' : accent === 2 ? '#4fd1a5' : '#7f93a8'
}

function colorForGrade(grade: RhythmHitTarget['grade']): string {
  if (grade === 'perfect') return '#f5c542'
  if (grade === 'great') return '#4fd1a5'
  if (grade === 'good') return '#63b3ed'
  return '#ee7863'
}

function drawHighway() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const w = canvasCssW
  const h = canvasCssH
  ctx.clearRect(0, 0, w, h)

  // Background well
  ctx.fillStyle = '#0b0f14'
  ctx.fillRect(0, 0, w, h)

  const hitX = Math.round(w * 0.22)
  const centerY = Math.round(h * 0.54)
  const lookAheadSec = 2.4
  const pxPerSec = (w - hitX - 24) / lookAheadSec

  // Subtle center track rail
  ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
  ctx.fillRect(0, centerY - 34, w, 68)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, centerY - 34)
  ctx.lineTo(w, centerY - 34)
  ctx.moveTo(0, centerY + 34)
  ctx.lineTo(w, centerY + 34)
  ctx.stroke()

  // Hit zone glow halo when tapped recently
  const tapAge = performance.now() - props.lastTapFlashAt
  if (tapAge >= 0 && tapAge < 180) {
    const alpha = (1 - tapAge / 180) * 0.42
    const grad = ctx.createRadialGradient(hitX, centerY, 4, hitX, centerY, 54)
    grad.addColorStop(0, `rgba(228, 182, 83, ${alpha})`)
    grad.addColorStop(1, 'rgba(228, 182, 83, 0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(hitX, centerY, 54, 0, Math.PI * 2)
    ctx.fill()
  }

  // Hit line & target ring
  ctx.strokeStyle = 'rgba(228, 182, 83, 0.78)'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(hitX, 18)
  ctx.lineTo(hitX, h - 16)
  ctx.stroke()

  ctx.strokeStyle = '#e4b653'
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(hitX, centerY, 20, 0, Math.PI * 2)
  ctx.stroke()

  if (props.gameStatus === 'idle') {
    ctx.fillStyle = '#8b97a6'
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('点击下方「开始闯关」，当节拍光球到达金色判定圈时敲击鼓垫', w * 0.56, centerY + 5)
    return
  }

  const now = props.gamePlayheadSec
  const spec = props.activeMeterSpec
  const barDur = (60 / props.bpm) * spec.beats

  // Bar separator lines
  for (let b = 0; b <= props.gameBars; b++) {
    const firstTarget = props.gameTargets[0]
    if (!firstTarget) break
    const barTime =
      firstTarget.expectedTime - (firstTarget.stepIndex / spec.grooveSub) * (60 / props.bpm) + b * barDur
    const x = hitX + (barTime - now) * pxPerSec
    if (x < -20 || x > w + 20) continue
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)'
    ctx.lineWidth = 1.2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(x, 22)
    ctx.lineTo(x, h - 18)
    ctx.stroke()
    ctx.setLineDash([])
    if (b < props.gameBars) {
      ctx.fillStyle = '#7f8f9f'
      ctx.font = '600 10px -apple-system, BlinkMacSystemFont, sans-serif'
      ctx.textAlign = 'left'
      const blindLabel = props.gameBlindBars && b % 4 >= 2 ? `第${b + 1}小节 · 盲拍` : `第${b + 1}小节`
      ctx.fillText(blindLabel, x + 5, 32)
    }
  }

  // Draw scrolling note orbs
  for (const target of props.gameTargets) {
    const dt = target.expectedTime - now
    const x = hitX + dt * pxPerSec
    if (x < -36 || x > w + 36) continue

    const radius = target.accent === 3 ? 17 : target.accent === 2 ? 14 : 11
    const baseColor = target.judged ? colorForGrade(target.grade) : colorForLayer(target.layer, target.accent)
    const alpha = target.judged ? Math.max(0.18, 1 - Math.abs(dt) * 2.2) : 1

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.fillStyle = baseColor
    ctx.beginPath()
    ctx.arc(x, centerY, radius, 0, Math.PI * 2)
    ctx.fill()

    if (target.blind && !target.judged) {
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1.6
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.arc(x, centerY, radius + 4, 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Short label inside orb
    ctx.fillStyle = '#0b0f14'
    ctx.font = '700 10px -apple-system, BlinkMacSystemFont, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const beatNum = Math.floor(target.stepIndex / spec.grooveSub) + 1
    const label =
      target.layer === 'kick' ? '底' : target.layer === 'snare' ? '军' : String(beatNum)
    ctx.fillText(label, x, centerY + 0.5)
    ctx.restore()
  }
}

watch(
  () => [props.gamePlayheadSec, props.gameStatus, props.lastTapFlashAt, props.subView],
  () => {
    if (props.subView === 'game') {
      drawHighway()
    }
  },
)

watch(
  canvasRef,
  (el) => {
    resizeObserver?.disconnect()
    resizeObserver = null
    if (el) {
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => resizeCanvas())
        resizeObserver.observe(el)
      }
      window.requestAnimationFrame(() => resizeCanvas())
    }
  },
  { flush: 'post' },
)

function handleKeydown(event: KeyboardEvent) {
  const tag = (event.target as HTMLElement | null)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (event.code === 'Space') {
    event.preventDefault()
    if (props.subView === 'game' && (props.gameStatus === 'running' || props.gameStatus === 'countdown')) {
      emit('gameTap')
    } else {
      emit('togglePlay')
    }
  } else if (
    (event.code === 'KeyJ' || event.code === 'KeyK') &&
    props.subView === 'game' &&
    (props.gameStatus === 'running' || props.gameStatus === 'countdown')
  ) {
    event.preventDefault()
    emit('gameTap')
  } else if (event.code === 'ArrowUp') {
    event.preventDefault()
    emit('stepBpm', 2)
  } else if (event.code === 'ArrowDown') {
    event.preventDefault()
    emit('stepBpm', -2)
  } else if (event.key === 't' || event.key === 'T') {
    emit('tapTempo')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  resizeObserver?.disconnect()
  if (padPressTimer !== null) window.clearTimeout(padPressTimer)
})
</script>

<template>
  <section class="rhythm-stage" aria-label="节奏训练主舞台">
    <!-- Top compact bar: 3-way sub-mode pill + BPM control -->
    <div class="stage-top">
      <div class="sub-tabs" role="tablist" aria-label="节奏子模式">
        <button
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ 'is-active': subView === 'beat' }"
          :aria-selected="subView === 'beat'"
          @click="selectSub('beat')"
        >
          节拍
        </button>
        <button
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ 'is-active': subView === 'groove' }"
          :aria-selected="subView === 'groove'"
          @click="selectSub('groove')"
        >
          律动
        </button>
        <button
          type="button"
          role="tab"
          class="sub-tab"
          :class="{ 'is-active': subView === 'game' }"
          :aria-selected="subView === 'game'"
          @click="selectSub('game')"
        >
          闯关
        </button>
      </div>

      <div class="bpm-strip">
        <button
          type="button"
          class="bpm-step"
          aria-label="减 2 BPM"
          @click="emit('stepBpm', -2)"
        >
          −
        </button>
        <input
          type="range"
          min="40"
          max="200"
          step="1"
          :value="bpm"
          class="bpm-slider"
          aria-label="速度 BPM"
          @input="onBpmSlider"
        />
        <button
          type="button"
          class="bpm-step"
          aria-label="加 2 BPM"
          @click="emit('stepBpm', 2)"
        >
          +
        </button>
        <span class="bpm-readout tabular">{{ bpm }}<small>BPM</small></span>
      </div>

      <div v-if="!isMobile" class="desktop-transport">
        <button
          type="button"
          class="transport-primary"
          :class="{
            'is-live':
              subView === 'game'
                ? gameStatus === 'running' || gameStatus === 'countdown'
                : isPlaying,
          }"
          @click="emit('togglePlay')"
        >
          {{
            subView === 'game'
              ? gameStatus === 'running' || gameStatus === 'countdown'
                ? '停止'
                : '开始闯关'
              : isPlaying
                ? '停止'
                : '开始'
          }}
        </button>
        <button type="button" class="transport-ghost" @click="emit('tapTempo')">TAP</button>
        <button
          v-if="subView !== 'beat'"
          type="button"
          class="transport-ghost"
          :class="{ 'is-on': pulseOnly }"
          @click="emit('update:pulseOnly', !pulseOnly)"
        >
          仅拍点
        </button>
      </div>
    </div>

    <!-- ================= 1. BEAT VIEW ================= -->
    <div v-if="subView === 'beat'" class="stage-body beat-body">
      <div class="beat-hero">
        <div class="beat-big-num tabular" :class="beatAccentClass">
          {{ isPlaying ? currentBeat + 1 : 1 }}
        </div>
        <div class="beat-subhint">{{ beatSubHint }}</div>

        <div class="beat-dots" aria-label="节拍指示灯">
          <div
            v-for="(accent, idx) in activeMeterSpec.pulse"
            :key="idx"
            class="beat-dot tabular"
            :class="{
              'is-strong-ring': accent === 3,
              'is-medium-ring': accent === 2,
              'is-on': isPlaying && currentBeat === idx,
            }"
          >
            {{ idx + 1 }}
          </div>
        </div>
      </div>

      <div class="beat-controls-row">
        <div class="chip-group">
          <span class="chip-label">拍号</span>
          <button
            v-for="m in METER_OPTIONS"
            :key="m"
            type="button"
            class="mini-chip tabular"
            :class="{ 'is-active': basicMeter === m }"
            @click="emit('update:basicMeter', m)"
          >
            {{ m }}
          </button>
        </div>

        <div class="chip-group">
          <span class="chip-label">细分</span>
          <button
            v-for="s in SUB_OPTIONS"
            :key="s.value"
            type="button"
            class="mini-chip"
            :class="{ 'is-active': basicSub === s.value }"
            @click="emit('update:basicSub', s.value)"
          >
            {{ s.label }}
          </button>
        </div>
      </div>

      <p class="stage-tip">{{ activeBasicPreset.tip }}</p>
    </div>

    <!-- ================= 2. GROOVE SEQUENCER VIEW ================= -->
    <div v-else-if="subView === 'groove'" class="stage-body groove-body">
      <div class="groove-meta">
        <div class="groove-title-line">
          <strong class="groove-name">{{ activeGroove.name }}</strong>
          <span class="groove-badge tabular">{{ grooveMeter }}</span>
          <span v-if="swing > 0.51" class="groove-badge is-swing tabular">
            摇摆 {{ Math.round(swing * 100) }}%
          </span>
          <span v-if="pulseOnly" class="groove-badge is-muted">仅拍点（鼓已静音）</span>
        </div>
        <span class="groove-stats tabular">
          拍点 {{ grooveStats.beats }} · 鼓点 {{ grooveStats.total }}（重{{ grooveStats.heavy }}/中{{ grooveStats.medium }}/轻{{ grooveStats.light }}）
        </span>
      </div>

      <div
        class="step-grid"
        :class="{ 'is-pulse-only': pulseOnly }"
        :style="{ gridTemplateColumns: `36px repeat(${totalSteps}, minmax(0, 1fr))` }"
      >
        <!-- Pulse row -->
        <div class="row-label">拍点</div>
        <div
          v-for="stepIdx in totalSteps"
          :key="`p-${stepIdx}`"
          class="step-cell is-pulse"
          :class="[
            (stepIdx - 1) > 0 && (stepIdx - 1) % activeMeterSpec.grooveSub === 0 ? 'is-beat-sep' : '',
            (stepIdx - 1) % activeMeterSpec.grooveSub === 0
              ? `is-k${activeMeterSpec.pulse[(stepIdx - 1) / activeMeterSpec.grooveSub] ?? 1}`
              : '',
            isPlaying && currentStep === stepIdx - 1 ? 'is-now' : '',
          ]"
        >
          <b v-if="(stepIdx - 1) % activeMeterSpec.grooveSub === 0" class="tabular">
            {{ (stepIdx - 1) / activeMeterSpec.grooveSub + 1 }}
          </b>
        </div>

        <!-- 4 Drum layers -->
        <template v-for="row in DRUM_ROWS" :key="row.id">
          <div class="row-label" :style="{ color: row.color }">{{ row.label }}</div>
          <button
            v-for="stepIdx in totalSteps"
            :key="`${row.id}-${stepIdx}`"
            type="button"
            class="step-cell"
            :style="{ '--cell-color': row.color }"
            :class="[
              (stepIdx - 1) > 0 && (stepIdx - 1) % activeMeterSpec.grooveSub === 0 ? 'is-beat-sep' : '',
              pattern[row.id][stepIdx - 1] ? `is-v${pattern[row.id][stepIdx - 1]}` : '',
              isPlaying && currentStep === stepIdx - 1 ? 'is-now' : '',
            ]"
            :aria-label="`${row.label} 第 ${stepIdx} 格`"
            @click="emit('cycleCell', row.id, stepIdx - 1)"
          ></button>
        </template>
      </div>

      <div class="groove-footer">
        <span class="tap-legend">点格子循环：重 → 中 → 轻 → 关</span>
        <p class="stage-tip">{{ activeGroove.tip }}</p>
      </div>
    </div>

    <!-- ================= 3. RHYTHM GAME VIEW ================= -->
    <div v-else class="stage-body game-body">
      <!-- Finished Score Summary Card -->
      <div v-if="gameStatus === 'finished'" class="game-summary-card">
        <div class="summary-top">
          <div class="summary-score-block">
            <span class="summary-score tabular">{{ gameSummary.score }}</span>
            <span class="summary-unit">分</span>
          </div>
          <div class="summary-info">
            <strong class="summary-title">{{ activeChallenge.name }}</strong>
            <span class="summary-meta tabular">
              {{ bpm }} BPM · {{ grooveMeter }} · 最大连击 ×{{ gameSummary.maxCombo }}
            </span>
            <span class="summary-bias tabular">
              平均偏移：{{ formatTimingBias(gameSummary.avgOffsetMs) }} · 稳定度 ±{{ gameSummary.stabilityMs }}ms
            </span>
          </div>
        </div>

        <div class="summary-grades tabular">
          <div class="grade-pill is-perfect">
            <span>Perfect</span>
            <strong>{{ gameSummary.perfectCount }}</strong>
          </div>
          <div class="grade-pill is-great">
            <span>Great</span>
            <strong>{{ gameSummary.greatCount }}</strong>
          </div>
          <div class="grade-pill is-good">
            <span>Good</span>
            <strong>{{ gameSummary.goodCount }}</strong>
          </div>
          <div class="grade-pill is-miss">
            <span>Miss</span>
            <strong>{{ gameSummary.missCount }}</strong>
          </div>
        </div>

        <div class="summary-actions">
          <button type="button" class="summary-btn is-primary" @click="emit('startGame')">
            再挑战一次
          </button>
          <button type="button" class="summary-btn is-accent" @click="emit('boostBpmAndReplay')">
            提速 +5 BPM
          </button>
          <button type="button" class="summary-btn" @click="emit('openLibrary')">
            换关卡
          </button>
        </div>
      </div>

      <!-- Active / Ready Game Runway + Tap Pad -->
      <template v-else>
        <div class="game-hud-row">
          <div class="game-challenge-meta">
            <strong class="game-name">{{ activeChallenge.name }}</strong>
            <span class="game-chip">{{ TARGET_MODE_LABELS[gameTargetMode] }}</span>
            <span v-if="gameBlindBars" class="game-chip is-blind">
              {{ gameInBlindBar ? '盲拍中 · 靠内心稳拍' : '含盲拍小节' }}
            </span>
          </div>
          <div class="game-live-stats tabular">
            <span v-if="gameStatus === 'running'" class="bar-badge">
              第 {{ currentBar + 1 }}/{{ gameBars }} 小节
            </span>
            <span v-if="gameCombo >= 2" class="combo-badge">×{{ gameCombo }}</span>
          </div>
        </div>

        <div class="highway-wrap">
          <canvas ref="canvasRef" class="highway-canvas"></canvas>

          <div v-if="gameCountdown !== null" class="countdown-overlay tabular">
            <span class="countdown-num">{{ gameCountdown }}</span>
            <span class="countdown-sub">预备拍</span>
          </div>

          <Transition name="grade-pop">
            <div
              v-if="gamePopup && gameStatus === 'running'"
              :key="gamePopup.id"
              class="grade-popup"
              :class="`is-${gamePopup.grade}`"
            >
              <span class="grade-word">{{ RHYTHM_GRADE_LABELS[gamePopup.grade] }}</span>
              <span v-if="gamePopup.offsetMs !== null" class="grade-ms tabular">
                {{
                  Math.abs(gamePopup.offsetMs) <= 10
                    ? '精准'
                    : gamePopup.offsetMs < 0
                      ? `快 ${Math.abs(gamePopup.offsetMs)}ms`
                      : `慢 +${gamePopup.offsetMs}ms`
                }}
              </span>
            </div>
          </Transition>
        </div>

        <!-- Zero-latency Thumb Tap Pad -->
        <button
          type="button"
          class="tap-pad"
          :class="{
            'is-pressed': padPressed,
            'is-blind': gameInBlindBar,
            'is-armed': gameStatus === 'running' || gameStatus === 'countdown',
          }"
          @pointerdown="handlePadPointerDown"
        >
          <span class="tap-pad-title">
            {{
              gameStatus === 'running' || gameStatus === 'countdown'
                ? gameInBlindBar
                  ? '盲拍敲击 · 保持稳速'
                  : '按节拍敲击'
                : '试敲鼓垫（点开始闯关进入计时）'
            }}
          </span>
          <span class="tap-pad-sub">
            {{ isMobile ? '触碰瞬间判定 · 支持快速连击' : '点击鼓垫或按 空格 / J / K 敲击' }}
          </span>
        </button>
      </template>
    </div>
  </section>
</template>

<style scoped>
.rhythm-stage {
  flex: 1 1 auto;
  min-inline-size: 0;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
  background-color: var(--surface-well);
  overflow: hidden;
}

.stage-top {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.6rem 0.9rem;
  background-color: var(--surface-panel);
  border-bottom: 1px solid var(--border-hairline);
  flex-wrap: wrap;
}

.sub-tabs {
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius-pill);
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
  gap: 2px;
}

.sub-tab {
  min-block-size: 2rem;
  padding: 0.2rem 0.85rem;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.82rem;
  font-weight: 600;
}

.sub-tab.is-active {
  background-color: var(--accent-brass);
  color: var(--accent-brass-ink);
}

.bpm-strip {
  flex: 1 1 200px;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  min-inline-size: 0;
}

.bpm-step {
  min-inline-size: 2rem;
  min-block-size: 2rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-weight: 700;
}

.bpm-slider {
  flex: 1 1 auto;
  min-inline-size: 72px;
  accent-color: var(--accent-brass);
}

.bpm-readout {
  min-inline-size: 62px;
  text-align: right;
  font-size: 1rem;
  font-weight: 700;
  color: var(--ink-ivory);
}

.bpm-readout small {
  margin-left: 2px;
  font-size: 0.68rem;
  color: var(--ink-muted);
  font-weight: 500;
}

.desktop-transport {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.transport-primary {
  min-block-size: 2.15rem;
  padding: 0.3rem 1rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--accent-brass);
  background-color: var(--accent-brass);
  color: var(--accent-brass-ink);
  font-size: 0.85rem;
  font-weight: 700;
}

.transport-primary.is-live {
  background-color: var(--pitch-sharp);
  border-color: var(--pitch-sharp);
}

.transport-ghost {
  min-block-size: 2.15rem;
  padding: 0.3rem 0.72rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.8rem;
  font-weight: 600;
}

.transport-ghost.is-on {
  border-color: var(--pitch-accurate);
  background-color: var(--pitch-accurate-soft);
  color: var(--pitch-accurate);
}

.stage-body {
  flex: 1 1 auto;
  min-block-size: 0;
  display: flex;
  flex-direction: column;
  padding: 0.9rem 1rem;
  gap: 0.75rem;
  overflow-y: auto;
}

/* ========== Beat View ========== */
.beat-body {
  justify-content: space-between;
  align-items: center;
}

.beat-hero {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
}

.beat-big-num {
  font-family: var(--font-display);
  font-size: clamp(4.2rem, 11vw, 6.2rem);
  font-weight: 700;
  line-height: 1;
  color: var(--accent-brass);
  transition: color 80ms ease, transform 80ms ease;
}

.beat-big-num.is-strong {
  color: var(--accent-brass);
  transform: scale(1.06);
}

.beat-big-num.is-medium {
  color: var(--pitch-accurate);
}

.beat-big-num.is-weak {
  color: var(--ink-secondary);
}

.beat-subhint {
  font-size: 0.8rem;
  color: var(--ink-secondary);
  min-block-size: 1.2rem;
}

.beat-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  margin-top: 0.4rem;
  flex-wrap: wrap;
}

.beat-dot {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  background-color: var(--surface-panel);
  color: var(--ink-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  font-weight: 700;
  transition: transform 70ms ease, background-color 70ms ease, border-color 70ms ease;
}

.beat-dot.is-strong-ring {
  border-color: var(--accent-brass);
}

.beat-dot.is-medium-ring {
  border-color: var(--pitch-accurate);
}

.beat-dot.is-on {
  background-color: var(--pitch-accurate);
  border-color: var(--pitch-accurate);
  color: #0b0f14;
  transform: scale(1.16);
}

.beat-dot.is-on.is-strong-ring {
  background-color: var(--accent-brass);
  border-color: var(--accent-brass);
}

.beat-controls-row {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chip-group {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: wrap;
}

.chip-label {
  font-size: 0.74rem;
  color: var(--ink-muted);
  min-inline-size: 2.2rem;
}

.mini-chip {
  flex: 1 1 auto;
  min-block-size: 2.15rem;
  padding: 0.25rem 0.65rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-panel);
  color: var(--ink-secondary);
  font-size: 0.8rem;
  font-weight: 600;
}

.mini-chip.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

/* ========== Groove Sequencer View ========== */
.groove-body {
  justify-content: center;
}

.groove-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.groove-title-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.groove-name {
  font-size: 1rem;
  color: var(--ink-ivory);
}

.groove-badge {
  padding: 0.12rem 0.48rem;
  border-radius: var(--radius-pill);
  background-color: var(--surface-raised);
  border: 1px solid var(--border-hairline);
  color: var(--ink-secondary);
  font-size: 0.72rem;
  font-weight: 600;
}

.groove-badge.is-swing {
  border-color: var(--accent-brass);
  color: var(--accent-brass);
}

.groove-badge.is-muted {
  border-color: var(--pitch-accurate);
  color: var(--pitch-accurate);
}

.groove-stats {
  font-size: 0.74rem;
  color: var(--ink-muted);
}

.step-grid {
  display: grid;
  gap: 3px;
  align-items: center;
  padding: 0.65rem 0.55rem;
  border-radius: var(--radius-md);
  background-color: var(--surface-panel);
  border: 1px solid var(--border-hairline);
}

.row-label {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--ink-muted);
  text-align: right;
  padding-right: 4px;
  white-space: nowrap;
}

.step-cell {
  position: relative;
  height: 36px;
  padding: 0;
  border-radius: 5px;
  border: 1px solid #222c38;
  background-color: #131922;
  overflow: hidden;
}

.step-cell.is-beat-sep {
  box-shadow: inset 2px 0 0 0 #425264;
}

.step-cell::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 0;
  background-color: var(--cell-color, var(--accent-brass));
  transition: height 90ms ease, opacity 90ms ease;
}

.step-cell.is-v3::before {
  height: 32%;
  opacity: 0.48;
}

.step-cell.is-v2::before {
  height: 64%;
  opacity: 0.74;
}

.step-cell.is-v1::before {
  height: 100%;
  opacity: 0.96;
}

.step-cell.is-pulse {
  height: 28px;
  background-color: #19222d;
  cursor: default;
}

.step-cell.is-pulse::before {
  background-color: #7c90a6;
}

.step-cell.is-pulse.is-k3::before {
  height: 100%;
  background-color: var(--accent-brass);
  opacity: 0.72;
}

.step-cell.is-pulse.is-k2::before {
  height: 64%;
  background-color: var(--pitch-accurate);
  opacity: 0.58;
}

.step-cell.is-pulse.is-k1::before {
  height: 32%;
  opacity: 0.35;
}

.step-cell.is-pulse b {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 0.68rem;
  color: var(--ink-ivory);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}

.step-cell.is-now {
  outline: 2px solid rgba(255, 255, 255, 0.75);
  outline-offset: -1px;
  z-index: 3;
}

.step-grid.is-pulse-only .step-cell:not(.is-pulse)::before {
  opacity: 0.14;
}

.groove-footer {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tap-legend {
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.stage-tip {
  margin: 0;
  width: 100%;
  padding: 0.62rem 0.78rem;
  border-radius: var(--radius-md);
  background-color: color-mix(in oklab, var(--accent-brass) 9%, var(--surface-panel));
  border: 1px solid color-mix(in oklab, var(--accent-brass) 28%, var(--border-hairline));
  color: var(--ink-secondary);
  font-size: 0.78rem;
  line-height: 1.5;
}

/* ========== Rhythm Game View ========== */
.game-body {
  gap: 0.6rem;
}

.game-hud-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.game-challenge-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.game-name {
  font-size: 0.92rem;
  color: var(--ink-ivory);
}

.game-chip {
  padding: 0.12rem 0.5rem;
  border-radius: var(--radius-pill);
  background-color: var(--surface-raised);
  border: 1px solid var(--border-hairline);
  color: var(--ink-secondary);
  font-size: 0.72rem;
  font-weight: 600;
}

.game-chip.is-blind {
  border-color: var(--rhythm-fill);
  color: var(--rhythm-fill);
}

.game-live-stats {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.bar-badge {
  font-size: 0.76rem;
  color: var(--ink-secondary);
}

.combo-badge {
  padding: 0.14rem 0.5rem;
  border-radius: var(--radius-pill);
  background-color: var(--grade-perfect-soft);
  color: var(--grade-perfect);
  font-size: 0.8rem;
  font-weight: 700;
}

.highway-wrap {
  position: relative;
  flex: 1 1 160px;
  min-block-size: 145px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-hairline);
  overflow: hidden;
  background-color: var(--surface-well);
}

.highway-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.countdown-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background-color: rgba(11, 15, 20, 0.55);
  pointer-events: none;
}

.countdown-num {
  font-family: var(--font-display);
  font-size: 4rem;
  font-weight: 700;
  color: var(--accent-brass);
  line-height: 1;
}

.countdown-sub {
  font-size: 0.82rem;
  color: var(--ink-secondary);
}

.grade-popup {
  position: absolute;
  top: 12px;
  left: 22%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.22rem 0.65rem;
  border-radius: var(--radius-pill);
  font-weight: 700;
  pointer-events: none;
}

.grade-popup.is-perfect {
  background-color: var(--grade-perfect-soft);
  color: var(--grade-perfect);
  border: 1px solid var(--grade-perfect);
}

.grade-popup.is-great {
  background-color: var(--grade-great-soft);
  color: var(--grade-great);
  border: 1px solid var(--grade-great);
}

.grade-popup.is-good {
  background-color: var(--grade-good-soft);
  color: var(--grade-good);
  border: 1px solid var(--grade-good);
}

.grade-popup.is-miss {
  background-color: var(--grade-miss-soft);
  color: var(--grade-miss);
  border: 1px solid var(--grade-miss);
}

.grade-word {
  font-size: 0.9rem;
}

.grade-ms {
  font-size: 0.72rem;
  opacity: 0.9;
}

.tap-pad {
  flex-shrink: 0;
  min-block-size: 92px;
  width: 100%;
  border-radius: var(--radius-lg);
  border: 2px solid var(--border-strong);
  background: radial-gradient(circle at 50% 30%, #233040, #151d26);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  transition: transform 60ms ease, border-color 80ms ease, background-color 80ms ease;
}

.tap-pad.is-armed {
  border-color: var(--accent-brass);
}

.tap-pad.is-blind {
  border-color: var(--rhythm-fill);
  background: radial-gradient(circle at 50% 30%, #1c283e, #121822);
}

.tap-pad.is-pressed {
  transform: scale(0.975);
  border-color: var(--grade-perfect);
  background: radial-gradient(circle at 50% 40%, color-mix(in oklab, var(--accent-brass) 28%, #1e2834), #151d26);
}

.tap-pad-title {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--ink-ivory);
}

.tap-pad-sub {
  font-size: 0.74rem;
  color: var(--ink-muted);
}

/* Game Summary Card */
.game-summary-card {
  margin: auto 0;
  padding: 1.15rem;
  border-radius: var(--radius-lg);
  background-color: var(--surface-panel);
  border: 1px solid var(--border-strong);
  display: flex;
  flex-direction: column;
  gap: 0.95rem;
}

.summary-top {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.summary-score-block {
  display: flex;
  align-items: baseline;
  gap: 0.15rem;
  color: var(--accent-brass);
}

.summary-score {
  font-family: var(--font-display);
  font-size: 3.1rem;
  font-weight: 700;
  line-height: 1;
}

.summary-unit {
  font-size: 0.85rem;
  font-weight: 600;
}

.summary-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.summary-title {
  font-size: 0.98rem;
  color: var(--ink-ivory);
}

.summary-meta,
.summary-bias {
  font-size: 0.78rem;
  color: var(--ink-secondary);
}

.summary-grades {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.45rem;
}

.grade-pill {
  padding: 0.5rem 0.35rem;
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.12rem;
  font-size: 0.72rem;
}

.grade-pill strong {
  font-size: 1.05rem;
}

.grade-pill.is-perfect {
  background-color: var(--grade-perfect-soft);
  color: var(--grade-perfect);
}

.grade-pill.is-great {
  background-color: var(--grade-great-soft);
  color: var(--grade-great);
}

.grade-pill.is-good {
  background-color: var(--grade-good-soft);
  color: var(--grade-good);
}

.grade-pill.is-miss {
  background-color: var(--grade-miss-soft);
  color: var(--grade-miss);
}

.summary-actions {
  display: flex;
  gap: 0.5rem;
}

.summary-btn {
  flex: 1 1 0;
  min-block-size: 2.55rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.84rem;
  font-weight: 600;
}

.summary-btn.is-primary {
  background-color: var(--accent-brass);
  border-color: var(--accent-brass);
  color: var(--accent-brass-ink);
  font-weight: 700;
}

.summary-btn.is-accent {
  border-color: var(--pitch-accurate);
  background-color: var(--pitch-accurate-soft);
  color: var(--pitch-accurate);
}

.grade-pop-enter-active {
  transition: transform 140ms ease, opacity 140ms ease;
}

.grade-pop-enter-from {
  opacity: 0;
  transform: translate(-50%, 8px) scale(0.92);
}

@media (max-width: 900px) {
  .stage-top {
    padding: 0.45rem 0.68rem;
    gap: 0.45rem;
  }

  .stage-body {
    padding: 0.62rem 0.68rem;
    gap: 0.55rem;
  }

  .step-cell {
    height: 32px;
  }

  .tap-pad {
    min-block-size: 102px;
  }
}
</style>
