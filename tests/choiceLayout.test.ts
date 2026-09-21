import { describe, expect, it } from 'vitest';
import { choiceListIsSplit } from '@/utils/choiceLayout.js';

const town = (label: string) => ({ label });

describe('choiceListIsSplit', () => {
  it('keeps a short list full width', () => {
    expect(choiceListIsSplit([town('Yes'), town('No'), town('Maybe')])).toBe(false);
  });

  it('splits a long list of short labels', () => {
    const towns = [
      'Los Osos', 'Morro Bay', 'Cayucos', 'Cambria', 'Baywood Park', 'San Simeon',
      'Harmony', 'San Luis Obispo', 'Avila Beach', 'Shell Beach', 'Pismo Beach',
      'Grover Beach', 'Oceano', 'Arroyo Grande', 'Atascadero', 'Paso Robles',
    ].map(town);
    expect(choiceListIsSplit(towns)).toBe(true);
  });

  it('stays full width when any label is a sentence', () => {
    const options = Array.from({ length: 8 }, (_, i) =>
      town(i === 3 ? 'Only when the driveway is really dirty' : 'Yes'),
    );
    expect(choiceListIsSplit(options)).toBe(false);
  });
});
