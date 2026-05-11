/**
 * PSW v2 contact form — production-shaped schema.
 *
 * This is the form that would replace `components/contact-form.tsx` in the
 * palm-street-web repo. The submission flow currently goes through a
 * localStorage-backed store (see _submissionStore.ts) so you can iterate
 * on questions/copy and immediately see the results in the inbox view.
 *
 * To wire into the real PSW v2 site:
 *   1. Replace addSubmission() with a fetch('/api/contact', { method: POST,
 *      body: JSON.stringify({ answers, meta }) }) call.
 *   2. Implement /api/contact in PSW v2 (Resend for the agency notification
 *      + Supabase/whatever for persistence).
 *   3. Drop the inbox view; that's served by your DB's admin UI in prod.
 */

import { Form, defineSchema } from '@/index.js';
import { addSubmission } from './_submissionStore.js';

const schema = defineSchema({
  brand: { name: 'Palm Street Web' },
  theme: 'editorial',
  themeMode: 'toggle',
  questions: [
    {
      id: 'welcome',
      type: 'welcome',
      title: "Let's talk.",
      subtitle:
        "A few quick questions and we'll get back to you within 24 hours. Takes about 90 seconds.",
      cta: 'Start',
    },

    {
      id: 'name',
      type: 'short_text',
      title: "What's your name?",
      placeholder: 'First and last is great',
      required: true,
    },

    {
      id: 'email',
      type: 'email',
      title: (a) => `Nice to meet you${a.name ? ', ' + String(a.name).split(' ')[0] : ''}. Best email to reach you?`,
      placeholder: 'name@company.com',
      required: true,
    },

    {
      id: 'company',
      type: 'short_text',
      title: 'Company or project name?',
      placeholder: 'Optional — leave blank if personal',
    },

    {
      id: 'project_type',
      type: 'single_choice',
      title: 'What kind of project is this?',
      options: [
        { label: 'New website from scratch', value: 'new_site' },
        { label: 'Redesign of an existing site', value: 'redesign' },
        { label: 'Web app / dashboard / tool', value: 'web_app' },
        { label: 'Just need a contact / lead form', value: 'form_only' },
        { label: 'Not sure yet — want to talk it through', value: 'discovery' },
      ],
    },

    {
      id: 'budget',
      type: 'single_choice',
      title: 'Rough budget range?',
      options: [
        { label: 'Under $5K', value: 'lt_5k' },
        { label: '$5K – $15K', value: '5_15k' },
        { label: '$15K – $40K', value: '15_40k' },
        { label: '$40K+', value: 'gt_40k' },
        { label: "Don't know yet", value: 'tbd' },
      ],
    },

    {
      id: 'timeline',
      type: 'single_choice',
      title: "When would you want to launch?",
      options: [
        { label: 'ASAP — already late', value: 'asap' },
        { label: 'Within the next month', value: '1mo' },
        { label: '1–3 months from now', value: '1_3mo' },
        { label: '3+ months out', value: 'gt_3mo' },
        { label: 'Flexible', value: 'flex' },
      ],
    },

    {
      id: 'referral',
      type: 'single_choice',
      title: 'How did you hear about us?',
      required: false,
      options: [
        { label: 'Google / search', value: 'google' },
        { label: 'A friend or coworker', value: 'word_of_mouth' },
        { label: 'Social (Twitter, LinkedIn, etc.)', value: 'social' },
        { label: 'Saw our work on another site', value: 'portfolio' },
        { label: 'Other / I forgot', value: 'other' },
      ],
    },

    {
      id: 'message',
      type: 'long_text',
      title: 'Anything you want to tell us up front?',
      placeholder:
        "What you're trying to do, what's been tried, links to inspiration, anything that helps us prep for the call...",
    },

    {
      id: 'done',
      type: 'thanks',
      title: "You're all set.",
      subtitle: "We'll be in touch within 24 hours, usually faster.",
      cta: 'Submit another',
    },
  ],
});

export function PSWContact() {
  return (
    <Form
      schema={schema}
      hiddenFields={{
        // PSW v2 will set these from the actual request:
        source: 'palmstreetweb.com',
        page: typeof window !== 'undefined' ? window.location.pathname : '/',
        referrer: typeof document !== 'undefined' ? document.referrer || null : null,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        // utm_source / utm_campaign would come from the URL search params here.
      }}
      onSubmit={async (answers, meta) => {
        // Dev: store locally so the inbox view can read it.
        // Prod: replace with `await fetch('/api/contact', ...)`.
        await new Promise((r) => setTimeout(r, 350));
        addSubmission(answers, meta);
      }}
      onQuestionChange={(qid) => {
        if (typeof window === 'undefined') return;
        // PSW v2 would push to whatever analytics is wired (Plausible, GA, etc.)
        console.debug('[psw-contact] step →', qid);
      }}
    />
  );
}
