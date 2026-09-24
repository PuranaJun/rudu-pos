import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Warm off-white. Used by the manifest, the iOS status bar and the app background.
const WARM_OFF_WHITE = '#FAF6EE';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'ฤดูชา POS',
        short_name: 'ฤดูชา',
        description: 'ระบบขายหน้าร้าน ฤดูชา',
        lang: 'th',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: WARM_OFF_WHITE,
        background_color: WARM_OFF_WHITE,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The shell must cold-start in airplane mode.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        // Take control as soon as the first install finishes, so the very
        // first launch from the home screen is already offline-capable.
        // Updates still wait (registerType is 'prompt') and can never swap
        // the app out mid-sale.
        clientsClaim: true,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // No service worker under test, and the plugin's virtual module does
    // not resolve there.
    alias: {
      'virtual:pwa-register/react': fileURLToPath(
        new URL('./src/test/pwa-register-stub.ts', import.meta.url),
      ),
    },
  },
});
