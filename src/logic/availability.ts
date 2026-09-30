/**
 * Availability week grid (ADR-065) — pure, no React.
 *
 * The owner picks the days (Monday to Sunday), a time range and a slot
 * length; the respondent paints the slots they're free. The answer is one
 * short string per day with free time, merged into ranges:
 * `{ mon: '09:00-11:30,14:00-16:00', wed: '08:00-10:00' }` — readable in a
 * spreadsheet, a few hundred characters at most, and inside the server's
 * `Record<string, string>` shape.
 *
 * `availabilityAnswerCore` decodes against the question's grid and re-encodes
 * canonically, so a stored answer only ever holds slots the grid offers. The
 * shared section is copied byte for byte into
 * neon/functions/submit-response/availability.ts (tests compare them).
 */

/* ---------- shared with the server (keep identical) ---------- */

/** Stored day keys, Monday first. */
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
/** Slot lengths an owner can pick, in minutes. */
export const SLOT_MINUTES = [15, 30, 60, 120] as const;
/** The most slots in one day's column (15-minute slots around the clock). */
export const GRID_SLOTS_MAX = 96;

const GRID_DEFAULT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const GRID_DEFAULT_START = 8 * 60;
const GRID_DEFAULT_END = 18 * 60;
const GRID_DEFAULT_SLOT = 60;

/** A question's grid: its day columns, the first slot's start (minutes), the slot length and count. */
export type AvailabilityGrid = { days: string[]; start: number; slot: number; count: number };

type GridRecord = Record<string, unknown>;

function isGridRecord(v: unknown): v is GridRecord {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Minutes after midnight for 'HH:MM' (up to '24:00'), or null. */
export function clockMinutes(t: unknown): number | null {
  if (typeof t !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
  return h * 60 + min;
}

/** 'HH:MM' for minutes after midnight. */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h < 10 ? '0' : ''}${h}:${m < 10 ? '0' : ''}${m}`;
}

/** The grid a question asks for; anything unusable falls back to Mon–Fri, 8:00–18:00, hourly. */
export function availabilityGrid(q: GridRecord): AvailabilityGrid {
  const known = new Set<string>(WEEKDAY_KEYS);
  const days: string[] = [];
  if (Array.isArray(q.days)) {
    for (const d of q.days) {
      if (typeof d === 'string' && known.has(d) && !days.includes(d)) days.push(d);
    }
  }
  const slot = (SLOT_MINUTES as readonly unknown[]).includes(q.slotMinutes)
    ? (q.slotMinutes as number)
    : GRID_DEFAULT_SLOT;
  let start = clockMinutes(q.startTime) ?? GRID_DEFAULT_START;
  let end = clockMinutes(q.endTime) ?? GRID_DEFAULT_END;
  if (end - start < slot) {
    start = GRID_DEFAULT_START;
    end = GRID_DEFAULT_END;
  }
  const count = Math.min(GRID_SLOTS_MAX, Math.floor((end - start) / slot));
  return { days: days.length ? days : [...GRID_DEFAULT_DAYS], start, slot, count };
}

/**
 * Picked slot indexes per day, from a stored answer. Unknown days, malformed
 * ranges, and times that aren't slot edges inside the grid are skipped.
 */
export function decodeAvailability(g: AvailabilityGrid, v: unknown): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  if (!isGridRecord(v)) return out;
  for (const day of g.days) {
    const raw = v[day];
    if (typeof raw !== 'string' || raw.length > 2000) continue;
    const picked = new Set<number>();
    for (const part of raw.split(',').slice(0, GRID_SLOTS_MAX)) {
      const m = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(part.trim());
      if (!m) continue;
      const a = clockMinutes(m[1]);
      const b = clockMinutes(m[2]);
      if (a === null || b === null || b <= a || a < g.start) continue;
      if ((a - g.start) % g.slot !== 0 || (b - g.start) % g.slot !== 0) continue;
      const from = (a - g.start) / g.slot;
      const to = (b - g.start) / g.slot;
      if (to > g.count) continue;
      for (let i = from; i < to; i++) picked.add(i);
    }
    if (picked.size) out.set(day, picked);
  }
  return out;
}

/** The canonical answer: merged ranges per day, in grid order; undefined when nothing is picked. */
export function encodeAvailability(
  g: AvailabilityGrid,
  picked: ReadonlyMap<string, ReadonlySet<number>>,
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const day of g.days) {
    const set = picked.get(day);
    if (!set || set.size === 0) continue;
    const ranges: string[] = [];
    let i = 0;
    while (i < g.count) {
      if (!set.has(i)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < g.count && set.has(j)) j += 1;
      ranges.push(`${clockText(g.start + i * g.slot)}-${clockText(g.start + j * g.slot)}`);
      i = j;
    }
    if (ranges.length) out[day] = ranges.join(',');
  }
  return Object.keys(out).length ? out : undefined;
}

/** A stored answer re-encoded against the question's grid; undefined when nothing valid is left. */
export function availabilityAnswerCore(q: GridRecord, v: unknown): Record<string, string> | undefined {
  const g = availabilityGrid(q);
  return encodeAvailability(g, decodeAvailability(g, v));
}

/* ---------- engine-only helpers ---------- */

/** Short day names, for the grid header and summaries. */
export const WEEKDAY_SHORT: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** Full day names, for screen readers. */
export const WEEKDAY_LONG: Record<string, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

/** "9 AM", "9:30 AM", "12 PM" (or "09:00" with `h24`). */
export function clockLabel(minutes: number, h24 = false): string {
  if (h24) return clockText(minutes);
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${m < 10 ? '0' : ''}${m}` : ''} ${suffix}`;
}

/** Hours picked in an answer, against the question's grid. */
export function availabilityHours(q: GridRecord, answer: unknown): number {
  const g = availabilityGrid(q);
  let slots = 0;
  decodeAvailability(g, answer).forEach((s) => (slots += s.size));
  return (slots * g.slot) / 60;
}

/** "Mon 9 AM–12 PM, 2–4 PM; Wed 8–10 AM" — for piping, Responses and CSV. */
export function formatAvailability(q: GridRecord, answer: unknown): string {
  const g = availabilityGrid(q);
  const picked = decodeAvailability(g, answer);
  const days: string[] = [];
  for (const day of g.days) {
    const set = picked.get(day);
    if (!set) continue;
    const ranges: string[] = [];
    let i = 0;
    while (i < g.count) {
      if (!set.has(i)) {
        i += 1;
        continue;
      }
      let j = i;
      while (j < g.count && set.has(j)) j += 1;
      const a = clockLabel(g.start + i * g.slot);
      const b = clockLabel(g.start + j * g.slot);
      // "9–11 AM" when both ends share AM / PM.
      ranges.push(a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`);
      i = j;
    }
    days.push(`${WEEKDAY_SHORT[day] ?? day} ${ranges.join(', ')}`);
  }
  return days.join('; ');
}
