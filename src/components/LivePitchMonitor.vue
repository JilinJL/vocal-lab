<script setup lang="ts">
import { computed } from 'vue'
import {
  formatCents,
  formatTimestamp,
  midiToFrequency,
  midiToNoteParts,
  type PitchInfo,
} from '../audio/pitchMath'

interface HoverReadout {
  pitch: PitchInfo
  time: number
}

interface RangeSummary {
  min: PitchInfo
  max: PitchInfo
  semitoneSpan: number
  voicedCount: number
}

interface Props {
  isListening: boolean
  isDemo: boolean
  currentPitch: PitchInfo | null
  lastStablePitch: PitchInfo | null
  hoveredPoint: HoverReadout | null
  referenceMidi: number | null
  inputLevel: number
  a4Hz: number
  voicedRange: RangeSummary | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  clearReference: []
}>()

// Prioritize hovered point when user inspects curve, else live pitch, else last stable note
const activePitch = computed<PitchInfo | null>(() => {
  if (props.hoveredPoint) return props.hoveredPoint.pitch
  if (props.currentPitch) return props.currentPitch
  return props.lastStablePitch
})

const modeLabel = computed(() => {
  if (props.hoveredPoint) {
    return `回看 ${formatTimestamp(props.hoveredPoint.time)}`
  }
  if (props.isListening) {
    return props.currentPitch ? '实时音高' : '等待发声'
  }
  if (props.isDemo) {
    return '示例轨迹'
  }
  return props.lastStablePitch ? '最近音高' : '待机中'
})

const isLiveDimmed = computed(
  () => !props.hoveredPoint && props.isListening && !props.currentPitch && !!props.lastStablePitch,
)

// Map -50..+50 cents to 0%..100% along the scale bar
const needlePercent = computed(() => {
  if (!activePitch.value) return 50
  const clamped = Math.max(-50, Math.min(50, activePitch.value.cents))
  return 50 + clamped
})

const referenceInfo = computed(() => {
  if (props.referenceMidi === null) return null
  const parts = midiToNoteParts(props.referenceMidi)
  const freq = midiToFrequency(props.referenceMidi, props.a4Hz)
  return {
    name: parts.displayFullName,
    solfege: parts.solfege,
    freq: freq.toFixed(1),
  }
})

// 14-segment studio input VU meter
const vuSegments = 14
const litSegments = computed(() => Math.round(props.inputLevel * vuSegments))
</script>

