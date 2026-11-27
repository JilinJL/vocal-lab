import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  formatFileSize,
  formatShortFingerprint,
  isRemoteUpdateNewer,
} from '../nativeUpdaterPlugin'

describe('nativeUpdaterPlugin helpers', () => {
  it('compares semantic versions accurately', () => {
    expect(compareSemver('1.5.1', '1.5.0')).toBe(1)
    expect(compareSemver('v1.5.0', '1.5.0')).toBe(0)
    expect(compareSemver('1.4.9', '1.5.0')).toBe(-1)
    expect(compareSemver('2.0.0', '1.99.99')).toBe(1)
  })

  it('prioritizes Android versionCode when positive and falls back to semver', () => {
    expect(isRemoteUpdateNewer(150, 151, '1.5.0', '1.5.1')).toBe(true)
    expect(isRemoteUpdateNewer(151, 151, '1.5.1', '1.5.1')).toBe(false)
    expect(isRemoteUpdateNewer(151, 150, '1.5.1', '1.5.0')).toBe(false)
    expect(isRemoteUpdateNewer(0, 0, '1.5.0', '1.5.1')).toBe(true)
  })

  it('formats file sizes and certificate fingerprints cleanly', () => {
    expect(formatFileSize(0)).toBe('—')
    expect(formatFileSize(512 * 1024)).toBe('512 KB')
    expect(formatFileSize(11.4 * 1024 * 1024)).toBe('11.4 MB')
    expect(
      formatShortFingerprint('B4:0E:34:73:E4:A1:FF:08:38:A0:CE:37:B0:B3:E2:21:39:B4:E2:27'),
    ).toBe('B4:0E:34:73…B4:E2:27')
  })
})
