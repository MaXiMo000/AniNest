import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('a signed-in player’s run is started once and scored by the server, never posted by the page', async ({ page }) => {
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
  expect(calls.filter((c) => c.path === '/api/games/rounds/start')).toHaveLength(1);
  expect(JSON.parse(calls[0].body)).toMatchObject({ game: 'emoji-plot' });
  expect(calls.filter((c) => c.path.endsWith('/score'))).toHaveLength(0);
  expect(calls.filter((c) => c.path.endsWith('/answer')).length).toBeGreaterThanOrEqual(3);
  await expect(page.getByText('Log in to save your score')).toHaveCount(0);
});
