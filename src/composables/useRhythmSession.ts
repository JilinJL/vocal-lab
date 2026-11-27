import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ensureAudioContextRunning, getAudioTime, getSharedAudioContext } from '../engine/audioContext'
import { isNativeAudioActive } from '../engine/nativeAudioPlugin'
import { DrumSynthesizer } from '../rhythm/drumSynth'
import {
  BASIC_BEAT_PRESETS,
  computeSwingOffsetSec,
  findGrooveById,
  getGrooveCellCount,
  getMeterSpec,
  GROOVE_PRESETS,
  grooveToPatternData,
  RHYTHM_GAME_CHALLENGES,
} from '../rhythm/grooves'
import {
  clearRhythmHistory,
  DEFAULT_TIMING_WINDOWS,
  judgeTimingOffset,
  loadRhythmHistory,
  saveRhythmRecord,
  summarizeRhythmResults,
} from '../rhythm/scoring'
import type {
  BasicBeatPreset,
  DrumLayer,
  GrooveCategory,
  GroovePatternData,
  GroovePreset,
  MeterId,
  RhythmGameChallenge,
  RhythmGameRecord,
  RhythmGameStatus,
  RhythmGameSummary,
  RhythmGameTargetMode,
  RhythmGradePopup,
  RhythmHitResult,
  RhythmHitTarget,
  RhythmSubView,
  VelocityLevel,
} from '../rhythm/types'
import { triggerHaptic } from '../utils/haptics'
import { useSettings } from './useSettings'

interface VisualTickEvent {
  tick: number
  time: number
}

const LOOKAHEAD_MS = 25
const SCHEDULE_AHEAD_SEC = 0.14

