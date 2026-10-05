/**
 * Studio surfaces for Wave C (ADR-065): inspector settings, the logic
 * editor's in / out of area on a location, Responses (text, CSV columns,
 * pins over the photo, the week), Summary (like rates, locations, photos per
 * shot, the heatmap, the pin map), portable links, the embed snippet, and
 * Build with AI's grammar and mapper.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Question, Schema } from '@/index.js';
import { OUT_OF_AREA_VALUE, IN_AREA_VALUE } from '@/index.js';
import { imageKey } from '@/logic/pins.js';
import { Inspector } from '../examples/_admin/components/Inspector.js';
import { ConditionBuilder } from '../examples/_admin/components/LogicEditor.js';
import { parseLatLng } from '../examples/_admin/components/InspectorWaveC.js';
import {
  csvParts,
  formatAnswerForCsv,
  formatAnswerForQuestion,
  locationText,
} from '../examples/_admin/responsesFormat.js';
import { buildResponsesCsv } from '../examples/_admin/csvExport.js';
import {
  answerMatchesFilter,
  availabilityHeat,
  chartableQuestions,
  fileRefsOf,
  hasFiles,
  pinCloud,
  questionDistribution,
} from '../examples/_admin/responses/model.js';
import { ResponseAnswers } from '../examples/_admin/responses/ResponseAnswers.js';
import { AvailabilityHeatCard, PinCloudCard } from '../examples/_admin/responses/SummaryWaveC.js';
import { withOutOfAreaEnding } from '../examples/_admin/outOfArea.js';
import { asStoredAnswers } from '../examples/_admin/storedAnswers.js';
import { PublicRespond } from '../examples/_admin/pages/PublicRespond.js';
import { listSubmissions, type StoredSubmission } from '../examples/_admin/_submissionStore.js';
import { buildEmbedSnippet } from '../examples/_admin/shareUrls.js';
import { decodePortableSchema, encodePortableSchema } from '../examples/_admin/portableShare.js';
import { sanitizeUntrustedSchema } from '../examples/_admin/sanitizeUntrustedSchema.js';
import { ADDABLE_TYPES } from '../examples/_admin/questionTypeMeta.js';
import { mapGeneratedForm, blankGeneratedQuestion } from '../api/mapGeneratedForm.js';
import { generatedFormSchema, withDraftDefaults } from '../api/generateFormSchema.js';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollBy ??= vi.fn();
});

const PHOTO = 'https://example.com/house.jpg';
const pin: Question = {
  id: 'leak',
  type: 'image_pin',
  title: 'Where’s the leak?',
  image: PHOTO,
  maxPins: 3,
};
const voice: Question = { id: 'story', type: 'voice_note', title: 'Tell us' };
const loc: Question = {
  id: 'where',
  type: 'location',
  title: 'Where’s the job?',
  center: { lat: 34.4208, lng: -119.6982 },
  radius: 25,
};
const shots: Question = {
  id: 'shots',
  type: 'photo_checklist',
  title: 'Photos',
  items: [
    { label: 'Front', value: 'front' },
    { label: 'Roof', value: 'roof' },
  ],
};
const week: Question = {
  id: 'when',
  type: 'availability',
  title: 'When are you free?',
  days: ['mon', 'tue'],
  startTime: '09:00',
  endTime: '12:00',
};
const swipe: Question = {
  id: 'likes',
  type: 'picture_choice',
  title: 'Like?',
  display: 'swipe',
  multiple: true,
  options: [
    { label: 'Sage', value: 'sage', src: PHOTO },
    { label: 'Navy', value: 'navy', src: PHOTO },
  ],
};
const all = [pin, voice, loc, shots, week, swipe];

function sub(id: string, answers: Record<string, unknown>): StoredSubmission {
  return {
    id,
    formId: 'f1',
    receivedAt: new Date(2026, 8, 30, 10, Number(id.slice(1))).toISOString(),
    answers: answers as StoredSubmission['answers'],
    meta: {
      startedAt: '',
      completedAt: '',
      durationMs: 60_000,
      questionsVisited: [],
      hiddenFields: {},
      score: 0,
    },
  };
}

const REF = (n: string) =>
  `slate-file://storage:public/f1abc/0b8e4f5a-1c2d-4e3f-8a9b-0c1d2e3f4a5b/${n}`;
const subs = [
  sub('s1', {
    leak: { pins: ['0.4,0.3', '0.6,0.3'], notes: ['leak', ''] },
    where: { lat: '34.441', lng: '-119.812', area: 'in' },
    shots: { front: REF('front.jpg'), roof: REF('roof.jpg') },
    when: { mon: '09:00-11:00', tue: '10:00-11:00' },
    likes: ['sage'],
    story: { audio: REF('voice-note.webm'), sec: '42' },
  }),
  sub('s2', {
    leak: { pins: ['0.5,0.5'] },
    where: { lat: '34.052', lng: '-118.244', area: 'out' },
    shots: { front: REF('front2.jpg') },
    when: { mon: '10:00-11:00' },
    likes: [],
  }),
  sub('s3', { where: { typed: 'Goleta' }, likes: ['sage', 'navy'] }),
];

/* ---------- Responses text and CSV ---------- */

