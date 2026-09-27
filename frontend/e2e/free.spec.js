import { test, expect } from '@playwright/test';
import { mockApi, POOL } from './mockApi.js';

const API = 'http://localhost:8787';
const HEADERS = { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true' };

test('free in my country lists what plays there and follows the country picker', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('aninest:country', 'IN'));
  await mockApi(page);
  const asked = [];
  await page.route(`${API}/api/free**`, (route) => {
    const country = new URL(route.request().url()).searchParams.get('country');
    asked.push(country);
    const list = country === 'IN' ? POOL.slice(0, 3) : POOL.slice(0, 1);
    return route.fulfill({
      status: 200, contentType: 'application/json', headers: HEADERS,
      body: JSON.stringify({ country, pending: 2, data: list.map((a) => ({ mal_id: a.mal_id, title: a.title, image: a.images.jpg.image_url, score: a.score, type: a.type, episodes: a.episodes, uploads: 3 })) }),
    });
  });
  await page.goto('/#/free');
  await expect(page.locator('h1.section-title')).toContainText('India');
  await expect(page.locator('.anime-card')).toHaveCount(3);
  await expect(page.getByText('2 more shows are still being added')).toBeVisible();
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'e2e/shots/free.png', fullPage: true });
  await page.selectOption('#free-country', 'US');
  await expect(page.locator('h1.section-title')).toContainText('United States');
  await expect(page.locator('.anime-card')).toHaveCount(1);
  expect(asked).toEqual(['IN', 'US']);
  expect(errors).toEqual([]);
});
