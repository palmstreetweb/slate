/**
 * Neon generated-style types for Slate admin (ADR-029).
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
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /**
   * Generated from `fill_password_hash is not null` (ADR-043). Read-only.
   * The hash column itself is deliberately absent from these types — the
   * browser never selects it.
   */
  fill_locked?: boolean;
};

/** Explicit owner-hydrate column list. Never `*` — that would pull `fill_password_hash`. */
export const FORM_OWNER_COLUMNS =
  'id,name,slug,schema,published_schema,status,owner_id,created_at,updated_at,deleted_at,fill_locked';

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
        Insert: Partial<DbFormFileRow> &
          Pick<DbFormFileRow, 'form_id' | 'storage_path' | 'filename'>;
        Update: Partial<DbFormFileRow>;
        Relationships: [];
      };
      feedback: {
        Row: {
          id: string;
          owner_id: string | null;
          email: string | null;
          message: string;
          path: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id?: string | null;
          email?: string | null;
          message: string;
          path?: string | null;
          created_at?: string;
        };
        Update: {
          message?: string;
        };
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
          /** Missing until migration 012 is applied. */
          locked?: boolean;
          schema: Schema | null;
        }[];
      };
      set_form_fill_password: {
        Args: { p_form_id: string; p_password: string };
        Returns: boolean;
      };
      can_sign_in: {
        Args: { p_email: string };
        Returns: boolean;
      };
      list_team_allowlist: {
        Args: Record<string, never>;
        Returns: { email: string; created_at: string }[];
      };
      add_team_allowlist: {
        Args: { p_email: string };
        Returns: string;
      };
      remove_team_allowlist: {
        Args: { p_email: string };
        Returns: boolean;
      };
      is_psw_team: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      auth_email: {
        Args: Record<string, never>;
        Returns: string;
      };
      auth_uid: {
        Args: Record<string, never>;
        Returns: string;
      };
      form_quota_limit: {
        Args: Record<string, never>;
        Returns: number;
      };
      form_quota_status: {
        Args: Record<string, never>;
        Returns: { used: number; max_forms: number }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** `schema` is null exactly when `locked` — the gate unlocks it (ADR-043). */
export type PublishedFormPayload =
  | { id: string; name: string; slug: string; locked: false; schema: Schema }
  | { id: string; name: string; slug: string; locked: true; schema: null };
