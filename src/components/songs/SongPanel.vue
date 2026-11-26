<script setup lang="ts">
import { ref } from 'vue'
import { formatCents, formatTimestamp, midiToNoteParts } from '../../audio/pitchMath'
import { GRADE_LABELS } from '../../practice/grading'
import type { NoteResult, PracticeGrade, PracticeStatus } from '../../practice/types'
import type { ImportedSong, SongNote } from '../../songs/types'

interface Props {
  songs: ImportedSong[]
  selectedSong: ImportedSong
  scaledNotes: SongNote[]
  currentNote: SongNote | null
  transposeSemitones: number
  tempoRate: number
  muteGuideMelody: boolean
  playBackingAudio: boolean
  loopEnabled: boolean
  loopStart: number
  loopEnd: number
  isImporting: boolean
  importProgress: number
  importError: string | null
  status: PracticeStatus
  isPreviewOnly: boolean
  countdownValue: number
  combo: number
  results: NoteResult[]
  summary: {
    score: number
    counts: Record<PracticeGrade, number>
    maxCombo: number
    missedMidis: number[]
  }
  statusMessage: string | null
  liveDirection: 'in-tune' | 'sharp' | 'flat' | null
  liveCents: number | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  selectSong: [id: string]
  selectMidiTrack: [trackIndex: number]
  importFile: [file: File]
  cancelImport: []
  removeSong: [id: string]
  previewMelody: []
  startSingAlong: []
  pause: []
  resume: []
  stop: []
  'update:transposeSemitones': [value: number]
  'update:tempoRate': [value: number]
  'update:muteGuideMelody': [value: boolean]
  'update:playBackingAudio': [value: boolean]
  'update:loopEnabled': [value: boolean]
  'update:loopStart': [value: number]
  'update:loopEnd': [value: number]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
const speedChoices = [0.6, 0.75, 0.9, 1.0, 1.15] as const

function triggerUpload() {
  fileInputRef.value?.click()
}

function handleFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    emit('importFile', file)
  }
  input.value = ''
}

function stepTranspose(delta: number) {
  const next = Math.max(-12, Math.min(12, props.transposeSemitones + delta))
  emit('update:transposeSemitones', next)
}

function onTrackChange(e: Event) {
  emit('selectMidiTrack', Number((e.target as HTMLSelectElement).value))
}
</script>

