import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('a signed-in player starts a run and posts the score once at game over', async ({ page }) => {
  await mockApi(page, { user: { username: 'tester' } });
  const calls = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'POST' && u.pathname.startsWith('/api/games/')) calls.push({ path: u.pathname, body: r.postData() });
  });
  await page.goto('/#/games/emoji-plot');
  await expect(page.locator('.emoji-clue')).toBeVisible();
  for (let i = 0; i < 60 && !(await page.getByText('GAME OVER').isVisible()); i += 1) {
    const choice = page.locator('.guess-choice:not(:disabled)').first();
    if (await choice.isVisible()) await choice.click();
    await page.waitForTimeout(600);
  }
  await expect(page.getByText('GAME OVER')).toBeVisible();
  expect(calls.filter((c) => c.path === '/api/games/emoji-plot/start')).toHaveLength(1);
  const scores = calls.filter((c) => c.path === '/api/games/emoji-plot/score');
  const streak = Number(await page.locator('[data-countup]').getAttribute('data-countup'));
  expect(scores).toHaveLength(streak > 0 ? 1 : 0);
  if (streak > 0) expect(JSON.parse(scores[0].body)).toMatchObject({ streak, run_id: 'a'.repeat(32) });
  await expect(page.getByText('Log in to save your score')).toHaveCount(0);
});
