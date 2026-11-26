import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

const basePath = process.env.BASE_PATH || '/'
const isCapacitorBuild = process.env.CAPACITOR_BUILD === '1'

export default defineConfig({
  base: basePath,
  plugins: [
    vue(),
    VitePWA({
      disable: isCapacitorBuild,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'VocalLab 声乐实验室',
        short_name: 'VocalLab',
        description: '实时人声音高曲线、音准分级练习、歌曲导入跟唱与 88 键标准音钢琴',
        lang: 'zh-CN',
        theme_color: '#11161c',
        background_color: '#11161c',
        display: 'standalone',
        orientation: 'any',
        start_url: basePath,
        scope: basePath,
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/audio\/piano\/.*\.mp3$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vocallab-piano-samples-v1',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    open: false,
  },
})
