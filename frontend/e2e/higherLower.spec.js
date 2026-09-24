import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('higher or lower: switch mode, guess with the keyboard, skip once', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page);
  await page.goto('/#/games/higher-lower');
  await page.getByRole('tab', { name: /Episodes/ }).click();
  await expect(page).toHaveURL(/mode=episodes/);
  await expect(page.locator('.hl-question')).toContainText('episode count');

  await page.locator('#skip').click();
  await expect(page.locator('#skip')).toBeDisabled();

  for (let i = 0; i < 60 && !(await page.getByText('GAME OVER').isVisible()); i += 1) {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(1500);
  }
  await expect(page.getByText('GAME OVER')).toBeVisible();
  await expect(page.getByText(/Episodes mode/)).toBeVisible();
  expect(errors).toEqual([]);
});
