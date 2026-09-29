import { test, expect, type Page } from '@playwright/test';

/**
 * ADR-062 regression: at phone widths the studio is never wider than the
 * phone. Mobile browsers widen the layout viewport to fit overflowing content
 * (a 375px iPhone reported innerWidth 506), so the check is
 * scrollWidth === innerWidth === the device width, under touch emulation.
 */

const WIDTHS = [360, 375, 390, 430];

async function expectFits(page: Page, width: number, label: string) {
  const m = await page.evaluate(() => ({
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(m, `${label} at ${width}px`).toEqual({ inner: width, scroll: width });
}

for (const width of WIDTHS) {
  test.describe(`studio at ${width}px`, () => {
    test.use({
      viewport: { width, height: 800 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test('dashboard, editor tabs, responses, settings and preview fit', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.slate-page-title')).toBeVisible();
      await expectFits(page, width, 'dashboard');

      const formId = await page.evaluate(
        () => (JSON.parse(localStorage.getItem('slate-forms') ?? '[]') as { id: string }[])[0]?.id,
      );
      expect(formId).toBeTruthy();

      await page.goto(`/forms/${formId}/edit`);
      await expect(page.getByRole('tab', { name: 'Outline' })).toBeVisible();
      await expectFits(page, width, 'editor outline');
      for (const tab of ['Preview', 'Welcome']) {
        await page.getByRole('tab', { name: tab }).click();
        await expectFits(page, width, `editor ${tab}`);
      }

      await page.goto(`/forms/${formId}/submissions`);
      await expect(page.locator('.slate-rsp')).toBeVisible();
      await expectFits(page, width, 'responses');

      await page.goto('/settings');
      await expect(page.locator('.slate-page-title')).toBeVisible();
      await expectFits(page, width, 'settings');

      await page.goto(`/forms/${formId}/preview`);
      await expect(page.locator('.slate-preview')).toBeVisible();
      await expectFits(page, width, 'preview');
    });
  });
}
