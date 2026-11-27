import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export const DEFAULT_UPDATE_MANIFEST_URL =
  'https://github.com/JilinJL/vocal-lab/releases/latest/download/update.json'

export interface NativeAppInfo {
  packageName: string
  versionName: string
  versionCode: number
  signingCertSha256: string
  sdkInt: number
}

export interface RemoteReleaseManifest {
  versionName: string
  versionCode: number
  apkUrl: string
  sha256: string
  sizeBytes: number
  releaseNotes: string
  publishedAt: string
  apkName: string
  minAndroidSdk: number
}

export interface CheckUpdateResult {
  hasUpdate: boolean
  currentVersionName: string
  currentVersionCode: number
  latest: RemoteReleaseManifest
  cachedFilePath?: string
}

export interface UpdateProgressEvent {
  phase: 'downloading' | 'verifying' | 'ready' | 'cancelled' | 'error'
  receivedBytes: number
  totalBytes: number
  progress: number
  message?: string
}

export interface DownloadUpdateResult {
  cancelled: boolean
  filePath?: string
  sha256?: string
  sizeBytes?: number
}

export interface InstallUpdateResult {
  launched: boolean
  needsPermission: boolean
}

export interface SaveBackupFileResult {
  saved: boolean
  location: string
}

export interface VocalLabUpdaterPlugin {
  getAppInfo(): Promise<NativeAppInfo>
  checkForUpdate(options?: { manifestUrl?: string }): Promise<CheckUpdateResult>
  downloadUpdate(options: {
    apkUrl: string
    expectedSha256?: string
    versionName?: string
  }): Promise<DownloadUpdateResult>
  cancelDownload(): Promise<void>
  canRequestPackageInstalls(): Promise<{ granted: boolean }>
  openUnknownSourcesSettings(): Promise<void>
  installUpdate(options: { filePath: string }): Promise<InstallUpdateResult>
  saveBackupFile(options: { filename: string; content: string }): Promise<SaveBackupFileResult>
  addListener(
    eventName: 'updateProgress',
    listenerFunc: (event: UpdateProgressEvent) => void,
  ): Promise<PluginListenerHandle>
}

export const VocalLabUpdater = registerPlugin<VocalLabUpdaterPlugin>('VocalLabUpdater')

export function isNativeUpdaterAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.replace(/^v/i, '').split('.').map((n) => Number.parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length, 3)
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va !== vb) return va > vb ? 1 : -1
  }
  return 0
}

export function isRemoteUpdateNewer(
  localVersionCode: number,
  remoteVersionCode: number,
  localVersionName?: string,
  remoteVersionName?: string,
): boolean {
  if (remoteVersionCode > 0 && localVersionCode > 0) {
    return remoteVersionCode > localVersionCode
  }
  if (localVersionName && remoteVersionName) {
    return compareSemver(remoteVersionName, localVersionName) > 0
  }
  return false
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatShortFingerprint(sha256: string): string {
  const clean = sha256.trim()
  if (!clean) return '未知'
  if (clean.length <= 17) return clean
  return `${clean.slice(0, 11)}…${clean.slice(-8)}`
}
