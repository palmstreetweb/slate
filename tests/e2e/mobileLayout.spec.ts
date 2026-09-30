import { test, expect, type Page } from '@playwright/test';

/**
 * ADR-062 regression: at phone widths the studio is never wider than the
 * phone. Mobile browsers widen the layout viewport to fit overflowing content
 * (a 375px iPhone reported innerWidth 506), so the check is
 * scrollWidth === innerWidth === the device width, under touch emulation.
 */

const WIDTHS = [360, 375, 390, 430];

/** A sign-up form with responses (ADR-066), written straight into the offline stores. */
function seedSignup() {
  const id = 'local_e2e_signup';
  const now = new Date().toISOString();
  const schema = {
    id,
    brand: { name: 'Pool' },
    theme: 'classic',
    themeMode: 'light',
    questions: [
      { id: 'welcome', type: 'welcome', title: 'Pool party' },
      { id: 'name', type: 'short_text', title: 'Your name?' },
      {
        id: 'swim',
        type: 'signup_slots',
        title: 'Pick a time',
        waitlist: true,
        slots: [
          {
            label: 'Morning swim',
            value: 's_am',
            capacity: 2,
            date: '2026-10-03',
            start: '10:00',
            end: '11:00',
          },
          {
            label: 'Late morning with a long name',
            value: 's_late',
            capacity: 1,
            date: '2026-10-03',
            start: '11:00',
            end: '12:00',
            description: 'Meet at the side gate by the palms',
          },
          { label: 'Bring drinks', value: 's_drinks', capacity: 3 },
        ],
      },
      { id: 'done', type: 'thanks', title: 'Thanks' },
    ],
  };
  const forms = JSON.parse(localStorage.getItem('slate-forms') ?? '[]').filter(
    (f: { id: string }) => f.id !== id,
  );
  forms.unshift({
    id,
    name: 'Pool party',
    slug: '55667788',
    createdAt: now,
    updatedAt: now,
    schema,
    publishedSchema: schema,
    status: 'published',
  });
  localStorage.setItem('slate-forms', JSON.stringify(forms));
  const meta = {
    startedAt: now,
    completedAt: now,
    durationMs: 1000,
    questionsVisited: [],
    hiddenFields: {},
    score: 0,
  };
  const subs = [
    {
      id: 's_e2e1',
      formId: id,
      receivedAt: now,
      answers: { name: 'Ada Lovelace', swim: { slots: ['s_late'] } },
      meta,
    },
    {
      id: 's_e2e2',
      formId: id,
      receivedAt: now,
      answers: { name: 'Grace Hopper', swim: { slots: [], wait: ['s_late'] } },
      meta,
    },
  ];
  localStorage.setItem('slate-submissions', JSON.stringify(subs));
  localStorage.setItem('slate-responses-view', 'summary');
  return id;
}

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

    test('sign-up slots: inspector, test run and roster fit (ADR-066)', async ({ page }) => {
      await page.goto('/');
      const id = await page.evaluate(seedSignup);

      await page.goto(`/forms/${id}/edit`);
      await page.getByText('Pick a time', { exact: true }).click();
      await expect(page.locator('.slate-insp-slots')).toBeVisible();
      await expectFits(page, width, 'sign-up inspector');

      await page.goto(`/forms/${id}/preview`);
      await page.getByRole('button', { name: /start/i }).click();
      await page.getByRole('textbox').fill('Sam');
      await page.keyboard.press('Enter');
      await expect(page.locator('.slate-slot').first()).toBeVisible();
      await expect(page.getByRole('radio', { name: /^Late morning/ })).toHaveAccessibleName(
        /Full · join the waitlist$/,
      );
      await expectFits(page, width, 'sign-up slots');

      await page.goto(`/forms/${id}/submissions`);
      await expect(page.locator('.rsp-sum-roster')).toBeVisible();
      await expectFits(page, width, 'sign-up roster');
    });
  });
}
