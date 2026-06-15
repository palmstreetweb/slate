'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ResolvedThemeMode } from '@/index.js';

type AdminThemeContextValue = {
  mode: ResolvedThemeMode;
  setMode: (mode: ResolvedThemeMode) => void;
  toggle: () => void;
};

const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

export function AdminThemeProvider({
  value,
  children,
}: {
  value: AdminThemeContextValue;
  children: ReactNode;
}) {
  return <AdminThemeContext.Provider value={value}>{children}</AdminThemeContext.Provider>;
}

export function useAdminTheme(): AdminThemeContextValue {
  const ctx = useContext(AdminThemeContext);
  if (!ctx) {
    throw new Error('useAdminTheme must be used within AdminShell');
  }
  return ctx;
}
