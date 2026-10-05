import { test, expect, type Page } from '@playwright/test';

/**
 * Review fixes of 2026-10-05, the final QA check, on a real layout engine
 * (jsdom has none): picture choice labels keep whole words on a phone's
 * two-column grid, and the swipe deck's "You can like up to …" is brought
 * fully into view. Portable links open in the offline studio.
 */

const b64url = (s: string) =>
  Buffer.from(s, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const portable = (theme: string, question: object) =>
  '/r?d=' +
  b64url(
    JSON.stringify({
      v: 1,
      schema: {
        brand: { name: 'QA' },
        theme,
        themeMode: 'light',
        questions: [question, { id: 'done', type: 'thanks', title: 'Thanks!' }],
      },
    }),
  );

const picture = (i: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#${i}${i}${i}"/></svg>`,
  )}`;

/** Words of four letters or more in the live question that are split across lines. */
function brokenWords(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = [...document.querySelectorAll('.slate-stage-content')].pop();
    if (!root) return ['no stage'];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent ?? '';
      for (const m of text.matchAll(/[A-Za-z]{4,}/g)) {
        const r = document.createRange();
        r.setStart(n, m.index!);
        r.setEnd(n, m.index! + m[0].length);
        const tops = new Set(
          [...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)),
        );
        if (tops.size > 1) out.push(m[0]);
      }
    }
    return out;
  });
}

test.describe('picture choice labels keep whole words on a phone', () => {
  for (const width of [360, 375]) {
    for (const theme of ['classic', 'midnight', 'editorial', 'swiss']) {
      test(`${theme} at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 740 });
        await page.goto(
          portable(theme, {
            id: 'style',
            type: 'picture_choice',
            title: 'Pick a style',
            options: ['Contemporary', 'Traditional', 'Mediterranean', 'Scandinavian'].map(
              (label, i) => ({ label, value: `v${i}`, src: picture(i + 3) }),
            ),
          }),
        );
        await expect(page.locator('.slate-picture').first()).toBeVisible();
        expect(await brokenWords(page)).toEqual([]);
      });
    }
  }
});

test('the swipe deck’s “You can like up to …” is fully in view on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(
    portable('editorial', {
      id: 'sw',
      type: 'picture_choice',
      display: 'swipe',
      multiple: true,
      max: 1,
      title: 'Swipe right on the ones you like, there are several to go through',
      options: ['A', 'B', 'C', 'D'].map((x, i) => ({
        label: `Pic ${x}`,
        value: `p${i}`,
        src: picture(i + 3),
      })),
    }),
  );
  const like = page.locator('.slate-swipe-btn--like');
  await like.click();
  await page.waitForTimeout(700);
  await like.click({ force: true });
  const message = page.getByText(/^You can like up to 1\./);
  await expect(message).toBeVisible();
  await page.waitForTimeout(600);
  const box = await message.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
});
