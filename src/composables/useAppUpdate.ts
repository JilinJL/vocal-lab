import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { App as CapApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import {
  DEFAULT_UPDATE_MANIFEST_URL,
  isNativeUpdaterAvailable,
  VocalLabUpdater,
  type RemoteReleaseManifest,
} from '../engine/nativeUpdaterPlugin'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'needs-permission'
  | 'error'

const FALLBACK_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.5.0'

export function useAppUpdate(isBusy: Ref<boolean>) {
  const isNativeAndroid = isNativeUpdaterAvailable()

  const currentVersionName = ref(FALLBACK_VERSION)
  const currentVersionCode = ref<number | null>(null)
  const signingFingerprint = ref('')
  const status = ref<UpdateStatus>('idle')
  const latestRelease = ref<RemoteReleaseManifest | null>(null)
  const downloadedFilePath = ref<string | null>(null)
  const downloadProgress = ref(0)
  const receivedBytes = ref(0)
  const totalBytes = ref(0)
  const statusMessage = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const lastCheckedAt = ref<number | null>(null)

  // Online Web / PWA refresh state
  const pwaNeedRefresh = ref(false)
  let swRegistration: ServiceWorkerRegistration | null = null
  let swReloading = false

  const bannerDismissedKey = ref<string | null>(null)

  let progressHandle: PluginListenerHandle | null = null
  let appStateHandle: PluginListenerHandle | null = null
  let startupCheckTimer: number | null = null

  const hasUpdate = computed(() => {
    if (isNativeAndroid) {
      return (
        status.value === 'available' ||
        status.value === 'downloading' ||
        status.value === 'verifying' ||
        status.value === 'ready' ||
        status.value === 'needs-permission'
      )
    }
    return pwaNeedRefresh.value
  })

  const activeUpdateKey = computed(() => {
    if (isNativeAndroid && latestRelease.value) {
      return `native:${latestRelease.value.versionCode}`
    }
    if (pwaNeedRefresh.value) {
      return `pwa:${currentVersionName.value}`
    }
    return null
  })

  const showBanner = computed(() => {
    if (isBusy.value) return false
    if (!activeUpdateKey.value) return false
    if (bannerDismissedKey.value === activeUpdateKey.value) return false
    if (isNativeAndroid) {
      return (
        status.value === 'available' ||
        status.value === 'ready' ||
        status.value === 'needs-permission'
      )
    }
    return pwaNeedRefresh.value
  })

  function dismissBanner() {
    if (activeUpdateKey.value) {
      bannerDismissedKey.value = activeUpdateKey.value
    }
  }

  async function loadNativeAppInfo() {
    if (!isNativeAndroid) return
    try {
      const info = await VocalLabUpdater.getAppInfo()
      currentVersionName.value = info.versionName || FALLBACK_VERSION
      currentVersionCode.value = info.versionCode
      signingFingerprint.value = info.signingCertSha256 || ''
    } catch {
      // ignore if native info unavailable
    }
  }

  async function checkForUpdate(silent = false): Promise<void> {
    if (status.value === 'downloading' || status.value === 'verifying') return

    if (!isNativeAndroid) {
      if (!silent) {
        status.value = 'checking'
        errorMessage.value = null
        statusMessage.value = '正在检查在线版更新…'
      }
      try {
        if (swRegistration) {
          await swRegistration.update()
        }
        lastCheckedAt.value = Date.now()
        if (pwaNeedRefresh.value) {
          status.value = 'available'
          statusMessage.value = '在线版新版本已就绪，点击刷新生效。'
        } else if (!silent) {
          status.value = 'up-to-date'
          statusMessage.value = '当前已是最新在线版本。'
        }
      } catch {
        if (!silent) {
          status.value = 'error'
          errorMessage.value = '无法连接更新服务，请稍后重试。'
        }
      }
      return
    }

    if (!silent) {
      status.value = 'checking'
      errorMessage.value = null
      statusMessage.value = '正在检查新版本…'
    }

    try {
      const res = await VocalLabUpdater.checkForUpdate({
        manifestUrl: DEFAULT_UPDATE_MANIFEST_URL,
      })
      lastCheckedAt.value = Date.now()
      currentVersionName.value = res.currentVersionName || currentVersionName.value
      currentVersionCode.value = res.currentVersionCode
      latestRelease.value = res.latest
      errorMessage.value = null

      if (res.hasUpdate) {
        if (res.cachedFilePath) {
          downloadedFilePath.value = res.cachedFilePath
          status.value = 'ready'
          statusMessage.value = `新版本 v${res.latest.versionName} 已下载就绪，点击即可安装。`
        } else {
          downloadedFilePath.value = null
          status.value = 'available'
          statusMessage.value = `发现新版本 v${res.latest.versionName}（Build ${res.latest.versionCode}）。`
        }
      } else {
        downloadedFilePath.value = null
        if (!silent || status.value === 'checking') {
          status.value = 'up-to-date'
          statusMessage.value = '当前已是最新版本。'
        }
      }
    } catch (err) {
      if (!silent) {
        status.value = 'error'
        errorMessage.value =
          err instanceof Error ? err.message : '检查更新失败，请检查网络连接后重试。'
      }
    }
  }

  async function startDownload(): Promise<void> {
    if (!isNativeAndroid || !latestRelease.value) return
    if (status.value === 'downloading' || status.value === 'verifying') return

    const target = latestRelease.value
    status.value = 'downloading'
    errorMessage.value = null
    statusMessage.value = `正在下载 VocalLab v${target.versionName}…`
    downloadProgress.value = 0
    receivedBytes.value = 0
    totalBytes.value = target.sizeBytes || 0

    try {
      const res = await VocalLabUpdater.downloadUpdate({
        apkUrl: target.apkUrl,
        expectedSha256: target.sha256,
        versionName: target.versionName,
      })

      if (res.cancelled) {
        status.value = 'available'
        downloadProgress.value = 0
        statusMessage.value = '已取消下载，可随时重新下载。'
        return
      }

      if (res.filePath) {
        downloadedFilePath.value = res.filePath
        status.value = 'ready'
        downloadProgress.value = 100
        statusMessage.value = '安装包已下载并通过 SHA-256 校验，正在调起系统安装界面…'
        await installDownloaded()
      }
    } catch (err) {
      status.value = 'error'
      downloadProgress.value = 0
      errorMessage.value =
        err instanceof Error ? err.message : '下载更新中断，请检查网络后点击重试。'
    }
  }

  async function cancelDownload(): Promise<void> {
    if (!isNativeAndroid) return
    await VocalLabUpdater.cancelDownload().catch(() => {})
    status.value = 'available'
    downloadProgress.value = 0
    statusMessage.value = '已取消下载，可随时重新下载。'
  }

  async function installDownloaded(): Promise<void> {
    if (!isNativeAndroid || !downloadedFilePath.value) return
    errorMessage.value = null
    try {
      const res = await VocalLabUpdater.installUpdate({
        filePath: downloadedFilePath.value,
      })
      if (res.needsPermission) {
        status.value = 'needs-permission'
        statusMessage.value =
          '首次通过 VocalLab 安装更新时，请在系统页面开启「允许来自此来源的应用」，返回后即可继续安装。'
        return
      }
      if (res.launched) {
        status.value = 'ready'
        statusMessage.value = '已交由 Android 系统安装界面确认；如刚才取消了安装，可再次点击立即安装。'
      }
    } catch (err) {
      status.value = 'error'
      errorMessage.value =
        err instanceof Error ? err.message : '无法调起系统安装界面，请重新下载后重试。'
    }
  }

  async function openPermissionSettings(): Promise<void> {
    if (!isNativeAndroid) return
    try {
      await VocalLabUpdater.openUnknownSourcesSettings()
    } catch (err) {
      errorMessage.value =
        err instanceof Error ? err.message : '无法打开安装来源授权页面，请手动在系统设置中开启。'
    }
  }

  async function applyPwaUpdate(): Promise<void> {
    const waiting = swRegistration?.waiting
    if (waiting) {
      waiting.postMessage({ type: 'SKIP_WAITING' })
      window.setTimeout(() => {
        if (!swReloading) {
          window.location.reload()
        }
      }, 1200)
      return
    }
    window.location.reload()
  }

  function attachWebPwaUpdater() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    if (import.meta.env.DEV) return

    const markRefreshReady = () => {
      pwaNeedRefresh.value = true
      status.value = 'available'
      statusMessage.value = '在线版新版本已就绪，点击刷新即可启用。'
    }

    const handleControllerChange = () => {
      if (swReloading) return
      swReloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)

    const swUrl = `${import.meta.env.BASE_URL}sw.js`
    void navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        swRegistration = reg
        if (reg.waiting && navigator.serviceWorker.controller) {
          markRefreshReady()
        }
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing
          if (!installing) return
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              markRefreshReady()
            }
          })
        })
        // Silent background check shortly after launch
        startupCheckTimer = window.setTimeout(() => {
          void reg.update().catch(() => {})
        }, 2500)
      })
      .catch(() => {
        // Ignore SW registration failure on unsupported origins
      })
  }

  onMounted(() => {
    if (isNativeAndroid) {
      void loadNativeAppInfo()

      void VocalLabUpdater.addListener('updateProgress', (ev) => {
        receivedBytes.value = ev.receivedBytes ?? 0
        totalBytes.value = ev.totalBytes ?? totalBytes.value
        downloadProgress.value = ev.progress ?? 0
        if (ev.phase === 'downloading') {
          status.value = 'downloading'
        } else if (ev.phase === 'verifying') {
          status.value = 'verifying'
          statusMessage.value = '下载完成，正在校验 SHA-256 完整性…'
        }
      }).then((handle) => {
        progressHandle = handle
      })

      void CapApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) return
        if (status.value === 'needs-permission' && downloadedFilePath.value) {
          void VocalLabUpdater.canRequestPackageInstalls().then(({ granted }) => {
            if (granted) {
              status.value = 'ready'
              statusMessage.value = '已获得安装来源授权，点击「立即安装」即可覆盖更新。'
            }
          })
        }
      }).then((handle) => {
        appStateHandle = handle
      })

      // Silent background check shortly after launch (never blocks startup)
      startupCheckTimer = window.setTimeout(() => {
        void checkForUpdate(true)
      }, 2200)
    } else if (!Capacitor.isNativePlatform()) {
      attachWebPwaUpdater()
    }
  })

  onBeforeUnmount(() => {
    if (startupCheckTimer !== null) {
      window.clearTimeout(startupCheckTimer)
      startupCheckTimer = null
    }
    if (progressHandle) {
      void progressHandle.remove()
      progressHandle = null
    }
    if (appStateHandle) {
      void appStateHandle.remove()
      appStateHandle = null
    }
  })

  return {
    isNativeAndroid,
    currentVersionName,
    currentVersionCode,
    signingFingerprint,
    status,
    latestRelease,
    downloadedFilePath,
    downloadProgress,
    receivedBytes,
    totalBytes,
    statusMessage,
    errorMessage,
    lastCheckedAt,
    pwaNeedRefresh,
    hasUpdate,
    showBanner,
    dismissBanner,
    checkForUpdate,
    startDownload,
    cancelDownload,
    installDownloaded,
    openPermissionSettings,
    applyPwaUpdate,
  }
}
