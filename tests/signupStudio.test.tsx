/**
 * Sign-up slots in the studio (ADR-066): fresh slot keys and the next slot,
 * the inspector with live "signed up" counts and a confirm before removing a
 * slot people took, the roster (who took each slot, the waitlist, removed
 * slots) and its move menu, the local move, Responses text and CSV columns,
 * the fill page's counts and 409 handling, the logic editor, portable schemas
 * and Build with AI.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question, SignupSlotsQuestion } from '@/index.js';
import { WAITLIST_VALUE } from '@/index.js';
import type { StoredSubmission } from '../examples/_admin/_submissionStore.js';
import { moveSignupSlot, listSubmissions } from '../examples/_admin/_submissionStore.js';
import {
  localSlotsLeft,
  mergeSlotsLeft,
  newSlotValue,
  signupRoster,
  slotFullMessage,
  takenCounts,
} from '../examples/_admin/signupSlots.js';
import { SignupSlotsSettings, nextSlot } from '../examples/_admin/components/InspectorWaveD.js';
import { ConditionBuilder } from '../examples/_admin/components/LogicEditor.js';
import { SignupRosterCard } from '../examples/_admin/responses/SummaryWaveD.js';
import { answerMatchesFilter, tableColumns } from '../examples/_admin/responses/model.js';
import { csvParts, formatAnswerForQuestion } from '../examples/_admin/responsesFormat.js';
import { buildResponsesCsv } from '../examples/_admin/csvExport.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';
import { slugRowToPublishedForm } from '../examples/_admin/neon/mappers.js';
import { ConfirmProvider } from '../examples/_admin/_confirm.js';
import { mapGeneratedForm, blankGeneratedQuestion } from '../api/mapGeneratedForm.js';
import { generatedFormSchema, withDraftDefaults } from '../api/generateFormSchema.js';

const FORM = 'local_waved_test';

const swim: SignupSlotsQuestion = {
  id: 'swim',
  type: 'signup_slots',
  title: 'Pick a time',
  waitlist: true,
  slots: [
    {
      label: 'Morning',
      value: 's_am',
      capacity: 2,
      date: '2026-10-03',
      start: '10:00',
      end: '11:00',
    },
    {
      label: 'Noon',
      value: 's_noon',
      capacity: 1,
      date: '2026-10-03',
      start: '12:00',
      end: '13:00',
    },
  ],
};
const nameQ: Question = { id: 'name', type: 'short_text', title: 'Your name?' };

function sub(id: string, minutesAgo: number, answers: Record<string, unknown>): StoredSubmission {
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    formId: FORM,
    receivedAt: at,
    answers: answers as StoredSubmission['answers'],
    meta: {
      startedAt: at,
      completedAt: at,
      durationMs: 60_000,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
    },
  };
}

const SUBS = [
  sub('s1', 50, { name: 'Ada', swim: { slots: ['s_am'] } }),
  sub('s2', 40, { name: 'Grace', swim: { slots: ['s_noon'] } }),
  sub('s3', 30, { name: 'Alan', swim: { slots: ['s_am'] } }),
  sub('s4', 20, { name: 'Radia', swim: { slots: [], wait: ['s_noon'] } }),
  sub('s5', 10, { name: 'Ken', swim: { slots: ['s_gone'] } }),
];

function seed(subs: StoredSubmission[]) {
  window.localStorage.setItem('slate-submissions', JSON.stringify(subs));
}

beforeEach(() => window.localStorage.clear());

// jsdom has no layout; the studio's select scrolls its highlighted option into view.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

describe('slot keys and the next slot', () => {
  it('new keys are unique, valid and never reuse one in the list', () => {
    const keys: string[] = [];
    for (let i = 0; i < 200; i++) keys.push(newSlotValue(keys));
    expect(new Set(keys).size).toBe(200);
    for (const k of keys) expect(k).toMatch(/^s_[a-z0-9]{6}$/);
  });

  it('the next slot follows the last: same day and spots, starting when it ends', () => {
    const next = nextSlot(swim.slots);
    expect(next).toMatchObject({ date: '2026-10-03', capacity: 1, start: '13:00', end: '14:00' });
    expect(next.value).not.toBe('s_am');
    expect(nextSlot([])).toMatchObject({ label: 'Slot 1', capacity: 8 });
    expect(nextSlot([{ label: 'A', value: 'a', capacity: 3, start: '09:30' }])).toMatchObject({
      start: '10:30',
      capacity: 3,
    });
    expect(nextSlot([{ label: 'Drinks', value: 'a', capacity: 3 }])).not.toHaveProperty('start');
  });
});

describe('the roster', () => {
  it('lists who took each slot oldest first, the waitlist in order, and removed slots last', () => {
    const roster = signupRoster(swim, SUBS, (s) => String(s.answers.name));
    expect(
      roster.map((r) => [r.value, r.taken.map((e) => e.name), r.waiting.map((e) => e.name)]),
    ).toEqual([
      ['s_am', ['Ada', 'Alan'], []],
      ['s_noon', ['Grace'], ['Radia']],
      ['s_gone', ['Ken'], []],
    ]);
    expect(roster[2]!.slot).toBeUndefined();
    expect(takenCounts(swim, SUBS)).toEqual(
      new Map([
        ['s_am', 2],
        ['s_noon', 1],
        ['s_gone', 1],
      ]),
    );
    expect(localSlotsLeft([swim, nameQ], SUBS)).toEqual({ swim: { s_am: 0, s_noon: 0 } });
  });

  it('the card shows fill, full, the waitlist and removed slots, and moves people', async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    render(
      <div data-slate-forms="" data-theme-name="slate">
        <div className="slate-rsp">
          <div className="rsp-sum">
            <SignupRosterCard
              question={swim}
              number={2}
              subs={SUBS}
              questions={[nameQ, swim]}
              onMove={onMove}
            />
          </div>
        </div>
      </div>,
    );
    expect(screen.getByText('3 of 3 spots taken · 1 waiting')).toBeInTheDocument();
    expect(screen.getAllByText('Full · 2 of 2')).toHaveLength(1);
    expect(screen.getByText('Full · 1 of 1')).toBeInTheDocument();
    expect(screen.getByText('No longer on the form')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 of 2 spots taken' })).toBeInTheDocument();
    const waitlist = screen.getByRole('list', { name: 'Waitlist for Noon' });
    expect(within(waitlist).getByText('Radia')).toBeInTheDocument();

    await user.click(within(waitlist).getByRole('button', { name: 'Move Radia' }));
    expect(
      screen.getByRole('menuitem', { name: 'Give them a spot anyway (full)' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Move to Morning · full' }));
    expect(onMove).toHaveBeenCalledWith(
      expect.objectContaining({ from: 's_noon', to: 's_am', toName: 'Morning', capacity: 2 }),
    );
  });

  it('filters and table columns know the slot', () => {
    expect(answerMatchesFilter(SUBS[0]!, { questionId: 'swim', value: 's_am' }, swim)).toBe(true);
    expect(answerMatchesFilter(SUBS[3]!, { questionId: 'swim', value: WAITLIST_VALUE }, swim)).toBe(
      true,
    );
    expect(answerMatchesFilter(SUBS[0]!, { questionId: 'swim', value: 's_noon' }, swim)).toBe(
      false,
    );
    expect(tableColumns([nameQ, swim]).choices.map((q) => q.id)).toEqual(['swim']);
  });
});

describe('moving someone (local mode)', () => {
  it('moves into a slot with room, refuses a full one unless forced, and knows a stale pick', async () => {
    seed(SUBS);
    const ok = await moveSignupSlot({
      submissionId: 's4',
      questionId: 'swim',
      from: 's_noon',
      to: 's_am',
      capacity: 3,
    });
    expect(ok).toEqual({ ok: true });
    expect(listSubmissions(FORM).find((s) => s.id === 's4')!.answers.swim).toEqual({
      slots: ['s_am'],
    });
    const full = await moveSignupSlot({
      submissionId: 's1',
      questionId: 'swim',
      from: 's_am',
      to: 's_noon',
      capacity: 1,
    });
    expect(full).toEqual({ ok: false, reason: 'full', taken: 1, capacity: 1 });
    const forced = await moveSignupSlot({
      submissionId: 's1',
      questionId: 'swim',
      from: 's_am',
      to: 's_noon',
      capacity: 1,
      force: true,
    });
    expect(forced.ok).toBe(true);
    const stale = await moveSignupSlot({
      submissionId: 's1',
      questionId: 'swim',
      from: 's_am',
      to: 's_noon',
      capacity: 9,
    });
    expect(stale).toMatchObject({ ok: false, reason: 'gone' });
  });
});

describe('Responses text and CSV', () => {
  it('reads a slot with its day and time, marks waitlists and removed slots', () => {
    expect(formatAnswerForQuestion(swim, { slots: ['s_am'], wait: ['s_noon'] })).toBe(
      'Morning (Sat, Oct 3 · 10–11 AM)\nWaitlist: Noon (Sat, Oct 3 · 12–1 PM)',
    );
    expect(formatAnswerForQuestion(swim, { slots: ['s_gone'] })).toBe('Removed slot (s_gone)');
    expect(formatAnswerForQuestion(swim, { slots: [] })).toBe('—');
  });

  it('adds Slot and Waitlist columns', () => {
    expect(csvParts(swim)?.map((c) => c.label)).toEqual(['Slot', 'Waitlist']);
    expect(csvParts({ ...swim, waitlist: false })?.map((c) => c.label)).toEqual(['Slot']);
    const csv = buildResponsesCsv([nameQ, swim], SUBS.slice(0, 4));
    const [head, ...rows] = csv.split('\r\n');
    expect(head).toContain('Pick a time — Slot,Pick a time — Waitlist');
    expect(rows.some((r) => r.includes('Noon (Sat') && r.includes('Radia'))).toBe(true);
  });
});

describe('the inspector', () => {
  function renderSettings(onChange = vi.fn()) {
    seed(SUBS);
    render(
      <ConfirmProvider>
        <div data-slate-forms="" data-theme-name="slate">
          <SignupSlotsSettings question={swim} onChange={onChange} formId={FORM} />
        </div>
      </ConfirmProvider>,
    );
    return onChange;
  }

  it('shows how many signed up per slot, and adds the next slot', async () => {
    const user = userEvent.setup();
    const onChange = renderSettings();
    expect(screen.getByText('2 of 2 signed up')).toBeInTheDocument();
    expect(screen.getByText('1 of 1 signed up')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Slot 1 name' })).toHaveValue('Morning');
    await user.click(screen.getByRole('button', { name: /Add Slot/ }));
    const slots = onChange.mock.calls.at(-1)![0].slots as SignupSlotsQuestion['slots'];
    expect(slots).toHaveLength(3);
    expect(slots[2]).toMatchObject({ start: '13:00', end: '14:00', capacity: 1 });
  });

  it('asks before removing a slot people took', async () => {
    const user = userEvent.setup();
    const onChange = renderSettings();
    await user.click(screen.getByRole('button', { name: 'Remove Morning' }));
    expect(await screen.findByText(/2 people have signed up for it/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove slot' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect((onChange.mock.calls[0]![0].slots as unknown[]).length).toBe(1);
  });

  it('sets the most per person, the waitlist and the counts switch', async () => {
    const user = userEvent.setup();
    const onChange = renderSettings();
    await user.click(screen.getByRole('checkbox', { name: /Offer a Waitlist/ }));
    expect(onChange).toHaveBeenLastCalledWith({ waitlist: undefined });
    await user.click(screen.getByRole('checkbox', { name: /Show How Many Spots/ }));
    expect(onChange).toHaveBeenLastCalledWith({ showRemaining: false });
  });
});

describe('the logic editor', () => {
  it('offers "Took: <slot>" and "Joined a waitlist"', async () => {
    const user = userEvent.setup();
    render(
      <div data-slate-forms="" data-theme-name="slate">
        <ConditionBuilder
          value={{ field: 'swim', op: 'equals', value: '' }}
          onChange={vi.fn()}
          questions={[swim, nameQ]}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Answer' }));
    expect(screen.getByRole('option', { name: 'Took: Morning' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Joined a waitlist' })).toBeInTheDocument();
  });
});

describe('the fill page’s counts and messages', () => {
  it('names the slot that filled, and merges fresh counts', () => {
    expect(slotFullMessage([swim], [{ question: 'swim', slot: 's_am' }])).toBe(
      'Morning just filled up while you were answering. Please pick another or join its waitlist — your other answers are saved.',
    );
    expect(
      slotFullMessage(
        [{ ...swim, waitlist: false }],
        [
          { question: 'swim', slot: 's_am' },
          { question: 'swim', slot: 's_noon' },
        ],
      ),
    ).toBe(
      'Morning and Noon filled up while you were answering. Please pick another — your other answers are saved.',
    );
    expect(mergeSlotsLeft({ swim: { s_am: 2, s_noon: 1 } }, { swim: { s_am: 0 } })).toEqual({
      swim: { s_am: 0, s_noon: 1 },
    });
    expect(mergeSlotsLeft(undefined, null)).toBeUndefined();
  });

  it('keeps well-formed counts from the lookup', () => {
    const form = slugRowToPublishedForm({
      id: 'f',
      name: 'n',
      slug: '12345678',
      locked: false,
      schema: { brand: { name: 'x' }, questions: [] },
      slotsLeft: { swim: { s_am: 2, s_noon: -1, s_x: 1.5, s_y: '3' } },
    });
    expect(form && 'slotsLeft' in form ? form.slotsLeft : null).toEqual({ swim: { s_am: 2 } });
  });
});

describe('the fill page: a 409 slot_full', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('submitPublicResponse turns it into a SlotFullError, not a closed form', async () => {
    vi.resetModules();
    vi.doMock('../examples/_admin/neon/config.js', () => ({
      isNeonConfigured: () => true,
      getSubmitUrl: () => 'https://submit.invalid/',
    }));
    const api = await import('../examples/_admin/neon/publicApi.js');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Noon just filled up.',
          reason: 'slot_full',
          full: [{ question: 'swim', slot: 's_noon', label: 'Noon' }],
          slotsLeft: { swim: { s_am: 1, s_noon: 0 } },
        }),
        { status: 409 },
      ),
    );
    const err = await api
      .submitPublicResponse({
        formId: 'f_1',
        answers: {},
        meta: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          questionsVisited: [],
          hiddenFields: {},
        },
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(api.SlotFullError);
    expect((err as InstanceType<typeof api.SlotFullError>).full).toEqual([
      { question: 'swim', slot: 's_noon' },
    ]);
    expect((err as InstanceType<typeof api.SlotFullError>).slotsLeft).toEqual({
      swim: { s_am: 1, s_noon: 0 },
    });

    // A plain 409 (the response cap) is still a closed form.
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Full', reason: 'full' }), { status: 409 }),
    );
    const closed = await api
      .submitPublicResponse({
        formId: 'f_1',
        answers: {},
        meta: {
          startedAt: '',
          completedAt: '',
          durationMs: 0,
          questionsVisited: [],
          hiddenFields: {},
        },
      })
      .catch((e: unknown) => e);
    expect(closed).toBeInstanceOf(api.FormClosedError);

    // part=slots refresh
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'f_1', locked: false, slotsLeft: { swim: { s_am: 1 } } })),
    );
    expect(await api.fetchSlotsLeft('12345678')).toEqual({ swim: { s_am: 1 } });
    expect(String(fetchMock.mock.calls.at(-1)![0])).toBe(
      'https://submit.invalid/?op=form&slug=12345678&part=slots',
    );
    vi.doUnmock('../examples/_admin/neon/config.js');
  });
});

describe('portable schemas and Build with AI', () => {
  it('portable links keep valid slots only', () => {
    const out = sanitizeUntrustedSchema({
      brand: { name: 'x' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        {
          ...swim,
          maxPicks: 99,
          slots: [
            ...swim.slots,
            { label: 'Bad key', value: 'no spaces', capacity: 2 },
            { label: 'Huge', value: 'huge', capacity: 5000 },
            { label: 'Bad day', value: 'd', capacity: 2, date: 'soon', start: '9am' },
          ],
        },
      ],
    } as never);
    const q = out.questions[0] as SignupSlotsQuestion;
    expect(q.slots.map((s) => s.value)).toEqual(['s_am', 's_noon', 'd']);
    expect(q.slots[2]).toEqual({ label: 'Bad day', value: 'd', capacity: 2 });
    expect(q).not.toHaveProperty('maxPicks');
  });

  it('drafts sign-up slots from options: spots, day and times, most per person, waitlist', () => {
    const opt = (label: string, value: string, extra: Record<string, unknown> = {}) => ({
      label,
      value,
      src: '',
      alt: '',
      price: 0,
      priceMax: 0,
      features: [] as string[],
      badge: '',
      capacity: 0,
      date: '',
      start: '',
      end: '',
      ...extra,
    });
    const draft = {
      title: 'Volunteer shifts',
      description: 'Pick a shift.',
      theme: 'editorial' as const,
      welcome: { title: 'Welcome.', subtitle: 'Thanks for helping.', cta: 'Start' },
      questions: [
        blankGeneratedQuestion({
          id: 'name',
          type: 'short_text',
          title: 'Your name',
          required: true,
        }),
        blankGeneratedQuestion({
          id: 'shift',
          type: 'signup_slots',
          title: 'Pick a shift',
          required: true,
          max: 2,
          waitlist: true,
          options: [
            opt('Sat 9–12', 'sat_am', {
              capacity: 6,
              date: '2026-10-03',
              start: '09:00',
              end: '12:00',
            }),
            opt('Sat 12–3', 'sat_pm', {
              capacity: 0,
              date: 'October 3',
              start: '12:00',
              end: '11:00',
            }),
          ],
        }),
        blankGeneratedQuestion({ id: 'note', type: 'long_text', title: 'Anything else?' }),
      ],
      thanks: { title: 'Thank you.', subtitle: 'See you there.', cta: 'Submit another' },
      estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
    };
    expect(generatedFormSchema.safeParse(draft).success).toBe(true);
    const { schema } = mapGeneratedForm(draft);
    const q = schema.questions.find((x) => x.id === 'shift') as SignupSlotsQuestion;
    expect(q).toMatchObject({ type: 'signup_slots', maxPicks: 2, waitlist: true });
    expect(q.slots).toEqual([
      {
        label: 'Sat 9–12',
        value: 'sat_am',
        capacity: 6,
        date: '2026-10-03',
        start: '09:00',
        end: '12:00',
      },
      { label: 'Sat 12–3', value: 'sat_pm', capacity: 8, start: '12:00' },
    ]);
  });

  it('an older draft (before Wave D) still validates on revise', () => {
    const old = {
      title: 'x',
      description: 'y',
      theme: 'editorial',
      welcome: { title: 'Hi.', subtitle: '', cta: 'Start' },
      questions: [0, 1, 2].map((i) => {
        const q = blankGeneratedQuestion({ id: `q${i}`, type: 'short_text', title: 'T' }) as Record<
          string,
          unknown
        >;
        delete q.waitlist;
        return q;
      }),
      thanks: { title: 'Bye.', subtitle: '', cta: 'Again' },
    };
    expect(generatedFormSchema.safeParse(withDraftDefaults(old)).success).toBe(true);
  });
});
