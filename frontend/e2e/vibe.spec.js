import { test, expect } from '@playwright/test';
import { mockApi, POOL } from './mockApi.js';

const API = 'http://localhost:8787';
const HEADERS = { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true' };

test('vibe search says when the AI read the request', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page);
  const a = POOL[0];
  await page.route(`${API}/api/anime/vibe**`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: HEADERS,
    body: JSON.stringify({
      understood: true, like: null,
      parsed: { source: 'ai', unknown: [], chips: [{ label: 'Sci-Fi', type: 'include' }, { label: '2005 or earlier', type: 'filter' }] },
      data: [{ ...a, vibe_reasons: ['Sci-Fi', '1998'] }],
    }),
  }));
  await page.goto(`/#/vibe?q=${encodeURIComponent('lonely bounty hunters in space, old school')}`);
  await expect(page.locator('.vibe-chip')).toHaveCount(2);
  await expect(page.getByText('Read with AI')).toBeVisible();
  await expect(page.getByText('Didn’t understand')).toHaveCount(0);
  expect(errors).toEqual([]);
});
