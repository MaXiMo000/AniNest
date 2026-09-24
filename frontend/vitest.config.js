import { defineConfig } from 'vitest/config';

// Separate from vite.config.js so the PWA plugin stays out of unit tests.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
  },
});