describe('Responses and CSV', () => {
  it('reads each Wave C answer in words', () => {
    expect(formatAnswerForQuestion(pin, subs[0]!.answers.leak)).toBe('Pin 1: leak\nPin 2');
    expect(formatAnswerForQuestion(voice, subs[0]!.answers.story)).toBe('Voice note (0:42)');
    expect(formatAnswerForQuestion(voice, { typed: 'It leaks' })).toBe('It leaks');
    expect(formatAnswerForQuestion(loc, subs[0]!.answers.where)).toBe(
      'Inside the service area · 6.6 mi away · 34.441, -119.812',
    );
    expect(locationText(loc as never, { zip: '93105', area: 'in' })).toBe(
      'ZIP 93105 · Inside the service area',
    );
    expect(formatAnswerForQuestion(loc, { typed: 'Goleta' })).toBe('Typed: Goleta');
    expect(formatAnswerForQuestion(shots, subs[1]!.answers.shots)).toBe(
      '1 of 2 photos\nFront: photo',
    );
    expect(formatAnswerForQuestion(week, subs[0]!.answers.when)).toBe('Mon 9–11 AM; Tue 10–11 AM');
    // Hostile values never throw.
    expect(() => formatAnswerForQuestion(pin, { pins: 'x' })).not.toThrow();
    expect(() => formatAnswerForQuestion(week, { toString: 1 })).not.toThrow();
  });

  it('CSV: a location, a checklist and a week get a column per part; pins say where', () => {
    // By default only the verdict is stored (ADR-068), so two columns.
    expect(csvParts(loc)!.map((c) => c.label)).toEqual(['In service area', 'Answered with']);
    // A kept location — or rows that still hold one — adds where they were.
    const kept = { ...loc, keepLocation: true } as Question;
    const full = [
      'In service area',
      'Answered with',
      'Latitude',
      'Longitude',
      'ZIP or place',
      'Distance (mi)',
    ];
    expect(csvParts(kept)!.map((c) => c.label)).toEqual(full);
    expect(csvParts(loc, subs)!.map((c) => c.label)).toEqual(full);
    expect(csvParts(kept)!.map((c) => c.cell(subs[1]!.answers.where))).toEqual([
      'No',
      'Their location',
      '34.052',
      '-118.244',
      '',
      '86.9',
    ]);
    expect(csvParts(shots)!.map((c) => c.label)).toEqual(['Front', 'Roof']);
    expect(csvParts(week)!.map((c) => [c.label, c.cell(subs[0]!.answers.when)])).toEqual([
      ['Mon', '9 AM–11 AM'],
      ['Tue', '10 AM–11 AM'],
    ]);
    expect(formatAnswerForCsv(pin, subs[0]!.answers.leak)).toBe(
      'Pin 1 at 40% across, 30% down: leak; Pin 2 at 60% across, 30% down',
    );
    expect(formatAnswerForCsv(voice, subs[0]!.answers.story)).toBe(
      'Voice note (0:42): voice-note.webm',
    );
    const csv = buildResponsesCsv(all, subs);
    const header = csv.split('\r\n')[0]!;
    expect(header).toContain('Where’s the job? — In service area');
    expect(header).toContain('When are you free? — Mon');
    expect(header).toContain('Photos — Roof');
  });
});

