/**
 * Seed schemas for first-run. These are real forms PSW would actually
 * use — not toy demos. The store is seeded once, then mutations from
 * the editor take over.
 */

import { defineSchema } from '@/index.js';
import type { Schema } from '@/index.js';

export const seedForms: ReadonlyArray<{ name: string; schema: Schema }> = [
  {
    name: 'PSW — Contact form',
    schema: defineSchema({
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
          title: 'Best email to reach you?',
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
          id: 'message',
          type: 'long_text',
          title: 'Anything you want to tell us up front?',
          placeholder: "What you're trying to do, links to inspiration, anything that helps...",
        },
        {
          id: 'done',
          type: 'thanks',
          title: "You're all set.",
          subtitle: "We'll be in touch within 24 hours, usually faster.",
          cta: 'Submit another',
        },
      ],
    }),
  },

  {
    name: '805 Sealcoating — Quote',
    schema: defineSchema({
      brand: { name: '805 Sealcoating' },
      theme: 'swiss',
      themeMode: 'toggle',
      questions: [
        {
          id: 'welcome',
          type: 'welcome',
          title: 'Hey there.',
          subtitle:
            "Let's get you a free quote. Takes about 60 seconds — no high-pressure sales, promise.",
          cta: 'Start',
        },
        { id: 'name', type: 'short_text', title: "What's your first name?", required: true },
        { id: 'email', type: 'email', title: 'Best email?', required: true },
        {
          id: 'service',
          type: 'single_choice',
          title: 'Which service?',
          options: [
            { label: 'Driveway sealcoating', value: 'sealcoat' },
            { label: 'Parking lot striping', value: 'striping' },
            { label: 'Crack filling & repair', value: 'repair' },
            { label: 'Not sure yet', value: 'advice' },
          ],
        },
        {
          id: 'urgency',
          type: 'scale',
          title: 'How urgent is this?',
          min: 0,
          max: 10,
          minLabel: 'no rush',
          maxLabel: 'asap',
          required: true,
        },
        { id: 'done', type: 'thanks', title: "You're all set.", cta: 'Submit another' },
      ],
    }),
  },
];
