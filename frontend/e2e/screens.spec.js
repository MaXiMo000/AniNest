import { test } from '@playwright/test';
import { mockApi } from './mockApi.js';

// Not assertions: captures screenshots for eyeballing layouts. Run with
// SCREENSHOTS=1 npx playwright test screens
const pages = (process.env.SHOTS || '/games/guess-the-anime').split(',');

test.skip(!process.env.SCREENSHOTS, 'screenshots only on request');

for (const path of pages) {
  for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    test(`screenshot ${path} ${label}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockApi(page);
      await page.goto(`/#${path}`);
      await page.waitForTimeout(Number(process.env.SHOT_WAIT || 1200));
      await page.screenshot({ path: `e2e/shots/${path.replace(/[^a-z0-9]+/gi, '_')}-${label}.png`, fullPage: true });
    });
  }
}