/* ---------- Responses views ---------- */

function wrap(node: React.ReactNode) {
  return render(
    <div data-slate-forms="" data-theme-name="slate">
      <div className="slate-rsp">{node}</div>
    </div>,
  );
}

describe('ResponseAnswers for Wave C', () => {
  it('draws pins over the photo and notes when the photo changed since', () => {
    const { container } = wrap(
      <ResponseAnswers
        questions={[pin]}
        answers={{
          leak: {
            pins: ['0.4,0.3'],
            notes: ['leak here'],
            img: imageKey('https://old.example/x.jpg'),
          },
        }}
        layout="stack"
      />,
    );
    expect(container.querySelector('.rsp-pins-photo img')).toHaveAttribute('src', PHOTO);
    expect(container.querySelectorAll('.rsp-pin')).toHaveLength(1);
    expect((container.querySelector('.rsp-pin') as HTMLElement).style.left).toBe('40%');
    expect(screen.getByText('leak here')).toBeInTheDocument();
    expect(screen.getByText(/Placed on an earlier photo/)).toBeInTheDocument();
  });

  it('pins placed on today’s photo carry no warning', () => {
    wrap(
      <ResponseAnswers
        questions={[pin]}
        answers={{ leak: { pins: ['0.4,0.3'], img: imageKey(PHOTO) } }}
        layout="stack"
      />,
    );
    expect(screen.queryByText(/earlier photo/)).toBeNull();
  });

  it('a location reads in words with a map link; the week draws its painted cells', () => {
    const { container } = wrap(
      <ResponseAnswers questions={[loc, week]} answers={subs[0]!.answers} layout="grid" />,
    );
    expect(screen.getByText(/Inside the service area · 6.6 mi away/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open in a map' });
    expect(link).toHaveAttribute(
      'href',
      expect.stringContaining('openstreetmap.org/?mlat=34.441&mlon=-119.812'),
    );
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(container.querySelectorAll('.rsp-week-cell.is-on')).toHaveLength(3);
  });

  it('a checklist lists each shot, with a gap where one is missing', () => {
    wrap(<ResponseAnswers questions={[shots]} answers={subs[1]!.answers} layout="stack" />);
    expect(screen.getByText('1 of 2 photos')).toBeInTheDocument();
    expect(screen.getByText('No photo')).toBeInTheDocument();
  });

  it('a typed voice note reads as text', () => {
    wrap(
      <ResponseAnswers
        questions={[voice]}
        answers={{ story: { typed: 'It leaks' } }}
        layout="stack"
      />,
    );
    expect(screen.getByText('It leaks')).toBeInTheDocument();
  });
});

/* ---------- Summary ---------- */

describe('Summary for Wave C', () => {
  it('charts locations, shots and like rates; the week and pins get their own cards', () => {
    const charted = chartableQuestions(all).map((q) => q.id);
    expect(charted).toEqual(expect.arrayContaining(['where', 'shots', 'likes']));
    expect(charted).not.toContain('when');

    const where = questionDistribution(loc, subs);
    expect(where.rows.map((r) => [r.label, r.count])).toEqual([
      ['In area', 1],
      ['Out of area', 1],
      ['Not checked', 1],
    ]);
    expect(questionDistribution(shots, subs).rows.map((r) => [r.label, r.count, r.pct])).toEqual([
      ['Front', 2, 100],
      ['Roof', 1, 50],
    ]);
    const likes = questionDistribution(swipe, subs);
    expect(likes.likes).toBe(true);
    // Everyone who finished the deck counts, even the one who liked nothing.
    expect(likes.answered).toBe(3);
    expect(likes.rows.map((r) => [r.label, r.pct])).toEqual([
      ['Sage', 67],
      ['Navy', 33],
    ]);
  });

  it('filters by in / out of area and by shot', () => {
    expect(
      subs
        .filter((s) => answerMatchesFilter(s, { questionId: 'where', value: IN_AREA_VALUE }, loc))
        .map((s) => s.id),
    ).toEqual(['s1']);
    expect(
      subs
        .filter((s) =>
          answerMatchesFilter(s, { questionId: 'where', value: OUT_OF_AREA_VALUE }, loc),
        )
        .map((s) => s.id),
    ).toEqual(['s2']);
    expect(
      subs
        .filter((s) => answerMatchesFilter(s, { questionId: 'shots', value: 'roof' }, shots))
        .map((s) => s.id),
    ).toEqual(['s1']);
  });

  it('counts voice notes and photos as files', () => {
    expect(fileRefsOf(voice, subs[0]!.answers.story)).toEqual([REF('voice-note.webm')]);
    expect(fileRefsOf(shots, subs[0]!.answers.shots)).toHaveLength(2);
    expect(hasFiles(subs[0]!, all)).toBe(true);
    expect(hasFiles(subs[2]!, all)).toBe(false);
  });

  it('the heatmap counts people per slot and names the best times', () => {
    const heat = availabilityHeat(week as never, subs);
    expect(heat.answered).toBe(2);
    expect(heat.counts.get('mon')).toEqual([1, 2, 0]);
    expect(heat.best[0]).toEqual({ day: 'mon', slot: 1, count: 2 });
    wrap(<AvailabilityHeatCard question={week as never} number={5} subs={subs} />);
    expect(screen.getByRole('list', { name: 'Best times' })).toHaveTextContent(
      'Mon 10 AM–11 AM2 of 2',
    );
  });

  it('the pin map shows every pin from every response', () => {
    expect(pinCloud(pin as never, subs)).toEqual({
      answered: 2,
      pins: [
        { x: 0.4, y: 0.3 },
        { x: 0.6, y: 0.3 },
        { x: 0.5, y: 0.5 },
      ],
    });
    const { container } = wrap(<PinCloudCard question={pin as never} number={1} subs={subs} />);
    expect(container.querySelectorAll('.rsp-sum-pin')).toHaveLength(3);
    expect(screen.getByText('3 pins · 2 answers')).toBeInTheDocument();
  });
});

/* ---------- Inspector and logic ---------- */

function renderInspector(question: Question, allQs: Question[] = [question]) {
  const onChange = vi.fn();
  const onAddOutOfAreaEnding = vi.fn();
  render(
    <div data-slate-forms="" data-theme-name="slate">
      <Inspector
        question={question}
        allQuestions={allQs}
        onChange={onChange}
        onDelete={vi.fn()}
        canDelete
        onAddOutOfAreaEnding={onAddOutOfAreaEnding}
      />
    </div>,
  );
  return { onChange, onAddOutOfAreaEnding };
}

async function choose(user: ReturnType<typeof userEvent.setup>, select: string, option: string) {
  await user.click(screen.getByRole('button', { name: select }));
  await user.click(screen.getByRole('option', { name: option }));
}

describe('Inspector for Wave C', () => {
  it('the palette has a Capture group with every Wave C type', () => {
    expect(
      ADDABLE_TYPES.filter((t) => t.group === 'Capture')
        .map((t) => t.type)
        .sort(),
    ).toEqual(['availability', 'image_pin', 'location', 'photo_checklist', 'voice_note']);
  });

  it('swipe cards on picture choice turn on multi-select and leave Other out', async () => {
    const user = userEvent.setup();
    const grid: Question = {
      ...swipe,
      display: undefined,
      multiple: false,
      allowOther: true,
    } as Question;
    const { onChange } = renderInspector(grid);
    await choose(user, 'Picture choice style', 'Swipe cards');
    expect(onChange).toHaveBeenLastCalledWith({
      display: 'swipe',
      multiple: true,
      allowOther: undefined,
      otherLabel: undefined,
    });
  });

  it('yes / no has a swipe card style', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector({ id: 'y', type: 'yes_no', title: 'Y?' });
    await choose(user, 'Yes / no style', 'Swipe card (this or that)');
    expect(onChange).toHaveBeenLastCalledWith({ display: 'swipe' });
  });

  it('location: pasted coordinates set the center; a public-point warning; an out-of-area ending', async () => {
    const user = userEvent.setup();
    const { onChange, onAddOutOfAreaEnding } = renderInspector(loc);
    const input = screen.getByRole('textbox', { name: /business location/i });
    await user.clear(input);
    await user.type(input, '34.44, -119.81');
    expect(onChange).toHaveBeenLastCalledWith({ center: { lat: 34.44, lng: -119.81 } });
    expect(screen.getByText(/Anyone with the form link can see this point/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Add an “out of area” ending/ }));
    expect(onAddOutOfAreaEnding).toHaveBeenCalledWith('where');
  });

  it('parses pasted coordinates, from a maps link too', () => {
    expect(parseLatLng('34.4208, -119.6982')).toEqual({ lat: 34.4208, lng: -119.6982 });
    expect(parseLatLng('https://maps.example/@34.4208,-119.6982,15z')).toEqual({
      lat: 34.4208,
      lng: -119.6982,
    });
    expect(parseLatLng('91, 10')).toBeNull();
    expect(parseLatLng('Santa Barbara')).toBeNull();
  });

  it('voice: turning typing off warns who can’t answer', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector(voice);
    await user.click(screen.getByRole('checkbox', { name: 'Let Them Type Instead' }));
    expect(onChange).toHaveBeenLastCalledWith({ allowTyped: false });
  });

  it('availability: day chips, hours and slot length', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector(week);
    const days = screen.getByRole('group', { name: 'Days on the grid' });
    expect(within(days).getByRole('button', { name: 'Mon' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(days).getByRole('button', { name: 'Sat' }));
    expect(onChange).toHaveBeenLastCalledWith({ days: ['mon', 'tue', 'sat'] });
    await choose(user, 'Slot length', '30 minutes');
    expect(onChange).toHaveBeenLastCalledWith({ slotMinutes: 30 });
  });

  it('the pin question shows its photo and how many pins', () => {
    renderInspector(pin);
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /link to a photo/i })).toHaveValue(PHOTO);
  });

  it('the logic editor offers inside / outside the area for a location with a radius', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div data-slate-forms="" data-theme-name="slate">
        <ConditionBuilder
          value={{ field: 'where', op: 'equals', value: '' }}
          onChange={onChange}
          questions={[loc, { id: 'x', type: 'short_text', title: 'X' }]}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Answer' }));
    expect(screen.getByRole('option', { name: 'Outside the service area' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Inside the service area' })).toBeInTheDocument();
  });

  it('the out-of-area ending works for a location too', () => {
    const { questions, endingId } = withOutOfAreaEnding(
      [loc, { id: 'done', type: 'thanks', title: 'Thanks' }],
      'where',
    );
    const where = questions.find((q) => q.id === 'where') as Extract<
      Question,
      { type: 'location' }
    >;
    expect(where.logic).toEqual([
      { if: { field: 'where', op: 'equals', value: OUT_OF_AREA_VALUE }, goTo: endingId },
    ]);
  });
});

