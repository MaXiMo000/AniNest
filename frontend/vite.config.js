import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    strictPort: false
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // 'script' emits a same-origin <script src="/registerSW.js"> tag
      // instead of an inline one - the site's CSP has no 'unsafe-inline'
      // for script-src, so an auto-injected inline registration script
      // would just be silently blocked.
      injectRegister: 'script',
      // Deliberately NOT setting devOptions.enabled: true - under `vite dev`
      // the plugin injects its own inline dev-mode registration snippet
      // regardless of injectRegister, which the CSP above (no 'unsafe-inline'
      // in script-src) blocks outright. Test PWA behavior against a real
      // `vite build && vite preview` instead, which also matches what
      // actually ships to production far more closely than dev mode would.
      manifest: {
        name: 'AniNest — Your Anime & Manga Home Base',
        short_name: 'AniNest',
        description: 'Discover, track and review anime and manga, watch official free episodes, play anime games and level up.',
        theme_color: '#120c22',
        background_color: '#120c22',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      // Default generateSW strategy: precache the built app shell (HTML/CSS/JS,
      // hashed filenames handled automatically) so the shell loads offline.
      // The only API data cached is public-domain book text, which never
      // changes; anime and manga data stay network-only, since stale data
      // that looks live would be misleading.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        // The plain registerSW.js script (see injectRegister above) never
        // tells a waiting worker to take over, so without these a new deploy
        // only reached returning visitors after they closed every AniNest tab.
        // Now the new worker activates at once and the next load is current.
        skipWaiting: true,
        clientsClaim: true,
        // Push alert handlers (public/push-sw.js), used when the server has
        // VAPID keys and the user turns alerts on from the notifications page.
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          {
            // Chapters: fixed text, so served from the cache once fetched
            // (the reader's "Offline" button fetches every chapter).
            urlPattern: ({ url }) => /\/api\/novels\/classics\/\d+\/parts\/\d+$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'aninest-classics-text', expiration: { maxEntries: 3000, maxAgeSeconds: 90 * 24 * 60 * 60 } },
          },
          {
            // A book's chapter list: from the network when online (it carries
            // your saved place), from the cache when offline.
            urlPattern: ({ url }) => /\/api\/novels\/classics\/\d+$/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'aninest-classics-books', networkTimeoutSeconds: 8, expiration: { maxEntries: 100, maxAgeSeconds: 90 * 24 * 60 * 60 } },
          },
        ],
      },
    }),
  ],
});
