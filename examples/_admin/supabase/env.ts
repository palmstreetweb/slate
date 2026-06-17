import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types.js';

export function getSupabaseUrl(): string | undefined {
  return import.meta.env.VITE_SUPABASE_URL?.trim() || undefined;
}

export function getSupabaseAnonKey(): string | undefined {
  return import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || undefined;
}

/** When `1` / `true`, ignore Supabase keys — localStorage admin, no login (local UI testing). */
export function isAdminOfflineMode(): boolean {
  const raw = import.meta.env.VITE_ADMIN_OFFLINE;
  return raw === '1' || raw === 'true';
}

export function isSupabaseConfigured(): boolean {
  if (isAdminOfflineMode()) return false;
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

let client: SupabaseClient<Database> | null = null;

export function getSupabase(): SupabaseClient<Database> {
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  if (!url || !key) {
    throw new Error('Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  }
  if (!client) {
    client = createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export function getFunctionsUrl(): string {
  const url = getSupabaseUrl();
  if (!url) throw new Error('Supabase URL not configured');
  return `${url.replace(/\/$/, '')}/functions/v1`;
}