<template>
  <aside class="pitch-monitor" aria-label="实时音高监测面板">
    <div class="monitor-head">
      <span
        class="mode-tag"
        :class="{ 'is-inspect': !!hoveredPoint, 'is-live': isListening && !!currentPitch }"
      >
        {{ modeLabel }}
      </span>

      <span v-if="activePitch" class="cents-pill tabular" aria-label="相对最近半音的音分偏移">
        {{ formatCents(activePitch.cents) }}
      </span>
    </div>

    <!-- Engraved-style primary note display -->
    <div class="note-stage" :class="{ 'is-dimmed': isLiveDimmed }">
      <template v-if="activePitch">
        <div class="note-glyph" aria-live="off">
          <span class="note-letter">{{ activePitch.noteLetter }}</span>
          <span v-if="activePitch.accidental" class="note-accidental">{{ activePitch.accidental }}</span>
          <span class="note-octave tabular">{{ activePitch.octave }}</span>
        </div>
        <div class="note-meta">
          <span class="meta-solfege">{{ activePitch.solfege }} · {{ activePitch.jianpu }}</span>
          <span class="meta-freq tabular">{{ activePitch.frequency.toFixed(1) }} Hz</span>
        </div>
      </template>
      <template v-else>
        <div class="note-glyph note-empty">
          <span class="note-letter">—</span>
        </div>
        <div class="note-meta">
          <span class="meta-solfege">点击「开始检测」开口试唱</span>
          <span class="meta-freq tabular">支持 C2 – D6 人声音域</span>
        </div>
      </template>
    </div>

    <!-- Objective Cents Offset Scale -->
    <div class="cents-meter" role="group" aria-label="音分位置标尺">
      <div class="meter-scale tabular" aria-hidden="true">
        <span>−50¢</span>
        <span>−25</span>
        <span class="center-mark">0</span>
        <span>+25</span>
        <span>+50¢</span>
      </div>
      <div class="meter-track">
        <div class="meter-centerline" aria-hidden="true"></div>
        <div
          v-if="activePitch"
          class="meter-needle"
          :style="{ left: `${needlePercent}%` }"
        ></div>
      </div>
    </div>

    <!-- Mic Level VU Meter -->
    <div class="vu-section">
      <div class="vu-header">
        <span class="vu-label">麦克风电平</span>
        <span class="vu-state">{{ isListening ? '采集中' : '未开启' }}</span>
      </div>
      <div class="vu-bar" aria-hidden="true">
        <span
          v-for="idx in vuSegments"
          :key="idx"
          class="vu-seg"
          :class="{
            'is-lit': idx <= litSegments,
            'is-hot': idx > 11,
            'is-warm': idx > 8 && idx <= 11,
          }"
        ></span>
      </div>
    </div>

    <!-- Reference Piano Target & Factual Vocal Range Telemetry -->
    <div class="telemetry-stack">
      <div v-if="referenceInfo" class="telemetry-row ref-row">
        <div class="ref-info">
          <span class="row-label">参考目标音</span>
          <strong class="ref-note tabular">
            {{ referenceInfo.name }}
            <small>{{ referenceInfo.solfege }} · {{ referenceInfo.freq }} Hz</small>
          </strong>
        </div>
        <button
          type="button"
          class="clear-ref-btn"
          aria-label="清除参考目标音线"
          title="清除参考线"
          @click="emit('clearReference')"
        >
          ×
        </button>
      </div>

      <div v-if="voicedRange" class="telemetry-row range-row">
        <div class="stat-item">
          <span class="row-label">记录音域</span>
          <strong class="stat-val tabular">
            {{ voicedRange.min.fullName }} – {{ voicedRange.max.fullName }}
          </strong>
        </div>
        <div class="stat-item stat-right">
          <span class="row-label">音程跨度</span>
          <strong class="stat-val tabular">{{ voicedRange.semitoneSpan }} 半音</strong>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.pitch-monitor {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.05rem 1.15rem;
  background-color: var(--surface-panel);
  border-inline-end: 1px solid var(--border-hairline);
  min-inline-size: 0;
}

.monitor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-block-size: 1.65rem;
}

.mode-tag {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--ink-secondary);
  padding: 0.16rem 0.52rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-well);
}

.mode-tag.is-live {
  color: var(--pitch-accurate);
  border-color: color-mix(in oklab, var(--pitch-accurate) 48%, var(--surface-well));
  background-color: var(--pitch-accurate-soft);
}

.mode-tag.is-inspect {
  color: var(--accent-brass);
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
}

.cents-pill {
  font-size: 0.78rem;
  font-weight: 600;
  padding: 0.16rem 0.56rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-well);
  color: var(--ink-ivory);
}

.note-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 0.5rem 0.6rem;
  border-radius: var(--radius-md);
  background: radial-gradient(
    circle at 50% 35%,
    color-mix(in oklab, var(--surface-raised) 85%, var(--surface-well)),
    var(--surface-well)
  );
  border: 1px solid var(--border-hairline);
}

.note-stage.is-dimmed {
  opacity: 0.56;
}

.note-glyph {
  display: inline-flex;
  align-items: baseline;
  font-family: var(--font-display);
  color: var(--ink-ivory);
  line-height: 1;
}

.note-letter {
  font-size: clamp(2.8rem, 2.2rem + 2.2vw, 4.4rem);
  font-weight: 500;
  letter-spacing: -0.02em;
}

.note-accidental {
  font-size: clamp(1.4rem, 1.1rem + 1vw, 2.1rem);
  color: var(--accent-brass);
  transform: translateY(-0.55em);
  margin-inline: 0.04em;
}

