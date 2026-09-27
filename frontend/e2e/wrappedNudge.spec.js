import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('in December the home page nudges signed-in people to their Wrapped, and it can be hidden', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 11, 3, 12));
  await mockApi(page, { user: { username: 'tester' } });
  await page.goto('/#/');
  const nudge = page.locator('#wrapped-nudge');
  await expect(nudge).toContainText('your 2026 in anime is ready');
  await expect(nudge.getByRole('link', { name: 'SEE MY WRAPPED' })).toHaveAttribute('href', '#/wrapped?year=2026');
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'e2e/shots/wrapped-nudge.png' });
  await page.getByRole('button', { name: 'Hide this' }).click();
  await expect(nudge).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.hero, .section').first()).toBeVisible();
  await expect(page.locator('#wrapped-nudge')).toHaveCount(0);
});

test('no Wrapped nudge outside December or for visitors', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 5, 3, 12));
  await mockApi(page, { user: { username: 'tester' } });
  await page.goto('/#/');
  await expect(page.locator('.hero, .section').first()).toBeVisible();
  await expect(page.locator('#wrapped-nudge')).toHaveCount(0);
});