/* ---------- sharing ---------- */

describe('sharing Wave C forms', () => {
  it('the embed snippet delegates the mic or location only when the form asks', () => {
    expect(buildEmbedSnippet('https://slate.example/forms/1', 'Quote', [voice, loc])).toContain(
      'allow="microphone; geolocation"',
    );
    expect(buildEmbedSnippet('https://slate.example/forms/1', 'Quote', [shots])).not.toContain(
      'allow=',
    );
  });

  it('portable links leave an uploaded pin photo out, and the reader keeps only https', () => {
    const schema: Schema = {
      brand: { name: 'x' },
      theme: 'classic',
      themeMode: 'light',
      questions: [{ ...pin, image: `data:image/jpeg;base64,${'A'.repeat(4000)}` } as Question],
    };
    const decoded = decodePortableSchema(encodePortableSchema(schema))!;
    expect((decoded.schema.questions[0] as { image?: string }).image).toBeUndefined();
    const hostile = sanitizeUntrustedSchema({
      ...schema,
      questions: [
        { ...pin, image: 'data:image/png;base64,AAAA', maxPins: 99 } as Question,
        { ...loc, center: { lat: 'x', lng: 1 }, radius: -5 } as unknown as Question,
        { ...week, days: ['mon', 'funday'], slotMinutes: 7 } as unknown as Question,
      ],
    });
    const [p, l, w] = hostile.questions as unknown as Array<Record<string, unknown>>;
    expect(p!.image).toBeUndefined();
    expect(p!.maxPins).toBeUndefined();
    expect(l!.center).toBeUndefined();
    expect(l!.radius).toBeUndefined();
    expect(w!.days).toEqual(['mon']);
    expect(w!.slotMinutes).toBeUndefined();
  });
});

