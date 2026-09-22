/**
 * Seed the Neon studio with fake forms + responses so the dashboard, inbox,
 * and notifications look lived-in. Dev only.
 *
 *   npm run seed              # 8 forms, ~40 responses, owned by --owner / SEED_OWNER
 *   npm run seed -- --clean   # remove everything this script created
 *   npm run seed -- --forms 20 --responses 120
 *
 * Connection: DATABASE_URL, else `neonctl connection-string` for the slate project.
 * Owner: --owner <uid> or SEED_OWNER, else the only owner already in public.forms.
 *
 * Seeded rows are tagged by id prefix (f_seed…, s_seed…) so --clean never
 * touches real data. The owner trigger reads the Neon Auth JWT, which a plain
 * pg connection does not carry, so it is paused for this transaction only.
 */

import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const NEON_PROJECT = 'odd-voice-53972178';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const CLEAN = args.includes('--clean');
const FORM_COUNT = Number(flag('forms') ?? 8);
const RESPONSE_COUNT = Number(flag('responses') ?? 40);

function connectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return execSync(
    `npx neonctl@latest connection-string --project-id ${NEON_PROJECT} --role-name neondb_owner`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  ).trim();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FORM_NAMES = [
  'Wild Wash Intake',
  'Harbor Dental New Patient',
  'Redwood Roofing Quote',
  'Summit Realty Buyer Survey',
  'Bluebird Café Catering',
  'Pacific Pool Care Sign-up',
  'Ojai Yoga Workshop',
  'Coastline Auto Detail',
  'Lantern Bookkeeping Onboarding',
  'Meadow Vet Appointment',
  'Grove Landscaping Estimate',
  'Northstar Tutoring Enrolment',
  'Silverline Movers Quote',
  'Canyon Fitness Waiver',
  'Tidewater Charters Booking',
  'Juniper Skin Studio Consult',
  'Ironwood Fencing Request',
  'Cedar Creek Wedding RSVP',
  'Bright Path Daycare Interest',
  'Ridgeview HVAC Service',
];

const FIRST = [
  'Harper',
  'Leo',
  'Sam',
  'Chris',
  'Jordan',
  'Dana',
  'Priya',
  'Marcus',
  'Elena',
  'Noah',
  'Ava',
  'Mateo',
  'Grace',
  'Omar',
  'Lily',
  'Ethan',
  'Nora',
  'Kai',
  'Ruth',
  'Diego',
];
const LAST = [
  'Quinn',
  'Martins',
  'Rivera',
  'Okonkwo',
  'Hale',
  'Ortiz',
  'Shah',
  'Bell',
  'Novak',
  'Reed',
  'Park',
  'Silva',
  'Lund',
  'Haddad',
  'Cho',
  'Brooks',
  'Fischer',
  'Nakamura',
  'Adler',
  'Ruiz',
];
const SERVICES = [
  'Quote',
  'Repair',
  'New install',
  'Maintenance',
  'Consultation',
  'Something else',
];
const HEARD = ['Google', 'Instagram', 'A friend', 'Yard sign', 'Flyer'];
const NOTES = [
  'Hoping to get this done before the end of the month.',
  'Please text rather than call, I work nights.',
  'We have a dog, gate is on the left side.',
  'Referred by Brent at 805 Seal Coating.',
  'Flexible on timing, just need a rough number first.',
  'Second time using you — last job was great.',
  '',
];

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

function slug8(): string {
  return String(10_000_000 + Math.floor(Math.random() * 90_000_000));
}

function buildSchema(name: string) {
  return {
    brand: { name },
    theme: pick(['editorial', 'swiss', 'classic']),
    themeMode: 'system',
    questions: [
      {
        id: 'welcome',
        type: 'welcome',
        title: `Welcome to ${name}`,
        subtitle: 'Takes about two minutes.',
        cta: 'Start',
      },
      { id: 'name', type: 'short_text', title: "What's your name?", required: true },
      { id: 'email', type: 'email', title: 'Best email to reach you', required: true },
      {
        id: 'service',
        type: 'single_choice',
        title: 'What do you need?',
        options: SERVICES.map((s) => ({ value: s.toLowerCase().replace(/\s+/g, '-'), label: s })),
      },
      {
        id: 'heard',
        type: 'single_choice',
        title: 'How did you hear about us?',
        options: HEARD.map((s) => ({ value: s.toLowerCase().replace(/\s+/g, '-'), label: s })),
      },
      { id: 'notes', type: 'long_text', title: 'Anything else we should know?' },
      { id: 'thanks', type: 'thanks', title: 'Thanks — we’ll be in touch.' },
    ],
  };
}

