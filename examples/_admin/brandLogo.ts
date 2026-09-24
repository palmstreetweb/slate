/**
 * Editor-side brand.logo update (ADR-053). A blank field removes the key rather
 * than saving `logo: ''`, and every other brand field is kept.
 */

import type { BrandConfig } from '@/index.js';

export function withBrandLogo(brand: BrandConfig, value: string): BrandConfig {
  const { logo: _previous, ...rest } = brand;
  return value.trim() ? { ...rest, logo: value } : rest;
}
