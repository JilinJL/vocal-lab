import { computed, onBeforeUnmount, onMounted, ref, shallowRef, type Ref } from 'vue'
import { midiToNoteParts, type PitchSample } from '../audio/pitchMath'
import { PitchStabilizer } from '../audio/pitchStabilizer'
import type { PianoSynthesizer, ScheduledNoteHandle } from '../audio/pianoSynth'
import { ensureAudioContextRunning, getAudioTime, getSharedAudioContext } from '../engine/audioContext'
import type { PitchEngine, PitchFrame } from '../engine/pitchEngine'
import { computeCentsError, computeProvisionalGrade, gradeNote, summarizeResults } from '../practice/grading'
import { savePracticeRecord } from '../practice/storage'
import type {
  GradeFeedbackPopup,
  NoteResult,
  PracticeGrade,
  PracticeStatus,
  TargetBar,
} from '../practice/types'
import { analyzeVocalAudioFile, type AudioAnalysisHandle } from '../songs/audioAnalyzer'
import { BUILTIN_SONGS } from '../songs/builtinSongs'
import { parseMidiArrayBuffer } from '../songs/midiImport'
import {
  deleteStoredSong,
  listStoredSongs,
  loadSongAudioBlob,
  saveStoredSong,
} from '../songs/songStorage'
import type { ImportedSong, SongNote } from '../songs/types'
import { useSettings } from './useSettings'

export interface SongPracticeDeps {
  engine: PitchEngine
  startMic: () => Promise<boolean>
  synth: PianoSynthesizer
  a4Hz: Ref<number>
}