function buildAnswers() {
  const first = pick(FIRST);
  const last = pick(LAST);
  const notes = pick(NOTES);
  return {
    name: `${first} ${last}`,
    email: `${first}.${last}@example.com`.toLowerCase(),
    service: pick(SERVICES).toLowerCase().replace(/\s+/g, '-'),
    heard: pick(HEARD).toLowerCase().replace(/\s+/g, '-'),
    ...(notes ? { notes } : {}),
  };
}

/** Skewed toward recent: most within the last day, a tail back ~3 weeks. */
function receivedAt(): Date {
  const r = Math.random();
  const minutesAgo =
    r < 0.35
      ? Math.random() * 90
      : r < 0.7
        ? Math.random() * 60 * 24
        : Math.random() * 60 * 24 * 21;
  return new Date(Date.now() - minutesAgo * 60_000);
}

// ---------------------------------------------------------------------------

async function main() {
  const pool = new pg.Pool({ connectionString: connectionString(), max: 1 });
  const c = await pool.connect();
  try {
    if (CLEAN) {
      const { rowCount } = await c.query(`delete from public.forms where id like 'f_seed%'`);
      console.log(`Removed ${rowCount ?? 0} seeded forms (responses cascade).`);
      return;
    }

    let owner = flag('owner') ?? process.env.SEED_OWNER;
    if (!owner) {
      const { rows } = await c.query<{ owner_id: string }>(
        `select distinct owner_id from public.forms where owner_id is not null`,
      );
      if (rows.length !== 1) {
        throw new Error(
          rows.length === 0
            ? 'No owner found in public.forms — pass --owner <uid>.'
            : `Several owners in public.forms — pass --owner <uid>: ${rows.map((r) => r.owner_id).join(', ')}`,
        );
      }
      owner = rows[0]!.owner_id;
    }

    await c.query('begin');
    await c.query('alter table public.forms disable trigger forms_enforce_owner');

    const formIds: string[] = [];
    const names = [...FORM_NAMES].sort(() => Math.random() - 0.5).slice(0, FORM_COUNT);
    for (const [i, name] of names.entries()) {
      const id = `f_seed${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const schema = buildSchema(name);
      const published = i % 3 !== 2; // two of every three are live
      const created = new Date(Date.now() - (i + 1) * 36 * 3_600_000);
      await c.query(
        `insert into public.forms
           (id, name, slug, schema, published_schema, status, owner_id, created_at, updated_at)
         values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $8)`,
        [
          id,
          name,
          slug8(),
          JSON.stringify(schema),
          published ? JSON.stringify(schema) : null,
          published ? 'published' : 'draft',
          owner,
          created.toISOString(),
        ],
      );
      if (published) formIds.push(id);
    }

    let responses = 0;
    for (let i = 0; i < RESPONSE_COUNT && formIds.length > 0; i += 1) {
      // A couple of forms get most of the traffic, like real life.
      const formId =
        Math.random() < 0.6 ? formIds[i % Math.min(2, formIds.length)]! : pick(formIds);
      const at = receivedAt();
      const durationMs = 45_000 + Math.floor(Math.random() * 240_000);
      await c.query(
        `insert into public.submissions (id, form_id, answers, meta, received_at)
         values ($1, $2, $3::jsonb, $4::jsonb, $5)`,
        [
          `s_seed${randomUUID().replace(/-/g, '').slice(0, 8)}`,
          formId,
          JSON.stringify(buildAnswers()),
          JSON.stringify({
            startedAt: new Date(at.getTime() - durationMs).toISOString(),
            completedAt: at.toISOString(),
            durationMs,
            questionsVisited: ['name', 'email', 'service', 'heard', 'notes'],
            hiddenFields: {},
          }),
          at.toISOString(),
        ],
      );
      responses += 1;
    }

    await c.query('alter table public.forms enable trigger forms_enforce_owner');
    await c.query('commit');
    console.log(
      `Seeded ${names.length} forms (${formIds.length} live) and ${responses} responses for ${owner}.`,
    );
    console.log('Undo with: npm run seed -- --clean');
  } catch (err) {
    await c.query('rollback').catch(() => {});
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
