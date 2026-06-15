import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineSchema } from '@/index.js';
import {
  createForm,
  emptyFormTrash,
  listAllForms,
  listForms,
  listTrashedForms,
  permanentlyDeleteForm,
  replaceAllForms,
  resetFormsStorage,
  restoreForm,
  trashForm,
} from '../examples/_admin/_formsStore.js';

const schema = defineSchema({
  brand: { name: 'Test' },
  theme: 'classic',
  questions: [
    { id: 'welcome', type: 'welcome', title: 'Hi', cta: 'Go' },
    { id: 'done', type: 'thanks', title: 'Done' },
  ],
});

describe('forms store trash', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      localStorage: {
        store: {} as Record<string, string>,
        getItem(key: string) {
          return this.store[key] ?? null;
        },
        setItem(key: string, value: string) {
          this.store[key] = value;
        },
        removeItem(key: string) {
          delete this.store[key];
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    resetFormsStorage();
  });

  it('moves deleted forms to trash instead of removing them', () => {
    const form = createForm({ name: 'Quote', schema });
    expect(form).not.toBeNull();

    trashForm(form!.id);

    expect(listForms()).toHaveLength(0);
    expect(listTrashedForms()).toHaveLength(1);
    expect(listAllForms()).toHaveLength(1);
  });

  it('restores a trashed form', () => {
    const form = createForm({ name: 'Quote', schema });
    trashForm(form!.id);
    restoreForm(form!.id);

    expect(listForms()).toHaveLength(1);
    expect(listTrashedForms()).toHaveLength(0);
    expect(listForms()[0]?.deletedAt).toBeUndefined();
  });

  it('permanently deletes only from trash when emptying', () => {
    const active = createForm({ name: 'Active', schema });
    const trashed = createForm({ name: 'Trashed', schema });
    trashForm(trashed!.id);

    emptyFormTrash();

    expect(listForms()).toHaveLength(1);
    expect(listForms()[0]?.id).toBe(active!.id);
    expect(listAllForms()).toHaveLength(1);
  });

  it('round-trips deletedAt through backup replace', () => {
    const form = createForm({ name: 'Quote', schema });
    trashForm(form!.id);
    const snapshot = listAllForms();

    resetFormsStorage();
    replaceAllForms(snapshot);

    expect(listTrashedForms()).toHaveLength(1);
    permanentlyDeleteForm(form!.id);
    expect(listAllForms()).toHaveLength(0);
  });
});