export function useSongPractice(deps: SongPracticeDeps) {
  const settings = useSettings()

  const songs = ref<ImportedSong[]>([...BUILTIN_SONGS])
  const selectedSongId = ref<string>(BUILTIN_SONGS[0]!.id)
  const transposeSemitones = ref(0)
  const tempoRate = ref(1.0)
  const muteGuideMelody = ref(false)
  const playBackingAudio = ref(false)
  const loopEnabled = ref(false)
  const loopStart = ref(0)
  const loopEnd = ref(10)

  const isImporting = ref(false)
  const importProgress = ref(0)
  const importError = ref<string | null>(null)

  const status = ref<PracticeStatus>('idle')
  const isPreviewOnly = ref(false)
  const countdownValue = ref(3)
  const playheadTime = ref(0)
  const combo = ref(0)
  const maxCombo = ref(0)
  const results = ref<NoteResult[]>([])
  const provisionalGrades = ref<Record<string, PracticeGrade | null>>({})
  const lastGradePopup = ref<GradeFeedbackPopup | null>(null)
  const statusMessage = ref<string | null>(null)
  const liveDirection = ref<'in-tune' | 'sharp' | 'flat' | null>(null)
  const liveCents = ref<number | null>(null)

  const samples = shallowRef<PitchSample[]>([])
  const sampleVersion = ref(0)

  const audioBufferCache = new Map<string, AudioBuffer>()
  let activeImportHandle: AudioAnalysisHandle | null = null
  let rawFrames: PitchFrame[] = []
  let sessionOriginAudioTime = 0
  let activeBackingSource: AudioBufferSourceNode | null = null
  let activeHandles: ScheduledNoteHandle[] = []
  let scheduledIds = new Set<string>()
  let gradedIds = new Set<string>()
  let schedulerTimer: number | null = null
  let countdownTimer: number | null = null
  let unsubPitch: (() => void) | null = null
  let popupCounter = 0
  let lastProvisionalCheck = 0
  let sessionA4Snapshot = 440
  const stabilizer = new PitchStabilizer()

  const selectedSong = computed<ImportedSong>(() => {
    return songs.value.find((s) => s.id === selectedSongId.value) ?? songs.value[0]!
  })

  /** Notes scaled by tempoRate and shifted by transposeSemitones (session timeline seconds) */
  const scaledNotes = computed<SongNote[]>(() => {
    const song = selectedSong.value
    if (!song) return []
    const rate = Math.max(0.5, Math.min(1.5, tempoRate.value))
    const shift = transposeSemitones.value
    const startBound = loopEnabled.value ? loopStart.value : 0
    const endBound = loopEnabled.value ? Math.max(loopStart.value + 1, loopEnd.value) : song.duration + 1

    return song.notes
      .filter((n) => n.start + n.duration > startBound && n.start < endBound)
      .map((n) => {
        const clampedStart = Math.max(startBound, n.start)
        const clampedEnd = Math.min(endBound, n.start + n.duration)
        return {
          id: n.id,
          start: (clampedStart - startBound) / rate,
          duration: Math.max(0.08, (clampedEnd - clampedStart) / rate),
          midi: Math.max(36, Math.min(84, n.midi + shift)),
        }
      })
  })

  const scaledDuration = computed(() => {
    const song = selectedSong.value
    if (!song) return 0
    const rate = Math.max(0.5, Math.min(1.5, tempoRate.value))
    if (loopEnabled.value) {
      return Math.max(1, (loopEnd.value - loopStart.value) / rate)
    }
    return Math.max(1, song.duration / rate)
  })

  const currentNote = computed<SongNote | null>(() => {
    const t = playheadTime.value
    for (const note of scaledNotes.value) {
      if (t >= note.start && t <= note.start + note.duration) {
        return note
      }
      if (note.start > t) {
        return note
      }
    }
    return null
  })

  const summary = computed(() => summarizeResults(results.value))

  const targetBars = computed<TargetBar[]>(() => {
    const resMap = new Map(results.value.map((r) => [r.noteId, r]))
    const provMap = provisionalGrades.value
    return scaledNotes.value.map((note) => ({
      id: note.id,
      midi: note.midi,
      start: note.start,
      end: note.start + note.duration,
      phase: 'sing',
      grade: resMap.get(note.id)?.grade ?? null,
      provisionalGrade: provMap[note.id] ?? null,
      label: midiToNoteParts(note.midi).displayFullName,
    }))
  })

  async function refreshLibrary() {
    const stored = await listStoredSongs()
    songs.value = [...stored, ...BUILTIN_SONGS]
    if (!songs.value.some((s) => s.id === selectedSongId.value)) {
      selectedSongId.value = songs.value[0]!.id
    }
    syncLoopBounds()
  }

  function syncLoopBounds() {
    const song = selectedSong.value
    if (!song) return
    loopStart.value = 0
    loopEnd.value = Math.max(1, Math.round(song.duration * 10) / 10)
  }

  function selectSong(id: string) {
    stop()
    selectedSongId.value = id
    transposeSemitones.value = 0
    loopEnabled.value = false
    syncLoopBounds()
    playBackingAudio.value = !!selectedSong.value?.hasBackingAudio
  }

  function selectMidiTrack(trackIndex: number) {
    const song = selectedSong.value
    if (!song || !song.tracks) return
    const found = song.tracks.find((t) => t.index === trackIndex)
    if (!found) return
    stop()
    song.selectedTrackIndex = found.index
    song.notes = found.notes
    const last = found.notes[found.notes.length - 1]
    if (last) {
      song.duration = Math.max(1, last.start + last.duration + 0.4)
    }
    syncLoopBounds()
    if (song.sourceType === 'midi') {
      void saveStoredSong(JSON.parse(JSON.stringify(song)) as ImportedSong).catch(() => {})
    }
  }

  async function importFile(file: File): Promise<boolean> {
    importError.value = null
    stop()

    const lower = file.name.toLowerCase()
    if (lower.endsWith('.mid') || lower.endsWith('.midi')) {
      isImporting.value = true
      importProgress.value = 30
      try {
        const buf = await file.arrayBuffer()
        const song = parseMidiArrayBuffer(buf, file.name)
        await saveStoredSong(song).catch(() => {})
        songs.value = [song, ...songs.value]
        selectSong(song.id)
        importProgress.value = 100
        return true
      } catch (err) {
        importError.value = err instanceof Error ? err.message : 'MIDI 解析失败，请检查文件是否损坏。'
        return false
      } finally {
        isImporting.value = false
      }
    }

    if (/\.(wav|mp3|m4a|aac|ogg|flac)$/i.test(lower)) {
      isImporting.value = true
      importProgress.value = 5
      const handle = analyzeVocalAudioFile(file, deps.a4Hz.value, (pct) => {
        importProgress.value = pct
      })
      activeImportHandle = handle
      try {
        const { song, audioBuffer } = await handle.promise
        audioBufferCache.set(song.id, audioBuffer)
        await saveStoredSong(song, file).catch(() => {})
        songs.value = [song, ...songs.value]
        selectSong(song.id)
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : '音频导入失败'
        if (msg !== '已取消导入') {
          importError.value = msg
        }
        return false
      } finally {
        activeImportHandle = null
        isImporting.value = false
      }
    }

    importError.value = '暂仅支持导入 .mid MIDI 文件或 .wav / .mp3 / .m4a 单人清唱音频。'
    return false
  }

  function cancelImport() {
    activeImportHandle?.cancel()
    activeImportHandle = null
    isImporting.value = false
  }

  async function removeSong(id: string) {
    if (id.startsWith('builtin-')) return
    stop()
    await deleteStoredSong(id)
    audioBufferCache.delete(id)
    songs.value = songs.value.filter((s) => s.id !== id)
    if (selectedSongId.value === id) {
      selectedSongId.value = songs.value[0]!.id
      syncLoopBounds()
    }
  }

  function stopBackingAudio() {
    if (activeBackingSource) {
      try {
        activeBackingSource.stop()
        activeBackingSource.disconnect()
      } catch {
        // ignore
      }
      activeBackingSource = null
    }
  }

  function cancelScheduledAudio() {
    stopBackingAudio()
    for (const h of activeHandles) {
      h.cancel()
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

  async function resolveBackingBuffer(song: ImportedSong): Promise<AudioBuffer | null> {
    if (!song.hasBackingAudio) return null
    const cached = audioBufferCache.get(song.id)
    if (cached) return cached
    const blob = await loadSongAudioBlob(song.id)
    if (!blob) return null
    const ctx = getSharedAudioContext()
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    audioBufferCache.set(song.id, decoded)
    return decoded
  }

  function attachPitchListener() {
    detachPitchListener()
    stabilizer.reset()
    unsubPitch = deps.engine.subscribe((frame) => {
      if (status.value !== 'running' || isPreviewOnly.value) return
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
      if (list.length > 18000) {
        list.splice(0, list.length - 18000)
      }
      sampleVersion.value++

      const target = currentNote.value
      if (target && valid && relTime >= target.start && relTime <= target.start + target.duration) {
        const { cents } = computeCentsError(
          stabilized.frequency!,
          target.midi,
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

  async function startPlayback(previewMode: boolean, offsetSec = 0): Promise<boolean> {
    statusMessage.value = null
    cancelScheduledAudio()
    clearTimers()
    detachPitchListener()

    const song = selectedSong.value
    const notes = scaledNotes.value
    if (!song || notes.length === 0) {
      statusMessage.value = '当前片段没有可跟唱的音符，请调整循环范围或选择其他歌曲。'
      return false
    }

    await ensureAudioContextRunning()
    if (!previewMode) {
      const micOk = await deps.startMic()
      if (!micOk) {
        statusMessage.value = '需要开启麦克风才能进行歌曲跟唱打分。'
        return false
      }
    }

    isPreviewOnly.value = previewMode
    sessionA4Snapshot = deps.a4Hz.value
    const minMidi = Math.min(...notes.map((n) => n.midi))
    const maxMidi = Math.max(...notes.map((n) => n.midi))
    deps.synth.preloadRange(minMidi, maxMidi)

    const backingBuf =
      playBackingAudio.value && song.hasBackingAudio && transposeSemitones.value === 0
        ? await resolveBackingBuffer(song)
        : null

    if (offsetSec === 0) {
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
    }

    const beginNow = () => {
      sessionOriginAudioTime = getAudioTime() - offsetSec
      status.value = 'running'
      lastProvisionalCheck = offsetSec

      if (backingBuf) {
        const ctx = getSharedAudioContext()
        const src = ctx.createBufferSource()
        src.buffer = backingBuf
        src.playbackRate.setValueAtTime(tempoRate.value, ctx.currentTime)
        const gain = ctx.createGain()
        gain.gain.value = 0.65
        src.connect(gain)
        gain.connect(ctx.destination)
        const songOffset = (loopEnabled.value ? loopStart.value : 0) + offsetSec * tempoRate.value
        const playDur = Math.max(0.1, (scaledDuration.value - offsetSec) * tempoRate.value)
        src.start(ctx.currentTime + 0.01, songOffset, playDur)
        activeBackingSource = src
      }

      if (!previewMode) {
        attachPitchListener()
      }
      startSchedulerLoop(backingBuf)
    }

    if (previewMode || offsetSec > 0) {
      beginNow()
      return true
    }

    status.value = 'countdown'
    countdownValue.value = 3
    const tickCountdown = () => {
      if (status.value !== 'countdown') return
      if (countdownValue.value <= 1) {
        beginNow()
        return
      }
      countdownValue.value--
      countdownTimer = window.setTimeout(tickCountdown, 650)
    }
    countdownTimer = window.setTimeout(tickCountdown, 650)
    return true
  }

  function startSchedulerLoop(backingBuf: AudioBuffer | null) {
    clearTimers()
    const latencySec = settings.latencyOffsetMs / 1000

    schedulerTimer = window.setInterval(() => {
      if (status.value !== 'running') return
      const sessionTime = Math.max(0, getAudioTime() - sessionOriginAudioTime)
      playheadTime.value = sessionTime

      const notes = scaledNotes.value
      const shouldPlayGuide = !muteGuideMelody.value && !backingBuf

      if (shouldPlayGuide) {
        for (const note of notes) {
          if (scheduledIds.has(note.id)) continue
          if (note.start <= sessionTime + 0.16 && note.start + note.duration > sessionTime) {
            scheduledIds.add(note.id)
            const audioStart = sessionOriginAudioTime + note.start
            const handle = deps.synth.scheduleNote(note.midi, audioStart, note.duration, {
              velocity: isPreviewOnly.value ? 0.8 : 0.52,
              releaseTime: 0.06,
            })
            activeHandles.push(handle)
          }
        }
      }

      if (!isPreviewOnly.value) {
        // Provisional grade on current note
        const active = currentNote.value
        if (active && sessionTime >= active.start && sessionTime <= active.start + active.duration) {
          if (sessionTime - lastProvisionalCheck >= 0.1) {
            lastProvisionalCheck = sessionTime
            const prov = computeProvisionalGrade(
              rawFrames,
              {
                noteId: active.id,
                midi: active.midi,
                start: active.start,
                end: active.start + active.duration,
                onsetGraceSec: Math.min(0.08, active.duration * 0.2),
              },
              sessionTime,
              {
                a4Hz: sessionA4Snapshot,
                strictness: settings.practiceStrictness,
                allowOctaveTolerance: settings.allowOctaveTolerance,
                latencyOffsetSec: latencySec,
              },
            )
            if (prov !== provisionalGrades.value[active.id]) {
              provisionalGrades.value = { ...provisionalGrades.value, [active.id]: prov }
            }
          }
        }

        // Finalize finished notes
        for (const note of notes) {
          if (gradedIds.has(note.id)) continue
          const noteEnd = note.start + note.duration
          if (sessionTime >= noteEnd + Math.max(0, latencySec) + 0.12) {
            gradedIds.add(note.id)
            const res = gradeNote(
              rawFrames,
              {
                noteId: note.id,
                midi: note.midi,
                start: note.start,
                end: noteEnd,
                onsetGraceSec: Math.min(0.08, note.duration * 0.2),
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
      }

      // End of song or loop cycle
      if (sessionTime >= scaledDuration.value + 0.25) {
        if (loopEnabled.value) {
          // Seamless A-B loop restart
          void startPlayback(isPreviewOnly.value, 0)
        } else if (isPreviewOnly.value) {
          stop()
        } else {
          finishSongSession()
        }
      }
    }, 25)
  }

  function finishSongSession() {
    clearTimers()
    cancelScheduledAudio()
    detachPitchListener()
    status.value = 'finished'
    liveDirection.value = null
    liveCents.value = null

    if (results.value.length > 0 && selectedSong.value) {
      const s = summary.value
      savePracticeRecord({
        id: `song-${Date.now()}`,
        mode: 'song',
        title: selectedSong.value.title,
        startedAt: Date.now(),
        score: s.score,
        maxCombo: s.maxCombo,
        counts: s.counts,
        noteCount: results.value.length,
        a4Hz: sessionA4Snapshot,
        rangeLabel:
          transposeSemitones.value === 0
            ? '原调'
            : `${transposeSemitones.value > 0 ? '+' : ''}${transposeSemitones.value} 半音`,
      })
    }
  }

  function pause(reason?: string) {
    if (status.value !== 'running' && status.value !== 'countdown') return
    clearTimers()
    cancelScheduledAudio()
    detachPitchListener()
    status.value = 'paused'
    liveDirection.value = null
    liveCents.value = null
    if (reason) statusMessage.value = reason
  }

  async function resume(): Promise<boolean> {
    if (status.value !== 'paused') return false
    const resumeAt = Math.max(0, playheadTime.value - 0.15)
    const notes = scaledNotes.value
    for (const note of notes) {
      if (note.start + note.duration > resumeAt) {
        scheduledIds.delete(note.id)
        gradedIds.delete(note.id)
      }
    }
    results.value = results.value.filter((r) => gradedIds.has(r.noteId))
    return startPlayback(isPreviewOnly.value, resumeAt)
  }

  function stop() {
    clearTimers()
    cancelScheduledAudio()
    detachPitchListener()
    status.value = 'idle'
    isPreviewOnly.value = false
    liveDirection.value = null
    liveCents.value = null
    statusMessage.value = null
  }

  function handleVisibilityChange() {
    if (document.hidden && (status.value === 'running' || status.value === 'countdown')) {
      pause('页面切入后台，跟唱已暂停。返回后可点击「继续」。')
    }
  }

  onMounted(() => {
    void refreshLibrary()
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    cancelImport()
    stop()
  })

  return {
    songs,
    selectedSongId,
    selectedSong,
    scaledNotes,
    scaledDuration,
    currentNote,
    transposeSemitones,
    tempoRate,
    muteGuideMelody,
    playBackingAudio,
    loopEnabled,
    loopStart,
    loopEnd,
    isImporting,
    importProgress,
    importError,
    status,
    isPreviewOnly,
    countdownValue,
    playheadTime,
    combo,
    maxCombo,
    results,
    summary,
    targetBars,
    lastGradePopup,
    statusMessage,
    liveDirection,
    liveCents,
    samples,
    sampleVersion,
    selectSong,
    selectMidiTrack,
    importFile,
    cancelImport,
    removeSong,
    previewMelody: () => startPlayback(true, 0),
    startSingAlong: () => startPlayback(false, 0),
    pause,
    resume,
    stop,
  }
}
