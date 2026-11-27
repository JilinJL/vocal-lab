import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from 'vue'
import { midiToNoteParts, type PitchSample } from '../audio/pitchMath'
import { PitchStabilizer } from '../audio/pitchStabilizer'
import type { PianoSynthesizer, ScheduledNoteHandle } from '../audio/pianoSynth'
import { ensureAudioContextRunning, getAudioTime } from '../engine/audioContext'
import type { PitchEngine, PitchFrame } from '../engine/pitchEngine'
import {
  computeCentsError,
  computeProvisionalGrade,
  gradeNote,
  summarizeResults,
} from '../practice/grading'
import { buildPracticeTimeline, generatePracticeSequence } from '../practice/sequences'
import {
  clearPracticeHistory,
  loadPracticeHistory,
  savePracticeRecord,
} from '../practice/storage'
import type {
  GradeFeedbackPopup,
  NoteResult,
  PracticeGrade,
  PracticeNoteSlot,
  PracticeSessionRecord,
  PracticeStatus,
  TargetBar,
} from '../practice/types'
import { useSettings } from './useSettings'

export interface PracticeDeps {
  engine: PitchEngine
  startMic: () => Promise<boolean>
  synth: PianoSynthesizer
  a4Hz: Ref<number>
}

export function usePracticeSession(deps: PracticeDeps) {
  const settings = useSettings()

  const status = ref<PracticeStatus>('idle')
  const countdownValue = ref(3)
  const slots = ref<PracticeNoteSlot[]>([])
  const currentIndex = ref(0)
  const playheadTime = ref(0)
  const activePhase = ref<'demo' | 'gap' | 'sing' | null>(null)
  const combo = ref(0)
  const maxCombo = ref(0)
  const results = ref<NoteResult[]>([])
  const provisionalGrades = ref<Record<string, PracticeGrade | null>>({})
  const lastGradePopup = ref<GradeFeedbackPopup | null>(null)
  const history = ref<PracticeSessionRecord[]>(loadPracticeHistory())
  const statusMessage = ref<string | null>(null)
  const liveDirection = ref<'in-tune' | 'sharp' | 'flat' | null>(null)
  const liveCents = ref<number | null>(null)

  const samples = shallowRef<PitchSample[]>([])
  const sampleVersion = ref(0)

  let rawFrames: PitchFrame[] = []
  let sessionOriginAudioTime = 0
  let scheduledIds = new Set<string>()
  let activeHandles: ScheduledNoteHandle[] = []
  let gradedIds = new Set<string>()
  let schedulerTimer: number | null = null
  let countdownTimer: number | null = null
  let unsubPitch: (() => void) | null = null
  let popupCounter = 0
  let activeCustomMidis: number[] | null = null
  let sessionA4Snapshot = 440
  let lastProvisionalCheck = 0
  const stabilizer = new PitchStabilizer()

  const previewSequence = computed(() => {
    if (activeCustomMidis && activeCustomMidis.length > 0) {
      return activeCustomMidis
    }
    return generatePracticeSequence(
      settings.practiceRangeMin,
      settings.practiceRangeMax,
      settings.practicePattern,
    )
  })

  const currentSlot = computed<PracticeNoteSlot | null>(() => {
    return slots.value[currentIndex.value] ?? null
  })

  const summary = computed(() => summarizeResults(results.value))

  const targetBars = computed<TargetBar[]>(() => {
    const list: TargetBar[] = []
    const resultMap = new Map(results.value.map((r) => [r.noteId, r]))
    const provMap = provisionalGrades.value
    const sourceSlots =
      slots.value.length > 0
        ? slots.value
        : buildPracticeTimeline(
            previewSequence.value,
            settings.practiceSpeed,
            settings.practiceListenMode,
          )

    for (const slot of sourceSlots) {
      const noteLabel = midiToNoteParts(slot.midi).displayFullName
      const res = resultMap.get(slot.id)
      if (settings.practiceListenMode === 'listen-then-sing') {
        list.push({
          id: `${slot.id}-demo`,
          midi: slot.midi,
          start: slot.demoStart,
          end: slot.demoEnd,
          phase: 'demo',
          label: `示范 ${noteLabel}`,
        })
      }
      list.push({
        id: slot.id,
        midi: slot.midi,
        start: slot.singStart,
        end: slot.singEnd,
        phase: 'sing',
        grade: res?.grade ?? null,
        provisionalGrade: provMap[slot.id] ?? null,
        label: noteLabel,
      })
    }
    return list
  })

  function cancelScheduledAudio() {
    for (const handle of activeHandles) {
      handle.cancel()
    }
    activeHandles = []
  }

  function clearTimers() {
    if (schedulerTimer !== null) {
      window.clearInterval(schedulerTimer)
      schedulerTimer = null
    }
    if (countdownTimer !== null) {
      window.clearTimeout(countdownTimer)
      countdownTimer = null
    }
  }

  function detachPitchListener() {
    if (unsubPitch) {
      unsubPitch()
      unsubPitch = null
    }
  }

  function attachPitchListener() {
    detachPitchListener()
    stabilizer.reset()
    unsubPitch = deps.engine.subscribe((frame) => {
      if (status.value !== 'running') return
      const relTime = frame.time - sessionOriginAudioTime
      if (relTime < -0.1) return

      const stabilized = stabilizer.process(
        {
          time: relTime,
          frequency: frame.frequency,
          clarity: frame.clarity,
          rms: frame.rms,
        },
        sessionA4Snapshot,
      )

      rawFrames.push({
        time: relTime,
        frequency: stabilized.frequency,
        clarity: stabilized.clarity,
        rms: frame.rms,
      })

      const valid = stabilized.midi !== null && stabilized.frequency !== null
      const list = samples.value
      list.push({
        time: Math.max(0, relTime),
        frequency: stabilized.frequency,
        midi: stabilized.midi,
        clarity: stabilized.clarity,
        rms: frame.rms,
      })
      if (list.length > 16000) {
        list.splice(0, list.length - 16000)
      }
      sampleVersion.value++

      // Update real-time direction hint relative to active sing target
      const slot = currentSlot.value
      if (slot && valid && relTime >= slot.singStart && relTime <= slot.singEnd) {
        const { cents } = computeCentsError(
          stabilized.frequency!,
          slot.midi,
          sessionA4Snapshot,
          settings.allowOctaveTolerance,
        )
        liveCents.value = Math.round(cents)
        if (Math.abs(cents) <= 18) liveDirection.value = 'in-tune'
        else if (cents > 18) liveDirection.value = 'sharp'
        else liveDirection.value = 'flat'
      } else if (!valid) {
        liveDirection.value = null
        liveCents.value = null
      }
    })
  }

  function startSchedulerLoop() {
    clearTimers()
    const latencySec = settings.latencyOffsetMs / 1000

    schedulerTimer = window.setInterval(() => {
      if (status.value !== 'running') return
      const nowAudio = getAudioTime()
      const sessionTime = Math.max(0, nowAudio - sessionOriginAudioTime)
      playheadTime.value = sessionTime

      // Look-ahead schedule piano demo notes (140ms lookahead)
      for (const slot of slots.value) {
        if (scheduledIds.has(slot.id)) continue
        if (slot.demoStart <= sessionTime + 0.14 && slot.demoEnd > sessionTime) {
          scheduledIds.add(slot.id)
          const audioStart = sessionOriginAudioTime + slot.demoStart
          const dur = Math.max(0.15, slot.demoEnd - slot.demoStart)
          const handle = deps.synth.scheduleNote(slot.midi, audioStart, dur, {
            velocity: settings.practiceListenMode === 'simultaneous' ? 0.55 : 0.82,
            releaseTime: 0.08,
          })
          activeHandles.push(handle)
        }
      }

      // Find current active slot & finalize completed slots
      let activeIdx = slots.value.length - 1
      let phase: 'demo' | 'gap' | 'sing' | null = null

      for (let i = 0; i < slots.value.length; i++) {
        const slot = slots.value[i]!
        if (sessionTime < slot.singEnd) {
          activeIdx = i
          if (sessionTime >= slot.singStart) {
            phase = 'sing'
          } else if (sessionTime >= slot.demoStart && sessionTime <= slot.demoEnd) {
            phase = 'demo'
          } else {
            phase = 'gap'
          }
          break
        }
      }
      currentIndex.value = Math.max(0, activeIdx)
      activePhase.value = phase

      // Provisional live grading every ~100ms
      const activeSlot = slots.value[currentIndex.value]
      if (activeSlot && phase === 'sing' && sessionTime - lastProvisionalCheck >= 0.1) {
        lastProvisionalCheck = sessionTime
        const prov = computeProvisionalGrade(
          rawFrames,
          {
            noteId: activeSlot.id,
            midi: activeSlot.midi,
            start: activeSlot.singStart,
            end: activeSlot.singEnd,
          },
          sessionTime,
          {
            a4Hz: sessionA4Snapshot,
            strictness: settings.practiceStrictness,
            allowOctaveTolerance: settings.allowOctaveTolerance,
            latencyOffsetSec: latencySec,
          },
        )
        if (prov !== provisionalGrades.value[activeSlot.id]) {
          provisionalGrades.value = {
            ...provisionalGrades.value,
            [activeSlot.id]: prov,
          }
        }
      }

      // Finalize any finished note windows
      for (const slot of slots.value) {
        if (gradedIds.has(slot.id)) continue
        if (sessionTime >= slot.singEnd + Math.max(0, latencySec) + 0.12) {
          gradedIds.add(slot.id)
          const res = gradeNote(
            rawFrames,
            {
              noteId: slot.id,
              midi: slot.midi,
              start: slot.singStart,
              end: slot.singEnd,
            },
            {
              a4Hz: sessionA4Snapshot,
              strictness: settings.practiceStrictness,
              allowOctaveTolerance: settings.allowOctaveTolerance,
              latencyOffsetSec: latencySec,
            },
          )
          results.value = [...results.value, res]
          if (res.grade === 'perfect' || res.grade === 'great') {
            combo.value++
            if (combo.value > maxCombo.value) maxCombo.value = combo.value
          } else {
            combo.value = 0
          }
          lastGradePopup.value = {
            id: ++popupCounter,
            grade: res.grade,
            midi: res.midi,
            meanCents: res.meanCents,
            combo: combo.value,
            timestamp: Date.now(),
          }
        }
      }

      // Check session completion
      const lastSlot = slots.value[slots.value.length - 1]
      if (lastSlot && gradedIds.size >= slots.value.length && sessionTime >= lastSlot.singEnd + 0.35) {
        finishSession()
      }
    }, 25)
  }

  function finishSession() {
    clearTimers()
    cancelScheduledAudio()
    detachPitchListener()
    status.value = 'finished'
    activePhase.value = null
    liveDirection.value = null
    liveCents.value = null

    if (results.value.length > 0) {
      const s = summary.value
      const minPart = midiToNoteParts(settings.practiceRangeMin).displayFullName
      const maxPart = midiToNoteParts(settings.practiceRangeMax).displayFullName
      const record: PracticeSessionRecord = {
        id: `prac-${Date.now()}`,
        mode: 'practice',
        title: activeCustomMidis ? '错音巩固练习' : `音准练习 ${minPart}–${maxPart}`,
        startedAt: Date.now(),
        score: s.score,
        maxCombo: s.maxCombo,
        counts: s.counts,
        noteCount: results.value.length,
        a4Hz: sessionA4Snapshot,
        rangeLabel: `${minPart}–${maxPart}`,
      }
      history.value = savePracticeRecord(record)
    }
  }

  async function start(customMidis?: number[]): Promise<boolean> {
    statusMessage.value = null
    cancelScheduledAudio()
    clearTimers()
    detachPitchListener()

    await ensureAudioContextRunning()
    const micOk = await deps.startMic()
    if (!micOk) {
      statusMessage.value = '需要开启麦克风才能开始音准打分练习。'
      return false
    }

    activeCustomMidis = customMidis && customMidis.length > 0 ? [...customMidis] : null
    const midis = activeCustomMidis ?? previewSequence.value
    if (midis.length === 0) return false

    const minMidi = Math.min(...midis)
    const maxMidi = Math.max(...midis)
    deps.synth.preloadRange(minMidi, maxMidi)

    sessionA4Snapshot = deps.a4Hz.value
    slots.value = buildPracticeTimeline(midis, settings.practiceSpeed, settings.practiceListenMode)
    currentIndex.value = 0
    playheadTime.value = 0
    combo.value = 0
    maxCombo.value = 0
    results.value = []
    provisionalGrades.value = {}
    lastGradePopup.value = null
    samples.value = []
    sampleVersion.value++
    rawFrames = []
    scheduledIds = new Set()
    gradedIds = new Set()
    lastProvisionalCheck = 0

    status.value = 'countdown'
    countdownValue.value = 3

    const runCountdownStep = () => {
      if (status.value !== 'countdown') return
      if (countdownValue.value <= 1) {
        sessionOriginAudioTime = getAudioTime()
        status.value = 'running'
        attachPitchListener()
        startSchedulerLoop()
        return
      }
      countdownValue.value--
      countdownTimer = window.setTimeout(runCountdownStep, 700)
    }

    countdownTimer = window.setTimeout(runCountdownStep, 700)
    return true
  }

  function pause(reason?: string) {
    if (status.value !== 'running' && status.value !== 'countdown') return
    clearTimers()
    cancelScheduledAudio()
    detachPitchListener()
    status.value = 'paused'
    activePhase.value = null
    liveDirection.value = null
    liveCents.value = null
    if (reason) {
      statusMessage.value = reason
    }
  }

  async function resume(): Promise<boolean> {
    if (status.value !== 'paused') return false
    statusMessage.value = null
    await ensureAudioContextRunning()
    const micOk = await deps.startMic()
    if (!micOk) return false

    // Restart cleanly from the beginning of the current (unfinished) note so interrupted notes aren't penalized
    const resumeIdx = Math.min(currentIndex.value, Math.max(0, slots.value.length - 1))
    const targetSlot = slots.value[resumeIdx]
    if (!targetSlot) {
      finishSession()
      return true
    }

    const resumeRelTime = Math.max(0, targetSlot.demoStart - 0.12)
    // Strip frames & schedules from this note onwards
    rawFrames = rawFrames.filter((f) => f.time < targetSlot.demoStart)
    samples.value = samples.value.filter((s) => s.time < targetSlot.demoStart)
    sampleVersion.value++

    for (let i = resumeIdx; i < slots.value.length; i++) {
      const id = slots.value[i]!.id
      scheduledIds.delete(id)
      gradedIds.delete(id)
    }
    results.value = results.value.filter((r) => gradedIds.has(r.noteId))

    sessionOriginAudioTime = getAudioTime() - resumeRelTime
    playheadTime.value = resumeRelTime
    status.value = 'running'
    attachPitchListener()
    startSchedulerLoop()
    return true
  }

  async function replayCurrentNote() {
    if (status.value !== 'running' && status.value !== 'paused') return
    pause()
    await resume()
  }

  function stop() {
    clearTimers()
    cancelScheduledAudio()
    detachPitchListener()
    status.value = 'idle'
    activePhase.value = null
    liveDirection.value = null
    liveCents.value = null
    statusMessage.value = null
  }

  function auditionNote(midi: number) {
    const now = getAudioTime() || 0
    void ensureAudioContextRunning().then(() => {
      const startAt = getAudioTime() + 0.01
      deps.synth.scheduleNote(midi, Math.max(now, startAt), 0.55, { velocity: 0.82 })
    })
  }

  function clearHistory() {
    clearPracticeHistory()
    history.value = []
  }

  function reloadHistory() {
    history.value = loadPracticeHistory()
  }

  function handleVisibilityChange() {
    if (document.hidden && (status.value === 'running' || status.value === 'countdown')) {
      pause('页面切入后台，练习已暂停。返回后点击「继续」从当前音重来。')
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    stop()
  })

  return {
    status,
    countdownValue,
    slots,
    currentIndex,
    currentSlot,
    playheadTime,
    activePhase,
    combo,
    maxCombo,
    results,
    summary,
    targetBars,
    lastGradePopup,
    history,
    statusMessage,
    liveDirection,
    liveCents,
    samples,
    sampleVersion,
    previewSequence,
    start,
    pause,
    resume,
    replayCurrentNote,
    stop,
    auditionNote,
    clearHistory,
    reloadHistory,
  }
}