.note-octave {
  font-size: clamp(1.35rem, 1.1rem + 0.8vw, 1.95rem);
  color: var(--ink-secondary);
  margin-inline-start: 0.08em;
}

.note-empty .note-letter {
  color: var(--ink-muted);
}

.note-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.45rem;
  font-size: 0.84rem;
}

.meta-solfege {
  color: var(--ink-secondary);
  font-weight: 500;
}

.meta-freq {
  color: var(--ink-ivory);
  font-weight: 600;
}

/* Neutral Cents Position Scale */
.cents-meter {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.meter-scale {
  display: flex;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.center-mark {
  color: var(--ink-secondary);
  font-weight: 600;
}

.meter-track {
  position: relative;
  block-size: 16px;
  border-radius: var(--radius-pill);
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
  overflow: hidden;
}

.meter-centerline {
  position: absolute;
  inset-block: 2px;
  left: 50%;
  width: 1px;
  background-color: var(--border-strong);
}

.meter-needle {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 6px;
  margin-left: -3px;
  border-radius: 3px;
  background-color: var(--pitch-accurate);
  box-shadow: 0 0 10px var(--pitch-accurate);
}

/* VU Bar */
.vu-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.vu-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.76rem;
  color: var(--ink-secondary);
}

.vu-state {
  color: var(--ink-muted);
}

.vu-bar {
  display: grid;
  grid-template-columns: repeat(14, 1fr);
  gap: 3px;
  block-size: 8px;
}

.vu-seg {
  border-radius: 2px;
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
}

.vu-seg.is-lit {
  background-color: var(--pitch-accurate);
  border-color: var(--pitch-accurate);
}

.vu-seg.is-lit.is-warm {
  background-color: var(--accent-brass);
  border-color: var(--accent-brass);
}

.vu-seg.is-lit.is-hot {
  background-color: var(--pitch-sharp);
  border-color: var(--pitch-sharp);
}

/* Telemetry Stack */
.telemetry-stack {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  margin-top: auto;
}

.telemetry-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  background-color: var(--surface-well);
  border: 1px solid var(--border-hairline);
}

.ref-row {
  border-color: color-mix(in oklab, var(--accent-brass) 55%, var(--border-hairline));
  background-color: var(--accent-brass-soft);
}

.ref-info {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.row-label {
  font-size: 0.72rem;
  color: var(--ink-secondary);
}

.ref-note {
  font-size: 0.92rem;
  color: var(--accent-brass);
  font-weight: 600;
}

.ref-note small {
  font-weight: 500;
  color: var(--ink-ivory);
  margin-inline-start: 0.35rem;
  font-size: 0.78rem;
}

.clear-ref-btn {
  min-inline-size: 1.75rem;
  min-block-size: 1.75rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-panel);
  color: var(--ink-ivory);
  font-size: 1rem;
  line-height: 1;
}

.range-row {
  display: grid;
  grid-template-columns: 1fr auto;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.stat-right {
  text-align: right;
}

.stat-val {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--ink-ivory);
}

@media (prefers-reduced-motion: no-preference) {
  .meter-needle {
    transition: left 60ms linear;
  }

  .note-stage {
    transition: opacity 180ms ease;
  }
}

@media (max-width: 900px) {
  .pitch-monitor {
    border-inline-end: none;
    border-block-end: 1px solid var(--border-hairline);
    padding: 0.85rem 1rem;
    gap: 0.7rem;
  }

  .note-stage {
    flex-direction: row;
    justify-content: space-between;
    padding: 0.6rem 1rem;
  }

  .note-meta {
    flex-direction: column;
    align-items: flex-end;
    gap: 0.15rem;
    margin-top: 0;
  }

  .telemetry-stack {
    flex-direction: row;
    flex-wrap: wrap;
    margin-top: 0;
  }

  .telemetry-row {
    flex: 1 1 180px;
  }
}
</style>
