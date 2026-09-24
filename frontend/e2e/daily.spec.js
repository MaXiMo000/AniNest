import { test, expect } from '@playwright/test';
import { mockApi, POOL } from './mockApi.js';

test('anime daily: a wrong guess, then the right one, then stats and a countdown', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page);
  await page.goto('/#/games/daily');
  const answer = POOL[3].title;
  await page.locator('.guess-choice', { hasNotText: answer }).first().click();
  await expect(page.getByText('Guess 2/4')).toBeVisible();
  await page.locator('.guess-choice', { hasText: answer }).click();
  await expect(page.getByText(/Solved in/)).toBeVisible();
  await expect(page.locator('.daily-stats')).toBeVisible();
  await expect(page.locator('#daily-countdown')).toHaveText(/\d\d:\d\d:\d\d/);
  // Reloading shows the saved result, not a fresh puzzle.
  await page.reload();
  await expect(page.getByText(/Solved in 2\/4/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('manga daily: four wrong guesses lose, with the server-picked choices', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/games/manga-daily');
  await expect(page.getByRole('heading', { name: /Manga Daily #1/ })).toBeVisible();
  for (let i = 0; i < 4; i += 1) {
    await page.locator('.guess-choice:not(:disabled)', { hasNotText: /^\d Test Manga 1$/ }).first().click();
    await page.waitForTimeout(1300);
  }
  await expect(page.getByText(/Not solved today/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Try the Anime Daily/ })).toBeVisible();
});
