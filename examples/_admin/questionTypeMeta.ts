/**
 * Shared question-type labels + outline/add-picker glyphs for Slate.
 * Keep in sync across the outline list, Add popover, and Inspector.
 */

import type { Question, QuestionType } from '@/index.js';

export const TYPE_LABEL: Record<Question['type'], string> = {
  welcome: 'Welcome Screen',
  statement: 'Statement',
  thanks: 'Thank You Screen',
  short_text: 'Short Text',
  long_text: 'Long Text',
  email: 'Email',
  phone: 'Phone',
  url: 'Website',
  number: 'Number',
  date: 'Date',
  file_upload: 'File Upload',
  single_choice: 'Single Choice',
  multi_choice: 'Multi Choice',
  dropdown: 'Dropdown',
  picture_choice: 'Picture Choice',
  ranking: 'Ranking',
  matrix: 'Matrix',
  yes_no: 'Yes / No',
  legal: 'Legal / Consent',
  scale: 'Scale',
  nps: 'NPS (0–10)',
  review: 'Review Screen',
};

export const TYPE_GLYPH: Record<Question['type'], string> = {
  welcome: '◐',
  statement: '▤',
  thanks: '◑',
  short_text: 'T',
  long_text: '¶',
  email: '@',
  phone: '☏',
  url: '⌘',
  number: '#',
  date: '▦',
  file_upload: '⇪',
  single_choice: '◉',
  multi_choice: '☑',
  dropdown: '▼',
  picture_choice: '▣',
  ranking: '≡',
  matrix: '⊞',
  yes_no: '⊘',
  legal: '§',
  scale: '◇',
  nps: '◈',
  review: '☰',
};

export const ADDABLE_TYPES: ReadonlyArray<{ type: QuestionType; label: string; group: string }> = [
  { type: 'short_text', label: TYPE_LABEL.short_text, group: 'Inputs' },
  { type: 'long_text', label: TYPE_LABEL.long_text, group: 'Inputs' },
  { type: 'email', label: TYPE_LABEL.email, group: 'Inputs' },
  { type: 'phone', label: TYPE_LABEL.phone, group: 'Inputs' },
  { type: 'url', label: TYPE_LABEL.url, group: 'Inputs' },
  { type: 'number', label: TYPE_LABEL.number, group: 'Inputs' },
  { type: 'date', label: TYPE_LABEL.date, group: 'Inputs' },
  { type: 'file_upload', label: TYPE_LABEL.file_upload, group: 'Inputs' },
  { type: 'single_choice', label: TYPE_LABEL.single_choice, group: 'Choices' },
  { type: 'multi_choice', label: TYPE_LABEL.multi_choice, group: 'Choices' },
  { type: 'dropdown', label: TYPE_LABEL.dropdown, group: 'Choices' },
  { type: 'picture_choice', label: TYPE_LABEL.picture_choice, group: 'Choices' },
  { type: 'yes_no', label: TYPE_LABEL.yes_no, group: 'Choices' },
  { type: 'scale', label: TYPE_LABEL.scale, group: 'Choices' },
  { type: 'nps', label: TYPE_LABEL.nps, group: 'Choices' },
  { type: 'ranking', label: TYPE_LABEL.ranking, group: 'Choices' },
  { type: 'matrix', label: TYPE_LABEL.matrix, group: 'Choices' },
  { type: 'statement', label: TYPE_LABEL.statement, group: 'Other' },
  { type: 'legal', label: TYPE_LABEL.legal, group: 'Other' },
  { type: 'review', label: TYPE_LABEL.review, group: 'Other' },
];
