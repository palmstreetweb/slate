/**
 * Responses views and Wave B (ADR-064): a drawn signature renders as its
 * strokes (and only a path the strict parser accepts reaches the SVG), the
 * estimate shows as a fact with its lines, the Summary gets an estimates
 * card and a service-area chart, and a contact block names the respondent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Estimate, Question } from '../src/index.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';

vi.mock('../examples/_admin/neon/env.js', () => ({ isNeonConfigured: () => false }));
vi.mock('../examples/_admin/uiSounds.js', () => ({ playUiSound: vi.fn() }));
vi.mock('../examples/_admin/components/ResponseFileAnswer.js', () => ({
  ResponseFileAnswer: () => <span>file preview</span>,
}));

import { ResponseAnswers } from '../examples/_admin/responses/ResponseAnswers.js';
import { EstimateBreakdown } from '../examples/_admin/responses/ResponseEstimate.js';
import { ResponsesSummary } from '../examples/_admin/responses/ResponsesSummary.js';

const questions: Question[] = [
  { id: 'who', type: 'contact_info', title: 'How can we reach you?' },
  { id: 'addr', type: 'address', title: 'Job address', serviceArea: ['931'] },
  { id: 'sig', type: 'signature', title: 'Sign to approve' },
];

const estimate: Estimate = {
  low: 5950,
  high: 7150,
  currency: 'USD',
  lines: [
    { id: '_base', label: 'Service call', low: 150, high: 150 },
    { id: 'plan', label: 'Standard', low: 5200, high: 6100 },
    { id: 'n', label: 'Skylights', qty: 2, low: 600, high: 900 },
  ],
};

function sub(id: string, answers: Record<string, unknown>, est?: Estimate): StoredSubmission {
  return {
    id,
    formId: 'f1',
    receivedAt: new Date(2026, 8, 29, 10, Number(id.slice(1))).toISOString(),
    answers: answers as StoredSubmission['answers'],
    meta: {
      startedAt: '',
      completedAt: '',
      durationMs: 60_000,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
      ...(est ? { estimate: est } : {}),
    },
  };
}

function wrap(node: React.ReactNode) {
  return render(
    <div data-slate-forms="" data-theme-name="slate">
      <div className="slate-rsp">{node}</div>
    </div>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollTo ??= vi.fn();
  window.scrollTo = vi.fn() as never;
});

describe('ResponseAnswers', () => {
  it('draws a signature from its stored path', () => {
    const { container } = wrap(
      <ResponseAnswers
        questions={questions}
        answers={{ sig: { path: 'M40 150l50 -90 50 90' } }}
        layout="stack"
      />,
    );
    const img = screen.getByRole('img', { name: 'Signature for “Sign to approve”' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img.getAttribute('viewBox')).toBe('0 0 500 200');
    expect(container.querySelector('path')!.getAttribute('d')).toBe('M40 150l50 -90 50 90');
  });

  it('never puts an unparseable path into the SVG', () => {
    const { container } = wrap(
      <ResponseAnswers
        questions={questions}
        answers={{ sig: { path: 'M0 0"/><script>alert(1)</script>' } }}
        layout="stack"
      />,
    );
    expect(container.querySelector('path')).toBeNull();
    expect(screen.getByText('Signed (drawing unreadable)')).toBeInTheDocument();
  });

  it('shows a typed signature, a contact block and an address as text', () => {
    wrap(
      <ResponseAnswers
        questions={questions}
        answers={{
          sig: { typed: 'Ada Lovelace' },
          who: { name: 'Ada Lovelace', email: 'ada@example.com' },
          addr: { street: '1 Main St', city: 'Fresno', region: 'CA', postal: '93701' },
        }}
        layout="grid"
      />,
    );
    expect(screen.getByText('Typed: Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/ada@example\.com/)).toBeInTheDocument();
    expect(
      screen.getByText('1 Main St, Fresno, CA 93701 (outside service area)'),
    ).toBeInTheDocument();
  });
});

describe('EstimateBreakdown', () => {
  it('lists each line with its quantity and amount', () => {
    wrap(<EstimateBreakdown estimate={estimate} />);
    const list = screen.getByRole('list', { name: 'How the estimate adds up' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[2]).toHaveTextContent('Skylights × 2$600 – $900');
  });

  it('a single line needs no breakdown', () => {
    const { container } = wrap(
      <EstimateBreakdown estimate={{ ...estimate, lines: estimate.lines.slice(0, 1) }} />,
    );
    expect(container.querySelector('ul')).toBeNull();
  });
});

describe('ResponsesSummary', () => {
  const subs = [
    sub('s3', { who: { name: 'Ada Lovelace' }, addr: { postal: '93101' } }, estimate),
    sub(
      's2',
      { who: { name: 'Kai Nakamura' }, addr: { postal: '93701' } },
      { ...estimate, low: 2050, high: 2850 },
    ),
    sub('s1', { addr: { postal: '93105' } }),
  ];

  function renderSummary() {
    return wrap(
      <ResponsesSummary
        formId="f1"
        formName="Roof quote"
        questions={questions}
        subs={subs}
        unread={new Set()}
        onMarkRead={vi.fn()}
        onMarkUnread={vi.fn()}
        onTrash={vi.fn()}
      />,
    );
  }

  it('has an estimates card with the average, range and total', () => {
    renderSummary();
    const card = screen.getByRole('article', { name: /instant estimates/i });
    expect(within(card).getByText('2 estimates')).toBeInTheDocument();
    // (6550 + 2450) / 2 = 4500
    expect(within(card).getAllByText('$4,500').length).toBeGreaterThan(0);
    expect(card.querySelector('.rsp-sum-estimate-range')).toHaveTextContent('$2,050 – $7,150');
    expect(within(card).getByText('$9,000')).toBeInTheDocument();
  });

  it('charts the address inside / outside the service area and lists the ZIPs', () => {
    renderSummary();
    const card = screen.getByRole('article', { name: /job address/i });
    expect(
      within(card).getByRole('button', { name: /^in area: 2 responses/i }),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: /^out of area: 1 response/i }),
    ).toBeInTheDocument();
    expect(within(card).getByText('ZIP codes')).toBeInTheDocument();
  });

  it('names respondents from the contact block', () => {
    renderSummary();
    const names = Array.from(document.querySelectorAll('.rsp-sum-c-name')).map(
      (n) => n.textContent,
    );
    expect(names).toContain('Ada Lovelace');
    expect(names).toContain('Kai Nakamura');
  });
});