/* ---------- Build with AI ---------- */

describe('Build with AI for Wave C', () => {
  it('maps drafted Wave C questions, never inventing a center or a photo', () => {
    const q = (partial: Parameters<typeof blankGeneratedQuestion>[0]) =>
      blankGeneratedQuestion(partial);
    const { schema } = mapGeneratedForm({
      title: 'Roof quote',
      description: 'A quick quote.',
      theme: 'swiss',
      welcome: { title: 'Welcome.', subtitle: '', cta: 'Start' },
      thanks: { title: 'Thanks.', subtitle: 'We’ll call.', cta: 'Submit another' },
      estimate: { show: false, currency: 'USD', base: 0, disclaimer: '' },
      questions: [
        q({
          id: 'shots',
          type: 'photo_checklist',
          title: 'Photos',
          options: [
            {
              label: 'Front',
              value: 'front',
              src: '',
              alt: '',
              price: 0,
              priceMax: 0,
              features: [],
              badge: '',
              capacity: 0,
              date: '',
              start: '',
              end: '',
            },
          ],
        }),
        q({ id: 'leak', type: 'image_pin', title: 'Where?', max: 4 }),
        q({ id: 'story', type: 'voice_note', title: 'Tell us', max: 90, allowTyped: false }),
        q({ id: 'where', type: 'location', title: 'Where?', radius: 25, radiusUnit: 'km' }),
        q({
          id: 'when',
          type: 'availability',
          title: 'When?',
          days: ['mon', 'sat'],
          startTime: '08:00',
          endTime: '26:00',
          step: 30,
        }),
        q({
          id: 'likes',
          type: 'picture_choice',
          title: 'Like?',
          display: 'swipe',
          options: [
            {
              label: 'A',
              value: 'a',
              src: 'https://example.com/a.jpg',
              alt: '',
              price: 0,
              priceMax: 0,
              features: [],
              badge: '',
              capacity: 0,
              date: '',
              start: '',
              end: '',
            },
            {
              label: 'B',
              value: 'b',
              src: 'https://example.com/b.jpg',
              alt: '',
              price: 0,
              priceMax: 0,
              features: [],
              badge: '',
              capacity: 0,
              date: '',
              start: '',
              end: '',
            },
          ],
        }),
        q({ id: 'yn', type: 'yes_no', title: 'This or that?', display: 'swipe' }),
      ],
    });
    const by = Object.fromEntries(schema.questions.map((x) => [x.id, x])) as Record<
      string,
      Record<string, unknown>
    >;
    expect(by.shots!.items).toEqual([{ label: 'Front', value: 'front' }]);
    expect(by.leak).toMatchObject({ type: 'image_pin', maxPins: 4 });
    expect(by.leak!.image).toBeUndefined();
    expect(by.story).toMatchObject({ maxSeconds: 90, allowTyped: false });
    expect(by.where).toMatchObject({ radius: 25, radiusUnit: 'km' });
    expect(by.where!.center).toBeUndefined();
    // Never opts into keeping respondents' locations (ADR-068).
    expect(by.where!.keepLocation).toBeUndefined();
    expect(by.when).toMatchObject({ days: ['mon', 'sat'], startTime: '08:00', slotMinutes: 30 });
    expect(by.when!.endTime).toBeUndefined();
    expect(by.likes).toMatchObject({ display: 'swipe', multiple: true });
    expect(by.yn).toMatchObject({ display: 'swipe' });
  });

  it('a draft from before Wave C still validates for a revise', () => {
    const old = {
      title: 'Quote',
      description: 'A quote.',
      theme: 'swiss',
      welcome: { title: 'Hi', subtitle: '', cta: 'Start' },
      thanks: { title: 'Thanks', subtitle: '', cta: 'Again' },
      questions: ['a', 'b', 'c'].map((id) => {
        const full = blankGeneratedQuestion({
          id,
          type: 'short_text',
          title: id.toUpperCase(),
        }) as Record<string, unknown>;
        for (const k of ['allowTyped', 'radius', 'radiusUnit', 'days', 'startTime', 'endTime'])
          delete full[k];
        return full;
      }),
    };
    expect(generatedFormSchema.safeParse(old).success).toBe(false);
    expect(generatedFormSchema.safeParse(withDraftDefaults(old)).success).toBe(true);
  });
});

