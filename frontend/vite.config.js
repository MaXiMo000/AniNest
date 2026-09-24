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
      // No runtime caching is configured for /api/* on purpose - this is an
      // offline SHELL, not an offline data cache, and serving stale anime
      // data while looking live would be actively misleading.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        // The plain registerSW.js script (see injectRegister above) never
        // tells a waiting worker to take over, so without these a new deploy
        // only reached returning visitors after they closed every AniNest tab.
        // Now the new worker activates at once and the next load is current.
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
});
