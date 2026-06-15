import { describe, it, expect } from 'vitest';
import type { Question } from '@/index.js';
import {
  formatAnswerForQuestion,
  leadPreview,
  titleOf,
} from '../examples/_admin/responsesFormat.js';

describe('responsesFormat', () => {
  const choice: Question = {
    id: 'service',
    type: 'single_choice',
    title: 'Which service?',
    options: [
      { label: 'Sealcoat', value: 'sealcoat' },
      { label: 'Striping', value: 'striping' },
    ],
  };

  it('titleOf uses string title', () => {
    expect(titleOf(choice)).toBe('Which service?');
  });

  it('formatAnswerForQuestion resolves option labels', () => {
    expect(formatAnswerForQuestion(choice, 'sealcoat')).toBe('Sealcoat');
  });

  it('leadPreview prioritizes contact fields', () => {
    const questions: Question[] = [
      { id: 'service', type: 'single_choice', title: 'Service', options: choice.options },
      { id: 'email', type: 'email', title: 'Email' },
      { id: 'name', type: 'short_text', title: 'Name' },
    ];
    const preview = leadPreview(questions, {
      service: 'sealcoat',
      email: 'a@b.com',
      name: 'Caleb',
    });
    expect(preview.primary).toBe('Caleb');
    expect(preview.secondary).toBe('a@b.com');
  });
});
