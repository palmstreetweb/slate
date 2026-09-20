/** Golden prompts for Build with AI QA (ADR-039). */

export const AI_GOLDEN_PROMPTS: ReadonlyArray<{ id: string; kind: string; prompt: string }> = [
  {
    id: 'rsvp-wedding',
    kind: 'RSVP',
    prompt: 'A wedding RSVP with meal choice and plus-one.',
  },
  {
    id: 'rsvp-rehearsal',
    kind: 'RSVP',
    prompt: 'Rehearsal dinner RSVP for 40 guests. Collect name, attendance, dietary notes.',
  },
  {
    id: 'lead-agency',
    kind: 'lead capture',
    prompt: 'Lead form for a web design studio. Name, email, company, budget range, project type.',
  },
  {
    id: 'lead-saas',
    kind: 'lead capture',
    prompt: 'SaaS demo request: work email, company size, role, what they want to see.',
  },
  {
    id: 'job-designer',
    kind: 'job application',
    prompt: 'Job application for a senior product designer. Portfolio URL as short text is fine, years of experience, employment type, cover note.',
  },
  {
    id: 'job-apprentice',
    kind: 'job application',
    prompt: 'Trade apprentice interest form: name, phone, city, years experience (number), why they want the trade.',
  },
  {
    id: 'feedback-nps-ish',
    kind: 'feedback survey',
    prompt: 'Post-project client feedback. Satisfaction scale, what went well, what to improve, would they refer us (yes/no as single choice).',
  },
  {
    id: 'feedback-event',
    kind: 'feedback survey',
    prompt: 'Workshop feedback: overall rating 1-5, favorite session (single choice), comments.',
  },
  {
    id: 'event-reg',
    kind: 'event registration',
    prompt: 'Register for a Saturday community cleanup. Name, email, T-shirt size, how they heard about it, emergency contact phone.',
  },
  {
    id: 'event-meetup',
    kind: 'event registration',
    prompt: 'Design meetup signup. Name, email, dietary needs, plus topics they want (multi choice).',
  },
  {
    id: 'intake-plumber',
    kind: 'service intake',
    prompt: 'Plumbing service intake: name, phone, address as short text, issue type, urgency scale, description of the problem.',
  },
  {
    id: 'intake-photo',
    kind: 'service intake',
    prompt: 'Wedding photographer inquiry. Couple names, email, wedding date as short text, guest count, vibe (editorial vs documentary).',
  },
  {
    id: 'nonprofit-volunteer',
    kind: 'volunteer',
    prompt: 'Volunteer signup for a food pantry. Name, email, phone, available days (multi), shirt size, emergency contact.',
  },
  {
    id: 'classroom',
    kind: 'education',
    prompt: 'Parent permission slip for a field trip. Child name, grade, allergy notes, emergency phone, permission yes/no as single choice.',
  },
  {
    id: 'waitlist',
    kind: 'waitlist',
    prompt: 'Restaurant waitlist: name, party size, phone, seating preference (bar, booth, patio), special occasion note.',
  },
];
