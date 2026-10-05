import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schema } from '../src/index.js';

const state = vi.hoisted(() => ({
  cloud: true,
  form: null as Record<string, unknown> | null,
  playUiSound: vi.fn(),
}));

vi.mock('../examples/_admin/_formsStore.js', () => ({
  getForm: () => state.form,
  publishForm: vi.fn(),
  unpublishForm: vi.fn(),
  subscribe: () => () => {},
  hasUnpublishedChanges: () => false,
  setFormFillPassword: vi.fn(),
  supportsCloseSettings: () => true,
}));
vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => state.cloud }));
vi.mock('../examples/_admin/neon/publicApi.js', () => ({
  publicFillUrl: (slug: string) => `https://slate.test/forms/${slug}`,
}));
vi.mock('../examples/_admin/shareQr.js', () => ({
  readShareQrStyle: () => 'swiss',
  writeShareQrStyle: vi.fn(),
  renderShareQr: () => Promise.resolve('data:image/png;base64,AAAA'),
  SHARE_QR_DISPLAY_PX: 196,
  SHARE_QR_STYLES: [{ id: 'swiss', label: 'Swiss', description: '' }],
}));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: state.playUiSound }));
vi.mock('../examples/_admin/toast.js', () => ({ useToast: () => ({ push: vi.fn() }) }));
vi.mock('../examples/_admin/useFocusTrap.js', () => ({ useFocusTrap: vi.fn() }));
vi.mock('../examples/_admin/lockBodyScroll.js', () => ({ lockBodyScroll: () => () => {} }));

import { SharePanel } from '../examples/_admin/components/SharePanel.js';
import { EMBED_TOP_SCRIPT, buildEmbedSnippet } from '../examples/_admin/shareUrls.js';

const schema = {
  brand: { name: 'T' },
  theme: 'editorial',
  questions: [
    { id: 'w', type: 'welcome', title: 'Hi', cta: 'Go' },
    { id: 't', type: 'thanks', title: 'Done' },
  ],
} as unknown as Schema;

const published = {
  id: 'f_1',
  name: 'Crew',
  slug: '48210377',
  status: 'published',
  schema,
  publishedSchema: schema,
};

function open(formName = 'Crew') {
  return render(
    <SharePanel open onClose={() => {}} formId="f_1" formName={formName} schema={schema} />,
  );
}

beforeEach(() => {
  state.cloud = true;
  state.form = { ...published };
  state.playUiSound.mockReset();
});

describe('embed snippet (ADR-054)', () => {
  it('frames the public link in embed mode with the agreed attributes', () => {
    // Most of the screen tall, at least 560 px (GAP-25): not a small box that
    // scrolls inside the host page on a phone.
    expect(buildEmbedSnippet('https://slate.test/forms/48210377', 'Crew')).toBe(
      '<iframe src="https://slate.test/forms/48210377?embed=1" title="Crew" ' +
        'style="width:100%;height:85vh;height:85svh;min-height:560px;border:0" loading="lazy"></iframe>\n' +
        EMBED_TOP_SCRIPT,
    );
  });

  it('the host script brings the frame’s top back into view on a new question, for its own frame only (GAP-25)', () => {
    document.body.innerHTML = buildEmbedSnippet('https://slate.test/forms/1', 'Crew');
    const frame = document.querySelector('iframe')!;
    // innerHTML never runs scripts; run the snippet's own, as the host page's parser would.
    const code = document.querySelector('script')!.textContent!;
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get: () => document.querySelector('script'),
    });
    const listeners: Array<(e: MessageEvent) => void> = [];
    const add = vi.spyOn(window, 'addEventListener').mockImplementation(((
      type: string,
      fn: never,
    ) => {
      if (type === 'message') listeners.push(fn);
    }) as never);
    new Function(code.replace(/^<script>|<\/script>$/g, ''))();
    add.mockRestore();
    delete (document as { currentScript?: unknown }).currentScript;
    expect(listeners).toHaveLength(1);
    const scrolled = vi.fn();
    frame.scrollIntoView = scrolled;
    const send = (source: unknown, top: number) => {
      frame.getBoundingClientRect = () => ({ top }) as DOMRect;
      listeners[0]!({ source, data: { type: 'slate:top' } } as MessageEvent);
    };
    send(frame.contentWindow, -300); // scrolled past the frame: back into view
    expect(scrolled).toHaveBeenCalledTimes(1);
    send(frame.contentWindow, 40); // already in view: left alone
    send({}, -300); // another window's message: ignored
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('escapes the form name so it cannot break out of the title attribute', () => {
    const html = buildEmbedSnippet(
      'https://slate.test/forms/1',
      `Tom & Jerry's "quote" <script>x</script>`,
    );
    expect(html).toContain(
      'title="Tom &amp; Jerry&#39;s &quot;quote&quot; &lt;script&gt;x&lt;/script&gt;"',
    );
    // No script from the name: only the snippet's own, after the frame.
    expect(html.split('<script>')).toHaveLength(2);
    expect(html.endsWith(EMBED_TOP_SCRIPT)).toBe(true);
    // One element, attributes intact.
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const frames = doc.querySelectorAll('iframe');
    expect(frames).toHaveLength(1);
    expect(frames[0]!.getAttribute('title')).toBe(`Tom & Jerry's "quote" <script>x</script>`);
    expect(frames[0]!.getAttribute('src')).toBe('https://slate.test/forms/1?embed=1');
  });

  it('blank name still gives the frame a title', () => {
    expect(buildEmbedSnippet('https://slate.test/forms/1', '  ')).toContain('title="Form"');
  });
});

describe('Share panel Embed button (ADR-054)', () => {
  it('sits in the actions row and copies the iframe snippet', async () => {
    const user = userEvent.setup();
    open(`Crew & "Co"`);
    const embed = screen.getByRole('button', { name: 'Embed' });
    // Same row as "Open in browser" — no new section.
    expect(embed.closest('.slate-share-actions')).toBe(
      screen.getByRole('link', { name: /Open in browser/ }).closest('.slate-share-actions'),
    );

    await user.click(embed);

    const copied = await navigator.clipboard.readText();
    expect(copied).toContain('src="https://slate.test/forms/48210377?embed=1"');
    expect(copied).toContain('title="Crew &amp; &quot;Co&quot;"');
    expect(copied.startsWith('<iframe ')).toBe(true);
    expect(screen.getByRole('button', { name: 'Copied embed code' })).toBeTruthy();
    expect(state.playUiSound).toHaveBeenCalledWith('copy');
    // The share link field itself is untouched.
    expect((screen.getByLabelText('Share URL') as HTMLInputElement).value).toBe(
      'slate.test/forms/48210377',
    );
  });

  it('is absent while the form is unpublished', () => {
    state.form = { ...published, status: 'draft' };
    open();
    expect(screen.queryByRole('button', { name: 'Embed' })).toBeNull();
  });

  it('is absent in localStorage / offline mode (no public link to frame)', () => {
    state.cloud = false;
    open();
    expect(screen.getByLabelText('Share URL')).toBeTruthy(); // portable link still offered
    expect(screen.queryByRole('button', { name: 'Embed' })).toBeNull();
  });
});
