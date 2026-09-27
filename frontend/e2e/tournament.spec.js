import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { mockApi, POOL } from './mockApi.js';

// A real GET /api/tournaments view (generated from backend/src/lib/tournamentStore.js).
const VIEW = JSON.parse(fs.readFileSync(new URL('./fixtures/tournament.json', import.meta.url), 'utf8'));
const API = 'http://localhost:8787';
const HEADERS = { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true', 'x-csrf-token': 'test' };
const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: HEADERS });

test('past seasons can be picked, and load that season\'s bracket', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page);
  await page.route(`${API}/api/tournaments/current?kind=OP`, (route) => reply(route, { data: VIEW }));
  await page.route(`${API}/api/tournaments/seasons`, (route) => reply(route, {
    seasons: [{ season: 'SUMMER', year: 2026, kinds: ['ED', 'OP'] }, { season: 'SPRING', year: 2026, kinds: ['OP'] }],
  }));
  let archiveHit = false;
  await page.route(`${API}/api/tournaments/2026/spring?kind=OP`, (route) => { archiveHit = true; return reply(route, { data: { ...VIEW, season: 'SPRING' } }); });
  await page.goto('/#/tournament');
  await expect(page.locator('h1.section-title')).toContainText('Summer 2026');
  await page.locator('#season-picker .pow-select-trigger').click();
  await page.locator('#season-picker li', { hasText: 'Spring 2026' }).click();
  await expect(page).toHaveURL(/season=SPRING&year=2026/);
  await expect(page.locator('h1.section-title')).toContainText('Spring 2026');
  expect(archiveHit).toBe(true);
  await expect(page.getByRole('tab', { name: 'Best Ending' })).toHaveAttribute('href', '#/tournament?kind=ED&season=SPRING&year=2026');
  expect(errors).toEqual([]);
});

test('the jukebox links to brackets the show\'s songs are in', async ({ page }) => {
  const anime = POOL[0];
  await mockApi(page);
  await page.route(`${API}/api/anime/${anime.mal_id}/full`, (route) => reply(route, { data: anime }));
  await page.route(`${API}/api/episode-guide/${anime.mal_id}`, (route) => reply(route, { minVotes: 3, episodes: [], clicksAt: null, clickVotes: 0 }));
  await page.route(`${API}/api/reviews/${anime.mal_id}`, (route) => reply(route, { reviews: [], average: null, count: 0, myReview: null }));
  await page.route(`${API}/api/tournaments/for-anime/${anime.mal_id}`, (route) => reply(route, { entries: [{ season: 'SUMMER', year: 2026, kind: 'OP', slug: 'OP1', title: 'Song' }] }));
  await page.goto(`/#/anime/${anime.mal_id}`);
  const link = page.getByRole('link', { name: /OP1 is in the Summer 2026 Best Opening tournament/ });
  await expect(link).toHaveAttribute('href', '#/tournament?kind=OP&season=SUMMER&year=2026');
});
