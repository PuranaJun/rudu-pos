import { describe, expect, it } from 'vitest';
import {
  componentRemovalBlockers,
  isRemoved,
  isRemovedVariant,
  packagingItemRemovalBlockers,
} from '../removal.ts';
import { buildCostCatalog, type CatalogRows } from '../cost.ts';
import { packagingStock } from '../packaging.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  VARIANTS,
} from '../../data/legacy-seed-v9.ts';
import type { PurchaseItem } from '../../db/types.ts';

const AT = '2026-10-15T10:00:00.000Z';

const ROWS: CatalogRows = {
  products: PRODUCTS,
  variants: VARIANTS,
  components: COMPONENTS,
  bom: BOM_ROWS,
  packagingSets: PACKAGING_SETS,
  packagingItems: PACKAGING_ITEMS,
  modifiers: MODIFIERS,
};

function catalogWith(changes: Partial<CatalogRows> = {}) {
  return buildCostCatalog({ ...ROWS, ...changes });
}

describe('isRemoved', () => {
  it('is false for rows from before removal existed, and for null', () => {
    expect(isRemoved({})).toBe(false);
    expect(isRemoved({ removed_at: null })).toBe(false);
    expect(isRemoved({ removed_at: AT })).toBe(true);
  });

  it('takes a variant with its drink', () => {
    const catalog = catalogWith({
      products: PRODUCTS.map((p) => (p.id === 'DRINK_PEAR' ? { ...p, removed_at: AT } : p)),
    });
    expect(isRemovedVariant(catalog, { product_id: 'DRINK_PEAR' })).toBe(true);
    expect(isRemovedVariant(catalog, { product_id: 'DRINK_TAMARIND' })).toBe(false);
  });
});

describe('a removed recipe line', () => {
  it('is in no recipe', () => {
    const before = catalogWith();
    const line = before.bomByVariant.get('VAR_TAMARIND_ICED')![0]!;
    const after = catalogWith({
      bom: BOM_ROWS.map((row) => (row.id === line.id ? { ...row, removed_at: AT } : row)),
    });
    expect(after.bomByVariant.get('VAR_TAMARIND_ICED')!.map((row) => row.id)).not.toContain(
      line.id,
    );
  });
});

describe('componentRemovalBlockers', () => {
  it('names the drinks whose recipe still uses it', () => {
    const problems = componentRemovalBlockers(catalogWith(), 'COMP_CONC_TAMARIND');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^อยู่ในสูตรของ /);
    const tamarind = VARIANTS.find((v) => v.id === 'VAR_TAMARIND_ICED')!;
    expect(problems[0]).toContain(tamarind.name_th);
  });

  it('names the topping that brings it', () => {
    const problems = componentRemovalBlockers(catalogWith(), 'COMP_BASIL_SEED');
    expect(problems.some((p) => p.startsWith('ท็อปปิ้ง '))).toBe(true);
  });

  it('names the component made from it', () => {
    const problems = componentRemovalBlockers(catalogWith(), 'COMP_TEA_WHITE');
    const jelly = COMPONENTS.find((c) => c.id === 'COMP_JELLY_WHITE_GOJI')!;
    expect(problems.some((p) => p.includes(jelly.name_th) && p.includes('ทำจาก'))).toBe(true);
  });

  it('lets it go once nothing uses it', () => {
    const catalog = catalogWith({
      bom: BOM_ROWS.map((row) =>
        row.component_id === 'COMP_CONC_TAMARIND' ? { ...row, removed_at: AT } : row,
      ),
    });
    expect(componentRemovalBlockers(catalog, 'COMP_CONC_TAMARIND')).toEqual([]);
  });

  it('ignores the recipes of a removed drink', () => {
    const catalog = catalogWith({
      products: PRODUCTS.map((p) =>
        p.kind === 'BOTTLE' || p.id === 'DRINK_TAMARIND' ? { ...p, removed_at: AT } : p,
      ),
    });
    expect(componentRemovalBlockers(catalog, 'COMP_CONC_TAMARIND')).toEqual([]);
  });
});

describe('packagingItemRemovalBlockers', () => {
  const bought: PurchaseItem = {
    id: 'PI_LIDS',
    name_th: 'ฝาโดม (แพ็ค 50)',
    unit: 'แพ็ค',
    pack_size: 50,
    packaging_item_id: 'PKGI_LID',
    default_supplier_id: null,
    last_unit_cost: null,
    is_active: true,
    synced_at: null,
  };

  it('names the sets it is in, the topping and what is bought for it', () => {
    const problems = packagingItemRemovalBlockers(catalogWith(), 'PKGI_LID', [bought]);
    expect(problems.some((p) => p.startsWith('อยู่ในชุด '))).toBe(true);
    expect(problems.some((p) => p.includes('ฝาโดม (แพ็ค 50)'))).toBe(true);

    const ice = packagingItemRemovalBlockers(catalogWith(), 'PKGI_ICE', []);
    expect(ice.some((p) => p.startsWith('ท็อปปิ้ง '))).toBe(true);
  });

  it('does not count something no longer bought', () => {
    const problems = packagingItemRemovalBlockers(catalogWith({ packagingSets: [] }), 'PKGI_LID', [
      { ...bought, is_active: false },
    ]);
    expect(problems).toEqual([]);
  });
});

describe('packagingStock', () => {
  it('leaves a removed item off the shelf', () => {
    const catalog = catalogWith({
      packagingItems: PACKAGING_ITEMS.map((item) =>
        item.id === 'PKGI_LID' ? { ...item, removed_at: AT } : item,
      ),
    });
    const ids = packagingStock(catalog, []).map((entry) => entry.item.id);
    expect(ids).not.toContain('PKGI_LID');
    expect(packagingStock(catalogWith(), []).map((entry) => entry.item.id)).toContain('PKGI_LID');
  });
});
