import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('profile shows the taste dashboard with a labeled status bar and genre bars', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page);
  await page.goto('/#/u/tester');
  await expect(page.getByRole('heading', { name: /Taste Dashboard/ })).toBeVisible();
  await expect(page.locator('.status-legend li')).toHaveCount(4);
  await expect(page.locator('.genre-bar')).toHaveCount(8);
  await expect(page.getByText('Completion rate')).toBeVisible();
  expect(errors).toEqual([]);
});
