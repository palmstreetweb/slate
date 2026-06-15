import { test, expect } from '@playwright/test';

test.describe('Slate admin smoke', () => {
  test('dashboard loads', async ({ page }) => {
    await page.goto('/#/');
    await expect(page.getByRole('heading', { name: /your forms/i })).toBeVisible();
  });

  test('new form editor opens', async ({ page }) => {
    await page.goto('/#/forms/new');
    await expect(page.getByText('LIVE PREVIEW')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  });

  test('portable share route renders welcome', async ({ page }) => {
    await page.goto('/#/forms/new');
    await page.getByRole('button', { name: 'Share' }).click();
    const portableUrl = await page.locator('input.slate-share-url').first().inputValue();
    expect(portableUrl).toContain('#/r?d=');
    await page.goto(portableUrl);
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
  });

  test('form can be filled and submitted in preview', async ({ page }) => {
    await page.goto('/#/forms/new');
    await page.waitForURL(/#\/forms\/[^/]+\/edit/);
    const formId = page.url().match(/forms\/([^/]+)\/edit/)?.[1];
    expect(formId).toBeTruthy();
    await page.goto(`/#/forms/${formId}`);
    const preview = page.locator('.slate-preview');
    await preview.getByRole('button', { name: 'Start' }).click();
    await preview.getByRole('textbox').fill('Playwright test');
    await preview.getByRole('button', { name: 'OK' }).click();
    await expect(preview.getByText(/you're all set/i)).toBeVisible();
  });
});
