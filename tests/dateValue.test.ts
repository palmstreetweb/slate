/** Date answers with a time and/or a range (ADR-063). */

import { describe, it, expect } from 'vitest';
import { formatDateAnswer, formatTime12, isValidTime, parseDateAnswer } from '@/logic/dateValue.js';
import { dateAnswerToString } from '@/logic/dateEntry.js';
import { isValidIsoDate, validate } from '@/logic/validation.js';
import type { DateQuestion } from '@/types/Question.js';

describe('parseDateAnswer', () => {
  it('reads every stored shape', () => {
    expect(parseDateAnswer('2026-10-03')).toEqual({ start: { date: '2026-10-03' } });
    expect(parseDateAnswer('2026-10-03T14:30')).toEqual({
      start: { date: '2026-10-03', time: '14:30' },
    });
    expect(parseDateAnswer('2026-10-03/2026-10-07')).toEqual({
      start: { date: '2026-10-03' },
      end: { date: '2026-10-07' },
    });
    expect(parseDateAnswer('2026-10-03T09:00/2026-10-03T17:00')).toEqual({
      start: { date: '2026-10-03', time: '09:00' },
      end: { date: '2026-10-03', time: '17:00' },
    });
  });

  it('refuses bad calendars, clocks and shapes', () => {
    for (const bad of [
      '',
      '2026-02-30',
      '2026-13-01',
      '2026-10-03T24:00',
      '2026-10-03T12:60',
      '2026-10-03/',
      '/2026-10-03',
      '2026-10-03/2026-10-04/2026-10-05',
      '10/03/2026',
      'x'.repeat(50),
      12,
      null,
    ]) {
      expect(parseDateAnswer(bad)).toBeNull();
    }
  });

  it('round-trips through dateAnswerToString', () => {
    for (const v of [
      '2026-10-03',
      '2026-10-03T08:05',
      '2026-10-03/2026-10-07',
      '2026-10-03T09:00/2026-10-04T10:30',
    ]) {
      expect(dateAnswerToString(parseDateAnswer(v)!)).toBe(v);
    }
  });
});

describe('time helpers', () => {
  it('isValidTime and the 12-hour clock', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
    expect(isValidTime('7:30')).toBe(false);
    expect(formatTime12('00:15')).toBe('12:15 AM');
    expect(formatTime12('12:00')).toBe('12:00 PM');
    expect(formatTime12('14:05')).toBe('2:05 PM');
  });

  it('isValidIsoDate is still exported from validation', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2025-02-29')).toBe(false);
  });
});

describe('formatDateAnswer', () => {
  it('uses the question format; US reads a 12-hour clock, day-first reads 24-hour', () => {
    expect(formatDateAnswer('2026-10-03')).toBe('10/03/2026');
    expect(formatDateAnswer('2026-10-03', 'DD/MM/YYYY')).toBe('03/10/2026');
    expect(formatDateAnswer('2026-10-03T14:30')).toBe('10/03/2026 2:30 PM');
    expect(formatDateAnswer('2026-10-03T14:30', 'DD/MM/YYYY')).toBe('03/10/2026 14:30');
    expect(formatDateAnswer('2026-10-03/2026-10-07')).toBe('10/03/2026 – 10/07/2026');
  });

  it('passes anything unparseable through', () => {
    expect(formatDateAnswer('whenever')).toBe('whenever');
    expect(formatDateAnswer(undefined)).toBe('');
  });
});

describe('validate — date options', () => {
  const base: DateQuestion = { id: 'd', type: 'date', title: 'When?' };

  it('plain dates are unchanged', () => {
    expect(validate(base, '2026-10-03')).toBeNull();
    expect(validate(base, '2026-10-03T10:00')?.code).toBe('date');
    expect(validate({ ...base, required: true }, '')?.message).toBe('Please pick a date');
  });

  it('includeTime needs a time on every part', () => {
    const q = { ...base, includeTime: true };
    expect(validate(q, '2026-10-03T10:00')).toBeNull();
    expect(validate(q, '2026-10-03')?.code).toBe('date');
    expect(validate({ ...q, required: true }, '')?.message).toBe('Please pick a date and time');
  });

  it('range needs both ends, in order, inside the bounds', () => {
    const q = { ...base, range: true, min: '2026-10-01', max: '2026-10-31' };
    expect(validate(q, '2026-10-03/2026-10-07')).toBeNull();
    expect(validate(q, '2026-10-03/2026-10-03')).toBeNull();
    expect(validate(q, '2026-10-03')?.code).toBe('date');
    expect(validate(q, '2026-10-07/2026-10-03')?.code).toBe('range_order');
    expect(validate(q, '2026-09-30/2026-10-03')?.code).toBe('min');
    expect(validate(q, '2026-10-03/2026-11-01')?.code).toBe('max');
    expect(validate({ ...q, required: true }, '')?.message).toBe('Please pick both dates');
  });

  it('a timed range compares the times on the same day', () => {
    const q = { ...base, range: true, includeTime: true };
    expect(validate(q, '2026-10-03T09:00/2026-10-03T17:00')).toBeNull();
    expect(validate(q, '2026-10-03T17:00/2026-10-03T09:00')?.code).toBe('range_order');
  });
});
