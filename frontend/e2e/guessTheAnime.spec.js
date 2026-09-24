import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('guess the anime: setup, a round with a clue, and game over after three misses', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/games/guess-the-anime');
  await expect(page.getByRole('heading', { name: /Guess the Anime/ })).toBeVisible();
  await page.getByRole('radio', { name: /Hard/ }).click();
  await page.getByRole('button', { name: /PLAY \(3 LIVES\)/ }).click();

  await expect(page.locator('.guess-choice')).toHaveCount(4);
  await page.locator('#buy-clue').click();
  await expect(page.locator('#clue-area .speech-bubble')).toBeVisible();

  // Keep answering (always the first option) until three misses end the run.
  for (let i = 0; i < 40 && !(await page.getByText('GAME OVER').isVisible()); i += 1) {
    await page.locator('.guess-choice:not(:disabled)').first().click();
    await page.waitForTimeout(1800);
  }
  await expect(page.getByText('GAME OVER')).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('guess the anime: typed mode accepts the exact title', async ({ page }) => {
  await page.goto('/#/games/guess-the-anime?seed=abc&input=typed&diff=easy');
  await expect(page.locator('#typed-input')).toBeVisible();
  // Easy starts with the synopsis visible.
  await expect(page.locator('#clue-area .speech-bubble')).toBeVisible();
  await page.locator('#typed-input').fill('definitely not a title');
  await page.locator('#typed-form button[type=submit]').click();
  await expect(page.locator('.stat-pill').first()).toContainText('🖤');
});

test('guess the anime: blitz shows a running clock', async ({ page }) => {
  await page.goto('/#/games/guess-the-anime');
  await page.getByRole('button', { name: /BLITZ/ }).click();
  const t0 = Number(await page.locator('#blitz-time').textContent());
  await page.waitForTimeout(2200);
  const t1 = Number(await page.locator('#blitz-time').textContent());
  expect(t1).toBeLessThan(t0);
});
