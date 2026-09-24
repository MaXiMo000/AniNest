import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('game hub lists every game, links work, and a played daily shows its result', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/games');
  await expect(page.locator('.game-card')).toHaveCount(11);
  await expect(page.getByText('TODAY’S PUZZLE').first()).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((d) => localStorage.setItem(`aninest_daily_${d}`, JSON.stringify({ attempts: ['wrong', 'correct'], won: true })), today);
  await page.reload();
  await expect(page.getByText('✅ Solved in 2/4')).toBeVisible();
  await page.getByRole('link', { name: /Timeline/ }).first().click();
  await expect(page).toHaveURL(/#\/games\/timeline/);
});

test('leaderboard: pick a board, switch to this week', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/games/leaderboard/guess-the-anime');
  await expect(page.getByRole('heading', { name: /Guess the Anime: Normal Leaderboard/ })).toBeVisible();
  await page.getByRole('link', { name: /Emoji Plot/ }).click();
  await expect(page.getByRole('heading', { name: /Emoji Plot Leaderboard/ })).toBeVisible();
  await page.getByRole('tab', { name: /This week/ }).click();
  await expect(page).toHaveURL(/period=week/);
  await expect(page.getByText('Best scores from the last 7 days.')).toBeVisible();
  await expect(page.getByRole('link', { name: /PLAY/ })).toHaveAttribute('href', '#/games/emoji-plot');
});

test('my game stats shows local history with a sparkline', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/games');
  await page.evaluate(() => localStorage.setItem('aninest_game_stats_v1', JSON.stringify({
    timeline: { plays: 3, best: 7, total: 12, history: [{ s: 2, t: 1 }, { s: 3, t: 2 }, { s: 7, t: 3 }], lastPlayed: 3 },
  })));
  await page.goto('/#/games/stats');
  await expect(page.getByRole('row', { name: /Timeline/ })).toContainText('7');
  await expect(page.locator('.sparkline')).toHaveCount(1);
  await expect(page.locator('.daily-stats')).toHaveCount(2);
});
