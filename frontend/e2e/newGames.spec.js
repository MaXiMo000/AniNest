import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

async function playUntilOver(page, max = 60) {
  for (let i = 0; i < max && !(await page.getByText('GAME OVER').isVisible()); i += 1) {
    const choice = page.locator('.guess-choice:not(:disabled)').first();
    if (await choice.isVisible()) await choice.click();
    await page.waitForTimeout(700);
  }
  await expect(page.getByText('GAME OVER')).toBeVisible({ timeout: 60_000 });
}

for (const [slug, marker] of [
  ['studio-match', '.choice-cover'],
  ['source-guess', '.choice-cover'],
  ['emoji-plot', '.emoji-clue'],
  ['cast-call', '.cast-list'],
  ['name-that-opening', '.opening-player'],
]) {
  test(`${slug}: plays rounds until three lives are gone`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockApi(page);
    await page.goto(`/#/games/${slug}`);
    await expect(page.locator(marker)).toBeVisible();
    await expect(page.locator('.guess-choice')).toHaveCount(4);
    await playUntilOver(page);
    await expect(page.locator('.recap')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('timeline: tap, undo, lock in and see the years', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page);
  await page.goto('/#/games/timeline');
  const cards = page.locator('.timeline-card');
  await expect(cards).toHaveCount(4);
  await cards.nth(0).click();
  await cards.nth(1).click();
  await expect(page.locator('.timeline-order')).toHaveCount(2);
  await cards.nth(0).click(); // undo from the first pick
  await expect(page.locator('.timeline-order')).toHaveCount(0);
  for (let i = 0; i < 4; i += 1) await cards.nth(i).click();
  await page.locator('#timeline-check').click();
  await expect(page.locator('.timeline-year').first()).toBeVisible();
  await expect(page.locator('#timeline-result')).toContainText('→');
  expect(errors).toEqual([]);
});

test('name that opening: a clip that fails to load can be skipped without losing a life', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/games/name-that-opening');
  const skip = page.getByRole('button', { name: /SKIP \(NO PENALTY\)/ });
  await expect(skip).toBeVisible({ timeout: 15_000 });
  await skip.click();
  await expect(page.locator('.stat-pill').first()).toHaveText('❤️❤️❤️');
  await expect(page.locator('.opening-player')).toBeVisible();
});
