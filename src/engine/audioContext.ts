export type AudioContextStateExtended = AudioContextState | 'interrupted' | 'uninitialized'

type StateListener = (state: AudioContextStateExtended) => void

let sharedContext: AudioContext | null = null
const stateListeners = new Set<StateListener>()

function resolveAudioContextConstructor(): typeof AudioContext {
  const ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!ctor) {
    throw new Error('当前浏览器不支持 Web Audio API。')
  }
  return ctor
}

function notifyStateChange(): void {
  const current = getAudioContextState()
  for (const listener of stateListeners) {
    try {
      listener(current)
    } catch {
      // ignore listener errors
    }
  }
}

export function getSharedAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    const AudioCtx = resolveAudioContextConstructor()
    sharedContext = new AudioCtx()
    sharedContext.addEventListener('statechange', notifyStateChange)
  }
  return sharedContext
}

export function ensureAudioContextRunning(): Promise<AudioContext> {
  const ctx = getSharedAudioContext()
  const state = ctx.state as AudioContextStateExtended
  if (state === 'suspended' || state === 'interrupted') {
    return ctx.resume().then(() => ctx)
  }
  return Promise.resolve(ctx)
}

export function getAudioTime(): number {
  if (!sharedContext || sharedContext.state === 'closed') {
    return 0
  }
  return sharedContext.currentTime
}

export function getAudioContextState(): AudioContextStateExtended {
  if (!sharedContext) return 'uninitialized'
  return sharedContext.state as AudioContextStateExtended
}

export function subscribeAudioStateChange(listener: StateListener): () => void {
  stateListeners.add(listener)
  return () => {
    stateListeners.delete(listener)
  }
}
