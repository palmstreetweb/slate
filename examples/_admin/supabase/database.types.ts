/**
 * Supabase generated-style types for Slate admin (ADR-028).
 * Hand-maintained to avoid codegen in CI; update when migrations change.
 */

import type { Schema } from '@/index.js';

export type FormStatus = 'draft' | 'published';

export type DbFormRow = {
  id: string;
  name: string;
  slug: string;
  schema: Schema;
  published_schema: Schema | null;
  status: FormStatus;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type DbSubmissionRow = {
  id: string;
  form_id: string;
  answers: Record<string, unknown>;
  meta: Record<string, unknown>;
  received_at: string;
  deleted_at: string | null;
};

export type DbFormFileRow = {
  id: string;
  form_id: string;
  submission_id: string | null;
  storage_path: string;
  filename: string;
  mime: string | null;
  size_bytes: number | null;
  created_at: string;
};

type FormsInsert = Partial<DbFormRow> & Pick<DbFormRow, 'name' | 'slug' | 'schema'>;
type SubmissionsInsert = Partial<DbSubmissionRow> & Pick<DbSubmissionRow, 'form_id' | 'answers'>;

export type Database = {
  public: {
    Tables: {
      forms: {
        Row: DbFormRow;
        Insert: FormsInsert;
        Update: Partial<DbFormRow>;
        Relationships: [];
      };
      submissions: {
        Row: DbSubmissionRow;
        Insert: SubmissionsInsert;
        Update: Partial<DbSubmissionRow>;
        Relationships: [];
      };
      form_files: {
        Row: DbFormFileRow;
        Insert: Partial<DbFormFileRow> & Pick<DbFormFileRow, 'form_id' | 'storage_path' | 'filename'>;
        Update: Partial<DbFormFileRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      get_form_by_slug: {
        Args: { p_slug: string };
        Returns: {
          id: string;
          name: string;
          slug: string;
          schema: Schema;
        }[];
      };
      can_sign_in: {
        Args: { p_email: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type PublishedFormPayload = {
  id: string;
  name: string;
  slug: string;
  schema: Schema;
};
