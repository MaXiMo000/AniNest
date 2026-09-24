import { test, expect } from '@playwright/test';
import { mockApi } from './mockApi.js';

test('taste quiz: answer all questions (with a back step) and get three picks', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockApi(page);
  await page.goto('/#/games/quiz');
  await page.locator('.quiz-option').first().click();
  await page.locator('#quiz-back').click();
  await expect(page.getByText(/Question 1 of 8/)).toBeVisible();
  for (let i = 0; i < 8; i += 1) await page.keyboard.press(String((i % 4) + 1));
  await expect(page.getByText('Your top 3 picks')).toBeVisible();
  await expect(page.locator('.quiz-pick')).toHaveCount(3);
  await expect(page.locator('.persona-title')).not.toBeEmpty();
  expect(errors).toEqual([]);
});
