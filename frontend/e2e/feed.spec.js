import { test, expect } from '@playwright/test';
import { mockApi, POOL } from './mockApi.js';

const API = 'http://localhost:8787';
const HEADERS = { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true' };
const reply = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: HEADERS });
const ME = { username: 'me_here', email: 'me@test.local' };

test('follow someone from their profile, and the button and counts update', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page, { user: ME });
  const calls = [];
  await page.route(`${API}/api/users/alex`, (route) => reply(route, {
    user: { username: 'alex', createdAt: '2026-01-01 00:00:00' },
    follows: { followers: 2, following: 5, isFollowing: false },
    favorites: [], reviews: [], mangaReviews: [], badges: [], xp: null,
  }));
  await page.route(`${API}/api/users/alex/follow`, (route) => {
    const method = route.request().method();
    calls.push(method);
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...HEADERS, 'access-control-allow-methods': 'POST, DELETE', 'access-control-allow-headers': 'content-type, x-csrf-token' } });
    return reply(route, method === 'POST' ? { followers: 3, following: 5, isFollowing: true } : { followers: 2, following: 5, isFollowing: false });
  });
  await page.goto('/#/u/alex');
  await expect(page.locator('#follow-counts')).toHaveText('👥 2 followers · 5 following');
  await page.locator('#follow-btn').click();
  await expect(page.locator('#follow-btn')).toHaveText('✓ Following');
  await expect(page.locator('#follow-btn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#follow-counts')).toHaveText('👥 3 followers · 5 following');
  if (process.env.SCREENSHOTS) await page.locator('.account-page').screenshot({ path: 'e2e/shots/follow.png' });
  await page.locator('#follow-btn').click();
  await expect(page.locator('#follow-btn')).toHaveText('➕ Follow');
  expect(calls.filter((m) => m !== 'OPTIONS')).toEqual(['POST', 'DELETE']);
  expect(errors).toEqual([]);
});

test('friends\' activity lists what followed people did, newest first', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page, { user: ME });
  const [a, b] = POOL;
  const now = new Date(Date.now() - 2 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');
  await page.route(`${API}/api/feed`, (route) => reply(route, {
    following: [{ username: 'alex', private: false }, { username: 'quiet', private: true }],
    items: [
      { kind: 'review', username: 'alex', mal_id: a.mal_id, title: a.title, image: a.images.jpg.image_url, rating: 9, body: 'Quietly <b>perfect</b>.', at: now },
      { kind: 'status', username: 'alex', mal_id: b.mal_id, title: b.title, image: null, status: 'completed', at: now },
      { kind: 'added', username: 'alex', mal_id: 99, title: null, image: null, status: null, at: now },
    ],
  }));
  await page.goto('/#/feed');
  await expect(page.locator('h1.section-title')).toContainText('Friends’ Activity');
  await expect(page.locator('.feed-row')).toHaveCount(3);
  await expect(page.locator('.feed-row').nth(0)).toContainText(`rated ${a.title} 9/10`);
  await expect(page.locator('.feed-row').nth(0)).toContainText('“Quietly <b>perfect</b>.”');
  await expect(page.locator('.feed-row').nth(1)).toContainText(`completed ${b.title}`);
  await expect(page.locator('.feed-row').nth(2)).toContainText('added Anime #99 to their list');
  await expect(page.locator('.feed-row').nth(0)).toContainText('2h ago');
  await expect(page.locator('.feed-following .chip')).toHaveText(['alex', '🔒 quiet']);
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'e2e/shots/feed.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (process.env.SCREENSHOTS) await page.screenshot({ path: 'e2e/shots/feed-phone.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('friends\' activity explains how to start when you follow nobody', async ({ page }) => {
  await mockApi(page, { user: ME });
  await page.route(`${API}/api/feed`, (route) => reply(route, { following: [], items: [] }));
  await page.goto('/#/feed');
  await expect(page.getByText('You’re not following anyone yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: '🏆 XP Leaderboard' })).toBeVisible();
});
