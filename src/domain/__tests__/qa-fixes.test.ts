import { describe, expect, it } from 'vitest';
import { numberText } from '../../lib/number.ts';
import { buildCostCatalog } from '../cost.ts';
import { missingComponents } from '../open-day.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  VARIANTS,
} from '../../data/legacy-seed-v9.ts';

describe('numberText', () => {
  it('reads float noise from cost arithmetic as the number it is', () => {
    expect(numberText(0.026000000000000002)).toBe('0.026');
    expect(numberText(0.029199999999999997)).toBe('0.0292');
    expect(numberText(0.0022222222222222222)).toBe('0.002222222222');
    expect(numberText(null)).toBe('');
    expect(numberText(1500)).toBe('1500');
  });
});

describe('missingComponents', () => {
  it('does not ask for a component removed or switched off', () => {
    const rows = {
      products: PRODUCTS,
      variants: VARIANTS,
      bom: BOM_ROWS,
      packagingSets: PACKAGING_SETS,
      packagingItems: PACKAGING_ITEMS,
      modifiers: MODIFIERS,
    };
    const empty = { batches: [], movements: [] };
    const all = missingComponents(buildCostCatalog({ ...rows, components: COMPONENTS }), empty);
    expect(all.map((c) => c.id)).toContain('COMP_PEACH_GUM');

    const trimmed = missingComponents(
      buildCostCatalog({
        ...rows,
        components: COMPONENTS.map((c) =>
          c.id === 'COMP_PEACH_GUM'
            ? { ...c, removed_at: '2026-10-15T00:00:00.000Z', is_active: false }
            : c.id === 'COMP_BASIL_SEED'
              ? { ...c, is_active: false }
              : c,
        ),
      }),
      empty,
    );
    expect(trimmed.map((c) => c.id)).not.toContain('COMP_PEACH_GUM');
    expect(trimmed.map((c) => c.id)).not.toContain('COMP_BASIL_SEED');
    expect(trimmed).toHaveLength(all.length - 2);
  });
});
