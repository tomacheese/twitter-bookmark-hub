import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Twitter Bookmark Hub',
        short_name: 'Bookmark Hub',
        description:
          '複数の Twitter/X アカウントのブックマークを一元管理するアプリ',
        theme_color: '#1d9bf0',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // ナビゲーションフォールバックを有効にし、オフライン時でも SPA が動作するよう index.html を返す
        // /api/* はサービスワーカーのフォールバック対象から除外する
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Twitter 画像をキャッシュ（pbs.twimg.com）
            // 静的アセットルールより前に定義し、Twitter 画像が正しいキャッシュに格納されるようにする
            urlPattern: /^https:\/\/pbs\.twimg\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'twitter-images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 日
              },
            },
          },
          {
            // 静的アセットをキャッシュ（JS・CSS・フォント・画像等）
            urlPattern: /^https:\/\/.*\.(js|css|woff2?|png|jpg|jpeg|svg|ico)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 日
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