export function useRhythmSession() {
  const settings = useSettings()
  const synth = new DrumSynthesizer()

  const subView = ref<RhythmSubView>('groove')
  const bpm = ref(80)
  const pulseOnly = ref(false)
  const swing = ref(0.5)

  // Basic beat state
  const basicMeter = ref<MeterId>('4/4')
  const basicSub = ref<1 | 2 | 3 | 4>(2)
  const activeBasicPresetId = ref<string>(BASIC_BEAT_PRESETS[0]!.id)

  // Groove sequencer state
  const grooveMeter = ref<MeterId>('4/4')
  const activeCategory = ref<GrooveCategory>('流行')
  const activeGrooveId = ref<string>(GROOVE_PRESETS[0]!.id)
  const pattern = reactive<GroovePatternData>(grooveToPatternData(GROOVE_PRESETS[0]!))

  // Playback state (shared for beat & groove)
  const isPlaying = ref(false)
  const currentStep = ref(-1)
  const currentBeat = ref(0)
  const currentSubPos = ref(0)
  const currentBar = ref(0)

  // Rhythm game state
  const selectedChallengeId = ref<string>(RHYTHM_GAME_CHALLENGES[0]!.id)
  const gameTargetMode = ref<RhythmGameTargetMode>('beat')
  const gameBars = ref(4)
  const gameBlindBars = ref(false)
  const gameStatus = ref<RhythmGameStatus>('idle')
  const gameCountdown = ref<number | null>(null)
  const gameTargets = ref<RhythmHitTarget[]>([])
  const gameResults = ref<RhythmHitResult[]>([])
  const gameCombo = ref(0)
  const gameMaxCombo = ref(0)
  const gamePopup = ref<RhythmGradePopup | null>(null)
  const gamePlayheadSec = ref(0)
  const gameStartSec = ref(0)
  const gameEndSec = ref(0)
  const gameInBlindBar = ref(false)
  const gameHistory = ref<RhythmGameRecord[]>(loadRhythmHistory())
  const lastTapFlashAt = ref(0)

  let schedulerTimer: number | null = null
  let rafId: number | null = null
  let tickCounter = 0
  let nextTickTime = 0
  let visualQueue: VisualTickEvent[] = []
  let popupCounter = 0
  let tapTimes: number[] = []
  let gameTotalTicks = 0
  let gameCountInTicks = 0

  const activeGroove = computed<GroovePreset>(() => findGrooveById(activeGrooveId.value))
  const activeBasicPreset = computed<BasicBeatPreset>(
    () => BASIC_BEAT_PRESETS.find((p) => p.id === activeBasicPresetId.value) ?? BASIC_BEAT_PRESETS[0]!,
  )
  const activeChallenge = computed<RhythmGameChallenge>(
    () =>
      RHYTHM_GAME_CHALLENGES.find((c) => c.id === selectedChallengeId.value) ??
      RHYTHM_GAME_CHALLENGES[0]!,
  )

  const activeMeter = computed<MeterId>(() =>
    subView.value === 'beat' ? basicMeter.value : grooveMeter.value,
  )
  const activeMeterSpec = computed(() => getMeterSpec(activeMeter.value))
  const activeSubdivision = computed(() =>
    subView.value === 'beat' ? basicSub.value : activeMeterSpec.value.grooveSub,
  )
  const ticksPerBar = computed(() => activeMeterSpec.value.beats * activeSubdivision.value)

  const grooveStats = computed(() => {
    const spec = getMeterSpec(grooveMeter.value)
    const counts = { heavy: 0, medium: 0, light: 0, total: 0 }
    const layers: DrumLayer[] = ['kick', 'snare', 'hat', 'fill']
    for (const layer of layers) {
      for (const v of pattern[layer]) {
        if (v === 1) {
          counts.heavy++
          counts.total++
        } else if (v === 2) {
          counts.medium++
          counts.total++
        } else if (v === 3) {
          counts.light++
          counts.total++
        }
      }
    }
    return {
      beats: spec.beats,
      strong: spec.pulse.filter((p) => p === 3).length,
      mediumBeat: spec.pulse.filter((p) => p === 2).length,
      weak: spec.pulse.filter((p) => p === 1).length,
      ...counts,
    }
  })

  const gameSummary = computed<RhythmGameSummary>(() =>
    summarizeRhythmResults(gameResults.value, gameTargets.value.length, gameMaxCombo.value),
  )

  const isActive = computed(
    () =>
      isPlaying.value || gameStatus.value === 'countdown' || gameStatus.value === 'running',
  )

  watch(
    () => settings.volume,
    (vol) => {
      synth.setVolume(Math.max(0.25, Math.min(1.15, vol * 1.1)))
    },
    { immediate: true },
  )

  function getOutputLatencySec(): number {
    if (isNativeAudioActive()) return 0
    try {
      const ctx = getSharedAudioContext() as AudioContext & {
        outputLatency?: number
        baseLatency?: number
      }
      const lat = ctx.outputLatency || ctx.baseLatency || 0
      return Math.max(0, Math.min(0.15, lat))
    } catch {
      return 0
    }
  }

  function tickDurationSec(): number {
    return 60 / bpm.value / activeSubdivision.value
  }

  function setBpm(next: number): void {
    bpm.value = Math.max(40, Math.min(200, Math.round(next)))
  }

  function stepBpm(delta: number): void {
    setBpm(bpm.value + delta)
  }

  function tapTempo(): void {
    const now = performance.now()
    tapTimes = tapTimes.filter((t) => now - t < 2000)
    tapTimes.push(now)
    triggerHaptic(8)
    if (tapTimes.length >= 2) {
      const span = tapTimes[tapTimes.length - 1]! - tapTimes[0]!
      if (span > 0) {
        setBpm(60000 / (span / (tapTimes.length - 1)))
      }
    }
  }

  function setSubView(next: RhythmSubView): void {
    if (subView.value === next) return
    stopAll()
    subView.value = next
    if (next === 'game') {
      syncChallengeToGroove(activeChallenge.value)
    }
  }

  function selectBasicPreset(presetId: string): void {
    const found = BASIC_BEAT_PRESETS.find((p) => p.id === presetId)
    if (!found) return
    activeBasicPresetId.value = found.id
    basicMeter.value = found.meter
    basicSub.value = found.subdivision
    setBpm(found.bpm)
    if (isPlaying.value) {
      resetPlaybackClock()
    }
  }

  function setBasicMeter(meter: MeterId): void {
    basicMeter.value = meter
    if (isPlaying.value) resetPlaybackClock()
  }

  function setBasicSub(sub: 1 | 2 | 3 | 4): void {
    basicSub.value = sub
    if (isPlaying.value) resetPlaybackClock()
  }

  function setGrooveMeter(meter: MeterId): void {
    if (grooveMeter.value === meter) return
    const wasPlaying = isPlaying.value
    if (wasPlaying) stopAll()
    grooveMeter.value = meter
    const n = getGrooveCellCount(meter)
    pattern.kick = new Array<VelocityLevel>(n).fill(0)
    pattern.snare = new Array<VelocityLevel>(n).fill(0)
    pattern.hat = new Array<VelocityLevel>(n).fill(0)
    pattern.fill = new Array<VelocityLevel>(n).fill(0)
    if (wasPlaying) void startPlayback()
  }

  function loadGroove(grooveId: string, options?: { keepBpm?: boolean }): void {
    const preset = findGrooveById(grooveId)
    const wasPlaying = isPlaying.value && subView.value !== 'game'
    if (wasPlaying) stopAll()
    activeGrooveId.value = preset.id
    activeCategory.value = preset.category
    grooveMeter.value = preset.meter
    swing.value = preset.swing
    if (!options?.keepBpm) {
      setBpm(preset.bpm)
    }
    const nextData = grooveToPatternData(preset)
    pattern.kick = nextData.kick
    pattern.snare = nextData.snare
    pattern.hat = nextData.hat
    pattern.fill = nextData.fill
    if (wasPlaying) void startPlayback()
  }

  function cycleCell(layer: DrumLayer, index: number): void {
    if (pulseOnly.value) return
    const arr = pattern[layer]
    if (index < 0 || index >= arr.length) return
    const cur = arr[index] ?? 0
    const next: VelocityLevel = cur === 0 ? 1 : cur === 1 ? 2 : cur === 2 ? 3 : 0
    arr[index] = next
    triggerHaptic(6)
    if (next > 0 && !isPlaying.value) {
      void ensureAudioContextRunning().then(() => {
        synth.scheduleHit(layer, getAudioTime() + 0.008, next, 0.9)
      })
    }
  }

  function syncChallengeToGroove(challenge: RhythmGameChallenge): void {
    selectedChallengeId.value = challenge.id
    gameTargetMode.value = challenge.targetMode
    gameBars.value = challenge.bars
    gameBlindBars.value = challenge.blindBars
    loadGroove(challenge.grooveId, { keepBpm: false })
    setBpm(challenge.bpm)
  }

  function selectChallenge(challengeId: string): void {
    const ch = RHYTHM_GAME_CHALLENGES.find((c) => c.id === challengeId)
    if (!ch) return
    stopAll()
    syncChallengeToGroove(ch)
  }

  function cycleActivePreset(delta: number): void {
    if (subView.value === 'beat') {
      const idx = BASIC_BEAT_PRESETS.findIndex((p) => p.id === activeBasicPresetId.value)
      const nextIdx = (Math.max(0, idx) + delta + BASIC_BEAT_PRESETS.length) % BASIC_BEAT_PRESETS.length
      selectBasicPreset(BASIC_BEAT_PRESETS[nextIdx]!.id)
      return
    }
    if (subView.value === 'game') {
      const idx = RHYTHM_GAME_CHALLENGES.findIndex((c) => c.id === selectedChallengeId.value)
      const nextIdx =
        (Math.max(0, idx) + delta + RHYTHM_GAME_CHALLENGES.length) % RHYTHM_GAME_CHALLENGES.length
      selectChallenge(RHYTHM_GAME_CHALLENGES[nextIdx]!.id)
      return
    }
    const idx = GROOVE_PRESETS.findIndex((g) => g.id === activeGrooveId.value)
    const nextIdx = (Math.max(0, idx) + delta + GROOVE_PRESETS.length) % GROOVE_PRESETS.length
    loadGroove(GROOVE_PRESETS[nextIdx]!.id)
  }

  function clearTimers(): void {
    if (schedulerTimer !== null) {
      window.clearInterval(schedulerTimer)
      schedulerTimer = null
    }
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function resetPlaybackClock(): void {
    tickCounter = 0
    visualQueue = []
    if (isPlaying.value) {
      nextTickTime = getAudioTime() + 0.05
    }
  }

  function scheduleMetronomeOrGrooveTick(tick: number, baseTime: number): void {
    const tpb = ticksPerBar.value
    const pos = tick % tpb
    const spec = activeMeterSpec.value
    const sub = activeSubdivision.value
    const isBeat = pos % sub === 0
    const beatIdx = Math.floor(pos / sub)
    const pulseAccent = spec.pulse[beatIdx] ?? 1
    const time = baseTime + computeSwingOffsetSec(pos, sub, bpm.value, swing.value)

    if (subView.value === 'beat') {
      if (isBeat) {
        synth.scheduleHit('pulse', time, pulseAccent, 1.0)
      } else {
        synth.scheduleHit('sub', time, 2, 0.85)
      }
    } else {
      if (isBeat) {
        synth.scheduleHit('pulse', time, pulseAccent, pulseOnly.value ? 1.05 : 0.72)
      }
      if (!pulseOnly.value) {
        const k = pattern.kick[pos] ?? 0
        const s = pattern.snare[pos] ?? 0
        const h = pattern.hat[pos] ?? 0
        const f = pattern.fill[pos] ?? 0
        if (k) synth.scheduleHit('kick', time, k, 1.0)
        if (s) synth.scheduleHit('snare', time, s, 1.0)
        if (h) synth.scheduleHit('hat', time, h, 0.92)
        if (f) synth.scheduleHit('fill', time, f, 0.95)
      }
    }

    visualQueue.push({ tick, time })
  }

  function runFreeScheduler(): void {
    if (!isPlaying.value) return
    const now = getAudioTime()
    const d = tickDurationSec()

    if (nextTickTime < now - 0.06) {
      const skip = Math.ceil((now + 0.05 - nextTickTime) / d)
      nextTickTime += skip * d
      tickCounter += skip
      visualQueue.length = 0
    }

    while (nextTickTime < now + SCHEDULE_AHEAD_SEC) {
      scheduleMetronomeOrGrooveTick(tickCounter, nextTickTime)
      nextTickTime += d
      tickCounter++
    }
  }

  function runFreeVisualLoop(): void {
    if (!isPlaying.value) return
    const heard = getAudioTime() - getOutputLatencySec()
    let latest: VisualTickEvent | null = null
    while (visualQueue.length > 0 && visualQueue[0]!.time <= heard) {
      latest = visualQueue.shift() ?? null
    }
    if (latest) {
      const tpb = ticksPerBar.value
      const pos = latest.tick % tpb
      const sub = activeSubdivision.value
      currentStep.value = pos
      currentBeat.value = Math.floor(pos / sub)
      currentSubPos.value = pos % sub
      currentBar.value = Math.floor(latest.tick / tpb)
    }
    rafId = window.requestAnimationFrame(runFreeVisualLoop)
  }

  async function startPlayback(): Promise<void> {
    if (subView.value === 'game') {
      await startGame()
      return
    }
    stopAll()
    await ensureAudioContextRunning()
    isPlaying.value = true
    tickCounter = 0
    visualQueue = []
    nextTickTime = getAudioTime() + 0.06
    schedulerTimer = window.setInterval(runFreeScheduler, LOOKAHEAD_MS)
    runFreeScheduler()
    rafId = window.requestAnimationFrame(runFreeVisualLoop)
  }

  function togglePlayback(): void {
    if (subView.value === 'game') {
      if (gameStatus.value === 'running' || gameStatus.value === 'countdown') {
        stopAll()
      } else {
        void startGame()
      }
      return
    }
    if (isPlaying.value) {
      stopAll()
    } else {
      void startPlayback()
    }
  }

  function isBarBlind(barIndex: number): boolean {
    if (!gameBlindBars.value) return false
    // 2 audible bars, then 2 blind bars repeating
    return barIndex % 4 >= 2
  }

  function buildGameTargets(startClockSec: number): RhythmHitTarget[] {
    const spec = getMeterSpec(grooveMeter.value)
    const sub = spec.grooveSub
    const tpb = spec.beats * sub
    const stepDur = 60 / bpm.value / sub
    const targets: RhythmHitTarget[] = []
    let id = 1

    for (let bar = 0; bar < gameBars.value; bar++) {
      const blind = isBarBlind(bar)
      for (let pos = 0; pos < tpb; pos++) {
        const isBeat = pos % sub === 0
        const beatIdx = Math.floor(pos / sub)
        const kickVel = pattern.kick[pos] ?? 0
        const snareVel = pattern.snare[pos] ?? 0
        const swingOff = computeSwingOffsetSec(pos, sub, bpm.value, swing.value)
        const expectedTime = startClockSec + (bar * tpb + pos) * stepDur + swingOff

        if (gameTargetMode.value === 'beat') {
          if (isBeat) {
            targets.push({
              id: id++,
              barIndex: bar,
              stepIndex: pos,
              expectedTime,
              layer: 'beat',
              accent: spec.pulse[beatIdx] ?? 1,
              blind,
              judged: false,
            })
          }
        } else if (gameTargetMode.value === 'kick') {
          if (kickVel > 0) {
            targets.push({
              id: id++,
              barIndex: bar,
              stepIndex: pos,
              expectedTime,
              layer: 'kick',
              accent: kickVel === 1 ? 3 : kickVel === 2 ? 2 : 1,
              blind,
              judged: false,
            })
          }
        } else if (gameTargetMode.value === 'snare') {
          if (snareVel > 0) {
            targets.push({
              id: id++,
              barIndex: bar,
              stepIndex: pos,
              expectedTime,
              layer: 'snare',
              accent: snareVel === 1 ? 3 : snareVel === 2 ? 2 : 1,
              blind,
              judged: false,
            })
          }
        } else {
          // backbone: kick + snare (if both fall on same step, single combined target)
          if (snareVel > 0) {
            targets.push({
              id: id++,
              barIndex: bar,
              stepIndex: pos,
              expectedTime,
              layer: 'snare',
              accent: snareVel === 1 ? 3 : snareVel === 2 ? 2 : 1,
              blind,
              judged: false,
            })
          } else if (kickVel > 0) {
            targets.push({
              id: id++,
              barIndex: bar,
              stepIndex: pos,
              expectedTime,
              layer: 'kick',
              accent: kickVel === 1 ? 3 : kickVel === 2 ? 2 : 1,
              blind,
              judged: false,
            })
          }
        }
      }
    }

    // Fallback if user cleared the selected layer so the game always has beats
    if (targets.length === 0) {
      for (let bar = 0; bar < gameBars.value; bar++) {
        for (let b = 0; b < spec.beats; b++) {
          const expectedTime = startClockSec + (bar * spec.beats + b) * (60 / bpm.value)
          targets.push({
            id: id++,
            barIndex: bar,
            stepIndex: b * sub,
            expectedTime,
            layer: 'beat',
            accent: spec.pulse[b] ?? 1,
            blind: isBarBlind(bar),
            judged: false,
          })
        }
      }
    }

    return targets
  }

  function scheduleGameTick(tick: number, baseTime: number): void {
    const spec = getMeterSpec(grooveMeter.value)
    const sub = spec.grooveSub
    const tpb = spec.beats * sub
    const pos = tick % tpb
    const isBeat = pos % sub === 0
    const beatIdx = Math.floor(pos / sub)
    const pulseAccent = spec.pulse[beatIdx] ?? 1
    const time = baseTime + computeSwingOffsetSec(pos, sub, bpm.value, swing.value)

    if (tick < gameCountInTicks) {
      // Count-in bar: crisp metronome pulse only
      if (isBeat) {
        synth.scheduleHit('pulse', time, pulseAccent, 1.05)
      }
      return
    }

    const gameTick = tick - gameCountInTicks
    const barIdx = Math.floor(gameTick / tpb)
    if (barIdx >= gameBars.value) return

    const blind = isBarBlind(barIdx)
    if (blind) {
      // Silent drums & pulse in blind bars!
      return
    }

    if (isBeat) {
      synth.scheduleHit('pulse', time, pulseAccent, pulseOnly.value ? 1.0 : 0.65)
    }
    if (!pulseOnly.value) {
      const k = pattern.kick[pos] ?? 0
      const s = pattern.snare[pos] ?? 0
      const h = pattern.hat[pos] ?? 0
      const f = pattern.fill[pos] ?? 0
      if (k) synth.scheduleHit('kick', time, k, 0.95)
      if (s) synth.scheduleHit('snare', time, s, 0.95)
      if (h) synth.scheduleHit('hat', time, h, 0.85)
      if (f) synth.scheduleHit('fill', time, f, 0.9)
    }
  }

  function runGameScheduler(): void {
    if (gameStatus.value !== 'countdown' && gameStatus.value !== 'running') return
    const now = getAudioTime()
    const spec = getMeterSpec(grooveMeter.value)
    const stepDur = 60 / bpm.value / spec.grooveSub

    while (tickCounter < gameTotalTicks && nextTickTime < now + SCHEDULE_AHEAD_SEC) {
      scheduleGameTick(tickCounter, nextTickTime)
      nextTickTime += stepDur
      tickCounter++
    }
  }

  function pushPopup(grade: RhythmGradePopup['grade'], offsetMs: number | null): void {
    gamePopup.value = {
      id: ++popupCounter,
      grade,
      offsetMs,
      combo: gameCombo.value,
      createdAt: performance.now(),
    }
  }

  function finishGame(): void {
    clearTimers()
    synth.cancelAll()
    gameStatus.value = 'finished'
    gameCountdown.value = null
    gameInBlindBar.value = false

    const summary = gameSummary.value
    const record: RhythmGameRecord = {
      id: `rhythm-${Date.now()}`,
      timestamp: Date.now(),
      challengeName: activeChallenge.value.name,
      bpm: bpm.value,
      meter: grooveMeter.value,
      targetMode: gameTargetMode.value,
      blindBars: gameBlindBars.value,
      score: summary.score,
      maxCombo: summary.maxCombo,
      avgOffsetMs: summary.avgOffsetMs,
      stabilityMs: summary.stabilityMs,
    }
    gameHistory.value = saveRhythmRecord(record)
    triggerHaptic([20, 40, 28])
  }

  function runGameLoop(): void {
    if (gameStatus.value !== 'countdown' && gameStatus.value !== 'running') return
    const now = getAudioTime() - getOutputLatencySec()
    gamePlayheadSec.value = now

    const spec = getMeterSpec(grooveMeter.value)
    const beatDur = 60 / bpm.value
    const barDur = beatDur * spec.beats

    if (now < gameStartSec.value) {
      gameStatus.value = 'countdown'
      const remainingBeats = Math.ceil((gameStartSec.value - now) / beatDur)
      gameCountdown.value = Math.max(1, Math.min(spec.beats, remainingBeats))
      gameInBlindBar.value = false
    } else {
      if (gameStatus.value !== 'running') {
        gameStatus.value = 'running'
        gameCountdown.value = null
      }
      const elapsed = now - gameStartSec.value
      const barIdx = Math.floor(elapsed / barDur)
      currentBar.value = Math.min(gameBars.value - 1, Math.max(0, barIdx))
      gameInBlindBar.value = isBarBlind(currentBar.value)
    }

    // Auto-miss targets that passed beyond the late window
    const lateLimitSec = DEFAULT_TIMING_WINDOWS.maxWindowMs / 1000
    for (const target of gameTargets.value) {
      if (!target.judged && now > target.expectedTime + lateLimitSec) {
        target.judged = true
        target.grade = 'miss'
        target.offsetMs = DEFAULT_TIMING_WINDOWS.maxWindowMs
        gameCombo.value = 0
        gameResults.value.push({
          targetId: target.id,
          grade: 'miss',
          offsetMs: DEFAULT_TIMING_WINDOWS.maxWindowMs,
          layer: target.layer,
          blind: target.blind,
        })
        pushPopup('miss', null)
      }
    }

    if (now >= gameEndSec.value + 0.25) {
      finishGame()
      return
    }

    rafId = window.requestAnimationFrame(runGameLoop)
  }

  async function startGame(): Promise<void> {
    stopAll()
    await ensureAudioContextRunning()

    const spec = getMeterSpec(grooveMeter.value)
    const sub = spec.grooveSub
    const tpb = spec.beats * sub
    const stepDur = 60 / bpm.value / sub
    const barDur = tpb * stepDur

    const countInStart = getAudioTime() + 0.08
    const playStart = countInStart + barDur
    const playEnd = playStart + gameBars.value * barDur

    gameCountInTicks = tpb
    gameTotalTicks = tpb * (gameBars.value + 1)
    tickCounter = 0
    nextTickTime = countInStart

    gameStartSec.value = playStart
    gameEndSec.value = playEnd
    gamePlayheadSec.value = countInStart
    gameTargets.value = buildGameTargets(playStart)
    gameResults.value = []
    gameCombo.value = 0
    gameMaxCombo.value = 0
    gamePopup.value = null
    gameCountdown.value = spec.beats
    gameInBlindBar.value = false
    gameStatus.value = 'countdown'

    schedulerTimer = window.setInterval(runGameScheduler, LOOKAHEAD_MS)
    runGameScheduler()
    rafId = window.requestAnimationFrame(runGameLoop)
  }

  function registerGameTap(): void {
    lastTapFlashAt.value = performance.now()
    triggerHaptic(10)

    // Give immediate crisp rim/woodblock feedback when tapping the pad
    const nowAudio = getAudioTime()
    synth.scheduleHit('fill', nowAudio + 0.004, 3, 0.55)

    if (gameStatus.value !== 'running' && gameStatus.value !== 'countdown') return

    const compensatedNow = nowAudio - getOutputLatencySec() - settings.latencyOffsetMs / 1000
    const maxWindowSec = DEFAULT_TIMING_WINDOWS.maxWindowMs / 1000

    let bestTarget: RhythmHitTarget | null = null
    let bestAbsDiff = Infinity
    let bestSignedMs = 0

    for (const target of gameTargets.value) {
      if (target.judged) continue
      const diffSec = compensatedNow - target.expectedTime
      const absDiff = Math.abs(diffSec)
      if (absDiff <= maxWindowSec && absDiff < bestAbsDiff) {
        bestAbsDiff = absDiff
        bestSignedMs = diffSec * 1000
        bestTarget = target
      }
    }

    if (!bestTarget) return

    const grade = judgeTimingOffset(bestSignedMs)
    bestTarget.judged = true
    bestTarget.grade = grade
    bestTarget.offsetMs = Math.round(bestSignedMs)

    if (grade === 'miss') {
      gameCombo.value = 0
    } else {
      gameCombo.value++
      if (gameCombo.value > gameMaxCombo.value) {
        gameMaxCombo.value = gameCombo.value
      }
    }

    gameResults.value.push({
      targetId: bestTarget.id,
      grade,
      offsetMs: Math.round(bestSignedMs),
      layer: bestTarget.layer,
      blind: bestTarget.blind,
    })
    pushPopup(grade, Math.round(bestSignedMs))
  }

  function stopAll(): void {
    clearTimers()
    synth.cancelAll()
    isPlaying.value = false
    currentStep.value = -1
    currentBeat.value = 0
    currentSubPos.value = 0
    visualQueue = []
    if (gameStatus.value === 'countdown' || gameStatus.value === 'running') {
      gameStatus.value = 'idle'
      gameCountdown.value = null
      gameInBlindBar.value = false
    }
  }

  function clearHistory(): void {
    clearRhythmHistory()
    gameHistory.value = []
  }

  function reloadHistory(): void {
    gameHistory.value = loadRhythmHistory()
  }

  onBeforeUnmount(() => {
    stopAll()
  })

  return {
    subView,
    bpm,
    pulseOnly,
    swing,
    basicMeter,
    basicSub,
    activeBasicPresetId,
    activeBasicPreset,
    grooveMeter,
    activeCategory,
    activeGrooveId,
    activeGroove,
    pattern,
    activeMeter,
    activeMeterSpec,
    activeSubdivision,
    grooveStats,
    isPlaying,
    isActive,
    currentStep,
    currentBeat,
    currentSubPos,
    currentBar,
    selectedChallengeId,
    activeChallenge,
    gameTargetMode,
    gameBars,
    gameBlindBars,
    gameStatus,
    gameCountdown,
    gameTargets,
    gameResults,
    gameCombo,
    gameMaxCombo,
    gamePopup,
    gamePlayheadSec,
    gameStartSec,
    gameEndSec,
    gameInBlindBar,
    gameSummary,
    gameHistory,
    lastTapFlashAt,
    setBpm,
    stepBpm,
    tapTempo,
    setSubView,
    selectBasicPreset,
    setBasicMeter,
    setBasicSub,
    setGrooveMeter,
    loadGroove,
    cycleCell,
    selectChallenge,
    cycleActivePreset,
    startPlayback,
    togglePlayback,
    startGame,
    registerGameTap,
    stopAll,
    clearHistory,
    reloadHistory,
  }
}
