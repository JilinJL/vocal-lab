import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.vocallab.app',
  appName: 'VocalLab',
  webDir: 'dist',
  backgroundColor: '#11161c',
  android: {
    backgroundColor: '#11161c',
    allowMixedContent: false,
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#11161c',
    },
  },
}

export default config
