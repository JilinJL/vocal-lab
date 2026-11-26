import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'

export function triggerHaptic(pattern: number | number[] = 12): void {
  try {
    if (Capacitor.isNativePlatform()) {
      const heavy = Array.isArray(pattern) || pattern >= 15
      void Haptics.impact({ style: heavy ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {})
      return
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern)
    }
  } catch {
    // ignore unsupported environments
  }
}
