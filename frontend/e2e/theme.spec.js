import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('theme toggle switches to light, survives a reload, and switches back', async ({ page }) => {
  await mockApi(page);
  await page.goto('/#/games');
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', 'light');
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('#theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bgLight).not.toBe(bgDark);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#fff6e0');
  await page.locator('#theme-toggle').click();
  await expect(html).not.toHaveAttribute('data-theme', 'light');
});