<template>
  <aside class="song-panel studio-scroll" aria-label="歌曲导入与跟练面板">
    <div v-if="importError || statusMessage" role="alert" class="panel-notice">
      {{ importError || statusMessage }}
    </div>

    <!-- Import Upload Trigger -->
    <div v-if="status === 'idle'" class="upload-box">
      <input
        ref="fileInputRef"
        type="file"
        accept=".mid,.midi,.wav,.mp3,.m4a,.aac,.ogg"
        class="visually-hidden"
        @change="handleFileChange"
      />
      <button
        type="button"
        class="upload-btn"
        :disabled="isImporting"
        @click="triggerUpload"
      >
        <span>导入歌曲（MIDI / 单人清唱）</span>
      </button>
      <p class="helper-text">
        支持 <code>.mid</code>（自动识别主旋律轨）与 <code>.wav/.mp3/.m4a</code> 清唱（≤10MB / 60s），全部本地解析。
      </p>

      <div v-if="isImporting" class="import-progress">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${importProgress}%` }"></div>
        </div>
        <div class="progress-meta tabular">
          <span>正在提取旋律 {{ importProgress }}%</span>
          <button type="button" class="text-btn" @click="emit('cancelImport')">取消</button>
        </div>
      </div>
    </div>

    <!-- Song Library Selector (when idle) -->
    <template v-if="status === 'idle'">
      <div class="panel-section">
        <span class="section-title">曲库（{{ songs.length }}）</span>
        <div class="song-list studio-scroll">
          <div
            v-for="song in songs"
            :key="song.id"
            class="song-row"
            :class="{ 'is-active': song.id === selectedSong.id }"
          >
            <button
              type="button"
              class="song-select-btn"
              @click="emit('selectSong', song.id)"
            >
              <span class="song-title">{{ song.title }}</span>
              <span class="song-meta tabular">
                {{ song.sourceType === 'midi' ? 'MIDI' : song.sourceType === 'audio' ? '清唱' : '示例' }}
                · {{ song.notes.length }} 音 · {{ formatTimestamp(song.duration).slice(0, 5) }}
              </span>
            </button>
            <button
              v-if="song.sourceType !== 'builtin'"
              type="button"
              class="delete-song-btn"
              title="删除此歌曲"
              aria-label="删除此歌曲"
              @click="emit('removeSong', song.id)"
            >
              ×
            </button>
          </div>
        </div>
      </div>

      <!-- MIDI Track Selector -->
      <div
        v-if="selectedSong.tracks && selectedSong.tracks.length > 1"
        class="panel-section"
      >
        <label class="section-title" for="midi-track-sel">选择旋律轨</label>
        <select
          id="midi-track-sel"
          class="full-select"
          :value="selectedSong.selectedTrackIndex"
          @change="onTrackChange"
        >
          <option v-for="tr in selectedSong.tracks" :key="tr.index" :value="tr.index">
            {{ tr.name }} ({{ tr.noteCount }} 音 · {{ midiToNoteParts(tr.minMidi).displayFullName }}–{{ midiToNoteParts(tr.maxMidi).displayFullName }})
          </option>
        </select>
      </div>

      <!-- Transpose & Tempo -->
      <div class="panel-section">
        <div class="section-head">
          <span class="section-title">升降调（移调）</span>
          <button
            v-if="transposeSemitones !== 0"
            type="button"
            class="text-btn"
            @click="emit('update:transposeSemitones', 0)"
          >
            恢复原调
          </button>
        </div>
        <div class="stepper-row">
          <button type="button" class="step-btn" @click="stepTranspose(-1)">− 半音</button>
          <span class="step-val tabular">
            {{ transposeSemitones === 0 ? '原调' : `${transposeSemitones > 0 ? '+' : ''}${transposeSemitones} 半音` }}
          </span>
          <button type="button" class="step-btn" @click="stepTranspose(1)">+ 半音</button>
        </div>
      </div>

      <div class="panel-section">
        <span class="section-title">播放速度</span>
        <div class="speed-row">
          <button
            v-for="rate in speedChoices"
            :key="rate"
            type="button"
            class="seg-choice tabular"
            :class="{ 'is-active': tempoRate === rate }"
            @click="emit('update:tempoRate', rate)"
          >
            {{ rate }}×
          </button>
        </div>
      </div>

      <!-- A-B Loop -->
      <div class="panel-section">
        <label class="toggle-line">
          <input
            type="checkbox"
            :checked="loopEnabled"
            @change="emit('update:loopEnabled', ($event.target as HTMLInputElement).checked)"
          />
          <span>A–B 片段循环（{{ scaledNotes.length }} 音）</span>
        </label>
        <div v-if="loopEnabled" class="loop-inputs tabular">
          <label>
            起点(s)
            <input
              type="number"
              min="0"
              :max="Math.max(0, selectedSong.duration - 1)"
              step="0.5"
              :value="loopStart"
              @input="emit('update:loopStart', Number(($event.target as HTMLInputElement).value) || 0)"
            />
          </label>
          <label>
            终点(s)
            <input
              type="number"
              :min="loopStart + 1"
              :max="Math.ceil(selectedSong.duration)"
              step="0.5"
              :value="loopEnd"
              @input="emit('update:loopEnd', Number(($event.target as HTMLInputElement).value) || selectedSong.duration)"
            />
          </label>
        </div>
      </div>

      <label class="toggle-line">
        <input
          type="checkbox"
          :checked="muteGuideMelody"
          @change="emit('update:muteGuideMelody', ($event.target as HTMLInputElement).checked)"
        />
        <span>静音钢琴引导音（纯看音条清唱）</span>
      </label>

      <label v-if="selectedSong.hasBackingAudio && transposeSemitones === 0" class="toggle-line">
        <input
          type="checkbox"
          :checked="playBackingAudio"
          @change="emit('update:playBackingAudio', ($event.target as HTMLInputElement).checked)"
        />
        <span>同时播放导入原声作为参考</span>
      </label>

      <div class="action-pair">
        <button type="button" class="btn-secondary" @click="emit('previewMelody')">
          试听旋律
        </button>
        <button type="button" class="cta-start" @click="emit('startSingAlong')">
          开始跟唱打分
        </button>
      </div>
    </template>

    <!-- RUNNING / PAUSED / COUNTDOWN HUD -->
    <template v-else-if="status === 'running' || status === 'countdown' || status === 'paused'">
      <div class="hud-top">
        <span class="phase-pill" :class="{ 'is-sing': !isPreviewOnly, 'is-demo': isPreviewOnly }">
          {{ status === 'countdown' ? `倒计时 ${countdownValue}` : isPreviewOnly ? '旋律试听中' : status === 'paused' ? '已暂停' : '跟唱打分中' }}
        </span>
        <span class="song-meta">{{ selectedSong.title }}</span>
      </div>

      <div class="target-card">
        <span class="target-caption">当前旋律音</span>
        <div v-if="currentNote" class="target-glyph">
          <span class="t-letter">{{ midiToNoteParts(currentNote.midi).noteLetter }}</span>
          <span v-if="midiToNoteParts(currentNote.midi).accidental" class="t-acc">
            {{ midiToNoteParts(currentNote.midi).accidental }}
          </span>
          <span class="t-oct tabular">{{ midiToNoteParts(currentNote.midi).octave }}</span>
        </div>
        <div v-else class="target-sub">前奏 / 间奏</div>

        <div
          v-if="!isPreviewOnly"
          class="direction-badge tabular"
          :class="{
            'dir-ok': liveDirection === 'in-tune',
            'dir-sharp': liveDirection === 'sharp',
            'dir-flat': liveDirection === 'flat',
          }"
        >
          <span>
            {{
              liveDirection === 'in-tune'
                ? '音准稳定'
                : liveDirection === 'sharp'
                  ? '偏高 ↓'
                  : liveDirection === 'flat'
                    ? '偏低 ↑'
                    : '跟着音条唱'
            }}
          </span>
          <span v-if="liveCents !== null">{{ formatCents(liveCents) }}</span>
        </div>
      </div>

      <div v-if="!isPreviewOnly" class="grade-counters tabular">
        <span class="gc g-perfect">Perfect {{ summary.counts.perfect }}</span>
        <span class="gc g-great">Great {{ summary.counts.great }}</span>
        <span class="gc g-good">Good {{ summary.counts.good }}</span>
        <span class="gc g-miss">Miss {{ summary.counts.miss }}</span>
      </div>

      <div class="hud-actions">
        <button v-if="status === 'paused'" type="button" class="cta-start" @click="emit('resume')">
          继续
        </button>
        <button v-else type="button" class="btn-secondary" @click="emit('pause')">
          暂停
        </button>
        <button type="button" class="btn-danger-ghost" @click="emit('stop')">
          停止并返回
        </button>
      </div>
    </template>

    <!-- FINISHED SUMMARY -->
    <template v-else-if="status === 'finished'">
      <div class="summary-hero">
        <span class="target-caption">{{ selectedSong.title }}</span>
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
        <div v-for="res in results.slice(0, 40)" :key="res.noteId" class="result-row">
          <span class="res-note">{{ midiToNoteParts(res.midi).displayFullName }}</span>
          <span class="res-badge" :class="`g-${res.grade}`">{{ GRADE_LABELS[res.grade].title }}</span>
          <span class="res-cents tabular">{{ res.voicedRatio > 0 ? formatCents(res.meanCents) : '未发声' }}</span>
        </div>
      </div>

      <div class="hud-actions">
        <button type="button" class="cta-start" @click="emit('startSingAlong')">再唱一遍</button>
        <button type="button" class="btn-secondary" @click="emit('stop')">返回歌曲设置</button>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.song-panel {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
  padding: 0.9rem;
  background-color: var(--surface-panel);
  border-inline-end: 1px solid var(--border-hairline);
  overflow-y: auto;
}

.panel-notice {
  padding: 0.55rem 0.7rem;
  border-radius: var(--radius-sm);
  background-color: var(--pitch-sharp-soft);
  border: 1px solid var(--pitch-sharp);
  color: var(--ink-ivory);
  font-size: 0.8rem;
}

.upload-box {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.upload-btn {
  min-block-size: 2.45rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1.5px dashed var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
  font-size: 0.84rem;
  font-weight: 700;
}

.import-progress {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.progress-bar {
  height: 6px;
  border-radius: var(--radius-pill);
  background-color: var(--surface-well);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--accent-brass);
  transition: width 0.2s ease;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.74rem;
  color: var(--ink-secondary);
}

.panel-section {
  display: flex;
  flex-direction: column;
  gap: 0.36rem;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--ink-secondary);
}

.song-list {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-block-size: 132px;
  overflow-y: auto;
}

.song-row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-well);
}

.song-row.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
}

.song-select-btn {
  flex: 1 1 auto;
  min-inline-size: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  padding: 0.42rem 0.55rem;
  border: none;
  background: none;
  text-align: left;
}

.song-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--ink-ivory);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-inline-size: 100%;
}

.song-meta {
  font-size: 0.71rem;
  color: var(--ink-muted);
}

.delete-song-btn {
  border: none;
  background: none;
  color: var(--ink-muted);
  font-size: 1.05rem;
  padding: 0.3rem 0.55rem;
}

.full-select {
  padding: 0.38rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-well);
  color: var(--ink-ivory);
  font-size: 0.8rem;
}

.stepper-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.4rem;
}

.step-btn {
  padding: 0.34rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.78rem;
}

.step-val {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent-brass);
  padding-inline: 0.25rem;
}

.speed-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.24rem;
}

.seg-choice {
  padding: 0.32rem 0.2rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background-color: var(--surface-well);
  color: var(--ink-secondary);
  font-size: 0.74rem;
}

.seg-choice.is-active {
  border-color: var(--accent-brass);
  background-color: var(--accent-brass-soft);
  color: var(--ink-ivory);
  font-weight: 700;
}

.loop-inputs {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.4rem;
}

.loop-inputs label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-size: 0.72rem;
  color: var(--ink-muted);
}

.loop-inputs input {
  padding: 0.3rem 0.45rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-well);
  color: var(--ink-ivory);
  font-size: 0.8rem;
}

.toggle-line {
  display: flex;
  align-items: center;
  gap: 0.42rem;
  font-size: 0.77rem;
  color: var(--ink-secondary);
  cursor: pointer;
}

.helper-text {
  margin: 0;
  font-size: 0.72rem;
  color: var(--ink-muted);
  line-height: 1.4;
}

.action-pair {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 0.42rem;
}

.cta-start {
  min-block-size: 2.45rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--accent-brass);
  background-color: var(--accent-brass);
  color: var(--accent-brass-ink);
  font-size: 0.86rem;
  font-weight: 700;
}

.btn-secondary {
  min-block-size: 2.45rem;
  padding: 0.48rem 0.7rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-strong);
  background-color: var(--surface-raised);
  color: var(--ink-ivory);
  font-size: 0.83rem;
  font-weight: 600;
}

.btn-danger-ghost {
  min-block-size: 2.2rem;
  padding: 0.4rem 0.7rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-hairline);
  background: transparent;
  color: var(--ink-secondary);
  font-size: 0.82rem;
}

.text-btn {
  border: none;
  background: none;
  color: var(--ink-muted);
  font-size: 0.74rem;
  padding: 0;
}

.hud-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.phase-pill {
  padding: 0.24rem 0.65rem;
  border-radius: var(--radius-pill);
  font-size: 0.75rem;
  font-weight: 700;
}

.phase-pill.is-demo {
  background-color: var(--accent-brass-soft);
  color: var(--accent-brass);
}

.phase-pill.is-sing {
  background-color: var(--grade-great-soft);
  color: var(--grade-great);
}

.target-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.32rem;
  padding: 0.85rem;
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
  font-size: 2.9rem;
  color: var(--ink-ivory);
}

.t-acc {
  font-family: var(--font-display);
  font-size: 1.5rem;
  color: var(--accent-brass);
}

.t-oct {
  font-size: 1.25rem;
  color: var(--ink-secondary);
}

.target-sub {
  font-size: 0.82rem;
  color: var(--ink-secondary);
}

.direction-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.24rem 0.68rem;
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

.grade-counters {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.35rem;
}

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

.hud-actions {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

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
  font-size: 2.6rem;
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
}

.result-list {
  display: flex;
  flex-direction: column;
  gap: 0.26rem;
  max-block-size: 180px;
  overflow-y: auto;
}

.result-row {
  display: grid;
  grid-template-columns: 46px 1fr 56px;
  align-items: center;
  gap: 0.45rem;
  padding: 0.3rem 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--surface-well);
  font-size: 0.78rem;
}

.res-note {
  font-weight: 700;
}

.res-cents {
  text-align: right;
  color: var(--ink-secondary);
}

@media (max-width: 900px) {
  .song-panel {
    border-inline-end: none;
    border-block-end: 1px solid var(--border-hairline);
  }
}
</style>
