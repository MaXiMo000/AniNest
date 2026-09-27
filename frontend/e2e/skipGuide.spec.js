import { test, expect } from '@playwright/test';
import { mockApi, POOL } from './mockApi.js';

const API = 'http://localhost:8787';
const HEADERS = { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true' };
const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: HEADERS });

async function openDetails(page, flags) {
  const anime = { ...POOL[0], episodes: 12 };
  await mockApi(page);
  await page.route(`${API}/api/anime/${anime.mal_id}/full`, (route) => reply(route, { data: anime }));
  await page.route(`${API}/api/reviews/${anime.mal_id}`, (route) => reply(route, { reviews: [], average: null, count: 0, myReview: null }));
  await page.route(`${API}/api/episode-guide/${anime.mal_id}`, (route) => reply(route, {
    minVotes: 3, clicksAt: 3, clickVotes: 4, episodes: [{ episode: 1, avg: 4.2, n: 5 }, { episode: 5, avg: 2.1, n: 4 }],
  }));
  await page.route(`${API}/api/episode-guide/${anime.mal_id}/flags`, (route) => reply(route, flags));
  await page.goto(`/#/anime/${anime.mal_id}`);
  await expect(page.locator('.ep-chart .ep-bar')).toHaveCount(12);
}

test('the episode guide says which filler and recap episodes can be skipped', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDetails(page, { available: true, filler: [5, 6, 7, 10], recap: [11] });
  await expect(page.locator('.ep-skip')).toContainText('4 filler episodes');
  await expect(page.locator('.ep-skip')).toContainText('5–7, 10');
  await expect(page.locator('.ep-skip')).toContainText('Recap episode: 11');
  await expect(page.locator('.ep-bar--filler')).toHaveCount(5);
  await expect(page.locator('.ep-bar[data-ep="11"]')).toHaveAttribute('aria-label', /recap$/);
  if (process.env.SCREENSHOTS) await page.locator('#episode-guide-slot').screenshot({ path: 'e2e/shots/skip-guide.png' });
  expect(errors).toEqual([]);
});

test('the episode guide stays as it was when MyAnimeList flags are unavailable', async ({ page }) => {
  await openDetails(page, { available: false, filler: [], recap: [] });
  await expect(page.locator('.ep-headline')).toContainText('episode 3');
  await expect(page.locator('.ep-skip')).toHaveCount(0);
  await expect(page.locator('.ep-bar--filler')).toHaveCount(0);
});