/* ---------- Verdict-only locations (ADR-068) ---------- */

describe('locations stored as a verdict only (ADR-068)', () => {
  const verdictSubs = [
    sub('s1', { where: { area: 'in', via: 'gps' } }),
    sub('s2', { where: { area: 'in', via: 'zip' } }),
    sub('s3', { where: { area: 'out', via: 'gps' } }),
    sub('s4', { where: { via: 'typed' } }),
  ];

  it('reads in words: the verdict and how it was checked', () => {
    expect(formatAnswerForQuestion(loc, { area: 'in', via: 'gps' })).toBe(
      'Inside the service area · checked with their location',
    );
    expect(formatAnswerForQuestion(loc, { area: 'out', via: 'zip' })).toBe(
      'Outside the service area · checked with a ZIP code',
    );
    expect(formatAnswerForQuestion(loc, { via: 'gps' })).toBe(
      'Shared their location · not checked',
    );
    expect(formatAnswerForQuestion(loc, { via: 'typed' })).toBe('Typed a place · not checked');
    expect(formatAnswerForQuestion(loc, { via: 'zip' })).toBe('Typed a ZIP code · not checked');
  });

  it('CSV: in / out and what they answered with, and no place columns', () => {
    expect(csvParts(loc, verdictSubs)!.map((c) => c.cell(verdictSubs[1]!.answers.where))).toEqual([
      'Yes',
      'A ZIP code',
    ]);
    expect(csvParts(loc, verdictSubs)!.map((c) => c.cell(verdictSubs[3]!.answers.where))).toEqual([
      '',
      'A typed place',
    ]);
    const header = buildResponsesCsv([loc], verdictSubs).split('\r\n')[0]!;
    expect(header).toContain('Where’s the job? — In service area,Where’s the job? — Answered with');
    expect(header).not.toMatch(/Latitude|Longitude|Distance|ZIP or place/);
  });

  it('the response view lights the side of the ring, with no dot and no map link', () => {
    const { container } = wrap(
      <ResponseAnswers questions={[loc]} answers={verdictSubs[0]!.answers} layout="stack" />,
    );
    expect(screen.getByText('Inside the service area · checked with their location')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open in a map' })).toBeNull();
    expect(screen.getByText(/not where they are/)).toBeInTheDocument();
    const map = container.querySelector('.rsp-loc-map')!;
    expect(map).toHaveClass('rsp-loc-map--verdict', 'rsp-loc-map--in');
    expect(container.querySelector('.rsp-loc-dot')).toBeNull();
  });

  it('a kept location still has its dot and map link, and no verdict-only note', () => {
    const { container } = wrap(
      <ResponseAnswers
        questions={[{ ...loc, keepLocation: true } as Question]}
        answers={subs[0]!.answers}
        layout="stack"
      />,
    );
    expect(screen.getByRole('link', { name: 'Open in a map' })).toBeInTheDocument();
    expect(container.querySelector('.rsp-loc-dot')).not.toBeNull();
    expect(screen.queryByText(/not where they are/)).toBeNull();
  });

  it('Summary counts in / out / not checked, and filters by area', () => {
    const where = questionDistribution(loc, verdictSubs);
    expect(where.rows.map((r) => [r.label, r.count])).toEqual([
      ['In area', 2],
      ['Out of area', 1],
      ['Not checked', 1],
    ]);
    const pick = (value: string) =>
      verdictSubs
        .filter((s) => answerMatchesFilter(s, { questionId: 'where', value }, loc))
        .map((s) => s.id);
    expect(pick(IN_AREA_VALUE)).toEqual(['s1', 's2']);
    expect(pick(OUT_OF_AREA_VALUE)).toEqual(['s3']);
  });

  it('test runs and local links store what the submit Function stores', () => {
    const address: Question = { id: 'addr', type: 'address', title: 'A', serviceArea: ['931'] };
    const plain: Question = { id: 'zipq', type: 'location', title: 'ZIP?' };
    const kept = { ...loc, id: 'kept', keepLocation: true } as Question;
    const qs = [loc, plain, kept, address, voice];
    const engine = {
      where: { lat: '34.052', lng: '-118.244', area: 'in' },
      zipq: { zip: '93105' },
      kept: { lat: '34.441', lng: '-119.812', area: 'in' },
      story: { typed: 'It leaks' },
    };
    expect(asStoredAnswers(qs, engine)).toEqual({
      // The claimed "in" from Los Angeles is re-checked here too.
      where: { area: 'out', via: 'gps' },
      zipq: { area: 'in', via: 'zip' },
      kept: { lat: '34.441', lng: '-119.812', area: 'in' },
      story: { typed: 'It leaks' },
    });
    // Nothing to reduce: the same object back.
    const none = { story: { typed: 'x' } };
    expect(asStoredAnswers(qs, none)).toBe(none);
    expect(asStoredAnswers(qs, { where: { area: 'in' } })).toEqual({});
  });

  it('a portable link stores only the verdict, end to end', async () => {
    const getCurrentPosition = vi.fn((ok: (p: unknown) => void) =>
      ok({ coords: { latitude: 34.44123, longitude: -119.81234 } }),
    );
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition },
    });
    const schema: Schema = {
      brand: { name: 'Pools' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        { ...loc, required: true } as Question,
        { id: 'done', type: 'thanks', title: 'Thanks' },
      ],
    };
    const token = encodePortableSchema(schema, { formId: 'portable_loc068' });
    render(<PublicRespond token={token} />);
    expect(
      await screen.findByText('We only save whether you’re in the service area.'),
    ).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use my location' }));
    await userEvent.setup().click(screen.getByRole('button', { name: /ok/i }));
    await screen.findByRole('heading', { name: 'Thanks' });
    const [stored] = listSubmissions('portable_loc068');
    expect(stored!.answers).toEqual({ where: { area: 'in', via: 'gps' } });
    expect(JSON.stringify(stored)).not.toMatch(/34\.44|119\.81|"lat"/);
  });

  it('the inspector: keep the approximate location, off by default, and says what that means', async () => {
    const user = userEvent.setup();
    const { onChange } = renderInspector(loc);
    const box = screen.getByRole('checkbox', { name: 'Keep Approximate Location (About 110 m)' });
    expect(box).not.toBeChecked();
    expect(screen.getByText(/A town they type is kept as written; where they are isn’t saved/)).toBeInTheDocument();
    expect(
      screen.getByText(/Always followed by “We only save whether you’re in the service area\.”/),
    ).toBeInTheDocument();
    await user.click(box);
    expect(onChange).toHaveBeenLastCalledWith({ keepLocation: true });
  });

  it('the inspector: turning it off clears the key; a location with nothing to check warns', async () => {
    const user = userEvent.setup();
    const bare: Question = { id: 'where', type: 'location', title: 'Where?', keepLocation: true };
    const { onChange } = renderInspector(bare);
    expect(
      screen.getByText(/rounded coordinates \(or the ZIP or town typed\)/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('checkbox', { name: 'Keep Approximate Location (About 110 m)' }),
    );
    expect(onChange).toHaveBeenLastCalledWith({ keepLocation: undefined });
    cleanup();
    renderInspector({ ...bare, keepLocation: undefined } as Question);
    expect(screen.getByText(/only “shared their location” is\s+saved/)).toBeInTheDocument();
    cleanup();
    // A ZIP list on the form is something to check against: no warning.
    const address: Question = { id: 'addr', type: 'address', title: 'A', serviceArea: ['931'] };
    renderInspector({ ...bare, keepLocation: undefined } as Question, [bare, address]);
    expect(screen.queryByText(/only “shared their location”/)).toBeNull();
  });

  it('portable schemas keep keepLocation only when it is a real true', () => {
    const out = sanitizeUntrustedSchema({
      brand: { name: 'x' },
      theme: 'classic',
      themeMode: 'light',
      questions: [
        { ...loc, id: 'a', keepLocation: true },
        { ...loc, id: 'b', keepLocation: 'yes' },
        { ...loc, id: 'c', keepLocation: 1 },
      ],
    } as never);
    expect(out.questions.map((q) => (q as { keepLocation?: unknown }).keepLocation)).toEqual([
      true,
      undefined,
      undefined,
    ]);
  });
});
