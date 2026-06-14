/**
 * Shared theme backdrop — resolves a theme's decoration hint and renders
 * the matching component. Used by `<Form>` and Slate canvas so both
 * surfaces show the same per-step art.
 */

'use client';

import { themes } from '@/themes/index.js';
import type { Theme, ThemeName } from '@/types/Theme.js';
import { AuroraDecoration } from './decorations/AuroraDecoration.js';
import { ConstellationDecoration } from './decorations/ConstellationDecoration.js';
import { GrainDecoration } from './decorations/GrainDecoration.js';
import { GridDecoration } from './decorations/GridDecoration.js';
import { GrowthDecoration } from './decorations/GrowthDecoration.js';
import { MemphisDecoration } from './decorations/MemphisDecoration.js';
import { RisoDecoration } from './decorations/RisoDecoration.js';
import { SwissDecoration } from './decorations/SwissDecoration.js';

export type ThemeDecorationKind = Theme['decoration'] | 'none';

export function resolveThemeDecoration(themeName: ThemeName | string): ThemeDecorationKind {
  return (themes as Record<string, Theme | undefined>)[themeName]?.decoration ?? 'none';
}

/** Bold per-step backdrops that need opaque control surfaces + text halos. */
export function hasStepDecorationBackdrop(decoration: ThemeDecorationKind): boolean {
  return decoration !== 'none' && decoration !== 'grain';
}

type Props = {
  themeName: ThemeName | string;
  step: number;
};

export function ThemeDecoration({ themeName, step }: Props) {
  const decoration = resolveThemeDecoration(themeName);

  switch (decoration) {
    case 'shapes':
      return <SwissDecoration step={step} />;
    case 'aurora':
      return <AuroraDecoration step={step} />;
    case 'grid':
      return <GridDecoration step={step} />;
    case 'constellation':
      return <ConstellationDecoration step={step} />;
    case 'growth':
      return <GrowthDecoration step={step} />;
    case 'riso':
      return <RisoDecoration step={step} />;
    case 'memphis':
      return <MemphisDecoration step={step} />;
    case 'grain':
      return <GrainDecoration />;
    default:
      return null;
  }
}
