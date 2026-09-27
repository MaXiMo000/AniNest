import { test, expect } from '@playwright/test';
import { mockApi, POOL } from './mockApi.js';

// The screens added by the 2026-09-27 audit fixes: account & privacy,
// password reset, share buttons, review reports and the admin queue.
const API = 'http://localhost:8787';
const HEADERS = { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true', 'x-csrf-token': 'test' };
const reply = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: HEADERS });

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test('account page: change password shows the server error, then succeeds', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, { user: { username: 'tester', email: 'tester@test.local', createdAt: '2026-01-01 00:00:00' } });
  let calls = 0;
  await page.route(`${API}/api/auth/password`, (route) => {
    calls += 1;
    return calls === 1 ? reply(route, { error: 'Your current password is wrong.' }, 401) : route.fulfill({ status: 204, headers: HEADERS });
  });
  await page.goto('/#/account');
  await expect(page.getByRole('heading', { name: /Account & Privacy/ })).toBeVisible();
  await page.fill('#current-password', 'nope');
  await page.fill('#new-password', 'newhorse456');
  await page.click('#password-form button[type="submit"]');
  await expect(page.locator('#password-result')).toContainText('current password is wrong');
  await page.click('#password-form button[type="submit"]');
  await expect(page.getByText('Password changed')).toBeVisible();
  await expect(page.locator('#export-data')).toHaveAttribute('href', `${API}/api/auth/export`);
  expect(errors).toEqual([]);
});

test('account page fits a phone screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await mockApi(page, { user: { username: 'tester', email: 'tester@test.local', createdAt: '2026-01-01 00:00:00' } });
  await page.goto('/#/account');
  await expect(page.locator('#delete-account')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('forgot password: login links to it, and a missing mail service is explained', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page);
  await page.route(`${API}/api/auth/forgot`, (route) => reply(route, { error: 'Password reset by email isn’t set up on this site yet.' }, 503));
  await page.goto('/#/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await page.fill('#email', 'someone@test.local');
  await page.click('#forgot-form button[type="submit"]');
  await expect(page.locator('#auth-error')).toContainText('isn’t set up');
  expect(errors).toEqual([]);
});

test('reset password: a good link saves and goes to login', async ({ page }) => {
  await mockApi(page);
  let body;
  await page.route(`${API}/api/auth/reset`, (route) => { body = route.request().postDataJSON(); return route.fulfill({ status: 204, headers: HEADERS }); });
  await page.goto(`/#/reset-password?token=${'a'.repeat(64)}`);
  await page.fill('#password', 'resethorse789');
  await page.click('#reset-form button[type="submit"]');
  await expect(page).toHaveURL(/#\/login$/);
  expect(body).toEqual({ token: 'a'.repeat(64), password: 'resethorse789' });
});

test('profile has a share button that copies the preview link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockApi(page);
  await page.addInitScript(() => { delete Navigator.prototype.share; });
  await page.goto('/#/u/tester');
  await page.getByRole('button', { name: /Share profile/ }).click();
  await expect(page.getByText('Link copied!')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${API}/api/share/u/tester`);
});

test('reviews by other people can be reported; your own can\'t', async ({ page }) => {
  const errors = watchErrors(page);
  const anime = POOL[0];
  await mockApi(page, { user: { username: 'tester' } });
  await page.route(`${API}/api/anime/${anime.mal_id}/full`, (route) => reply(route, { data: anime }));
  await page.route(`${API}/api/episode-guide/${anime.mal_id}`, (route) => reply(route, { minVotes: 3, episodes: [], clicksAt: null, clickVotes: 0 }));
  await page.route(`${API}/api/reviews/${anime.mal_id}`, (route) => reply(route, {
    reviews: [
      { id: 7, rating: 2, body: 'spam here', username: 'someone', created_at: '2026-09-01', updated_at: '2026-09-01' },
      { id: 8, rating: 9, body: 'mine', username: 'tester', created_at: '2026-09-01', updated_at: '2026-09-01' },
    ],
    average: 5.5,
    count: 2,
    myReview: { rating: 9, body: 'mine' },
  }));
  let report;
  await page.route(`${API}/api/review-reports`, (route) => { report = route.request().postDataJSON(); return reply(route, { ok: true }, 201); });
  page.on('dialog', (d) => d.accept('spam'));
  await page.goto(`/#/anime/${anime.mal_id}`);
  await expect(page.locator('.review-card')).toHaveCount(2);
  await expect(page.locator('.review-report')).toHaveCount(1);
  await page.locator('.review-report').click();
  await expect(page.getByText('an admin will take a look')).toBeVisible();
  expect(report).toEqual({ kind: 'anime', reviewId: 7, reason: 'spam' });
  await expect(page.getByRole('button', { name: /SHARE/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('admin review queue hides a reported review', async ({ page }) => {
  const errors = watchErrors(page);
  await mockApi(page, { user: { username: 'boss', isAdmin: true } });
  await page.route(`${API}/api/admin/review-reports`, (route) => reply(route, {
    reports: [{ kind: 'anime', reviewId: 7, reports: 2, reasons: 'spam | ads', rating: 1, body: 'buy stuff', title_id: 1001, username: 'spammer' }],
  }));
  let hidden = null;
  await page.route(`${API}/api/admin/review-reports/anime/7/hide`, (route) => { hidden = true; return reply(route, { ok: true }); });
  await page.goto('/#/admin/reviews');
  await expect(page.getByText('buy stuff')).toBeVisible();
  await page.getByRole('button', { name: 'Hide review' }).click();
  await expect(page.getByText('Review hidden.')).toBeVisible();
  await expect(page.getByText('buy stuff')).toHaveCount(0);
  expect(hidden).toBe(true);
  expect(errors).toEqual([]);
});

test('admin review queue is not shown to non-admins', async ({ page }) => {
  await mockApi(page, { user: { username: 'tester' } });
  await page.goto('/#/admin/reviews');
  await expect(page.getByText('filler dimension')).toBeVisible();
});
