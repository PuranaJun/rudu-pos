import { beforeAll, describe, expect, it } from 'vitest';
import {
  countMovement,
  movement,
  packagingForSale,
  packagingPerCup,
  packagingRemaining,
  packagingStock,
  packagingWarnings,
  reversePackaging,
} from '../packaging.ts';
import { buildCostCatalog, packagingCost, type CostCatalog } from '../cost.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  VARIANTS,
} from '../../data/seed.ts';

let catalog: CostCatalog;
const NOW = '2026-10-12T03:00:00.000Z';

beforeAll(() => {
  catalog = buildCostCatalog({
    products: PRODUCTS,
    variants: VARIANTS,
    components: COMPONENTS,
    bom: BOM_ROWS,
    packagingSets: PACKAGING_SETS,
    packagingItems: PACKAGING_ITEMS,
    modifiers: MODIFIERS,
  });
});

describe('packagingPerCup', () => {
  it('is the variant’s set, less what a modifier takes out', () => {
    const iced = packagingPerCup(catalog, 'VAR_TAMARIND_ICED').map((u) => u.packagingItemId);
    expect(iced).toContain('PKGI_ICE');
    const noIce = packagingPerCup(catalog, 'VAR_TAMARIND_ICED', ['PREP_NO_ICE']).map(
      (u) => u.packagingItemId,
    );
    expect(noIce).not.toContain('PKGI_ICE');
    expect(noIce).toContain('PKGI_CUP_PLASTIC_16OZ');
  });

  it('is exactly what the cost engine prices', () => {
    const priced = packagingPerCup(catalog, 'VAR_PEAR_HOT').reduce(
      (total, use) => total + catalog.packagingItems.get(use.packagingItemId)!.unit_cost * use.qty,
      0,
    );
    expect(priced).toBe(packagingCost(catalog, 'VAR_PEAR_HOT'));
  });
});

describe('packagingForSale', () => {
  it('takes the counted items, per cup, and leaves ice alone', () => {
    const movements = packagingForSale(
      catalog,
      [{ saleLineId: 'L1', variantId: 'VAR_TAMARIND_ICED', qty: 3, modifierIds: [] }],
      NOW,
    );
    const cups = movements.find((m) => m.packaging_item_id === 'PKGI_CUP_PLASTIC_16OZ');
    expect(cups).toMatchObject({ qty_delta: -3, reason: 'SALE', sale_line_id: 'L1' });
    expect(movements.some((m) => m.packaging_item_id === 'PKGI_ICE')).toBe(false);
  });
});

describe('reversePackaging', () => {
  it('puts back what a sale took, once', () => {
    const sold = packagingForSale(
      catalog,
      [{ saleLineId: 'L1', variantId: 'VAR_PEAR_HOT', qty: 2, modifierIds: [] }],
      NOW,
    );
    const back = reversePackaging(['L1'], sold, NOW);
    expect(back).toHaveLength(sold.length);
    expect(packagingRemaining('PKGI_CUP_PAPER_HOT', [...sold, ...back])).toBe(0);
    // A second void finds nothing left to reverse.
    expect(reversePackaging(['L1'], [...sold, ...back], NOW)).toEqual([]);
  });
});

describe('the count and the warnings', () => {
  it('is unknown until counted, then the count settles whatever sold before it', () => {
    const sold = packagingForSale(
      catalog,
      [{ saleLineId: 'L1', variantId: 'VAR_TAMARIND_ICED', qty: 5, modifierIds: [] }],
      NOW,
    );
    const before = packagingStock(catalog, sold).find(
      (s) => s.item.id === 'PKGI_CUP_PLASTIC_16OZ',
    )!;
    expect(before).toMatchObject({ remaining: null, level: 'UNCOUNTED' });

    const count = countMovement('PKGI_CUP_PLASTIC_16OZ', 200, sold, NOW);
    expect(count.qty_delta).toBe(205);
    const after = packagingStock(catalog, [...sold, count]).find(
      (s) => s.item.id === 'PKGI_CUP_PLASTIC_16OZ',
    )!;
    expect(after).toMatchObject({ remaining: 200, level: 'OK' });
  });

  it('warns low at the reorder point and out at zero, out first', () => {
    const withReorder = buildCostCatalog({
      products: PRODUCTS,
      variants: VARIANTS,
      components: COMPONENTS,
      bom: BOM_ROWS,
      packagingSets: PACKAGING_SETS,
      packagingItems: PACKAGING_ITEMS.map((item) =>
        item.id === 'PKGI_LID' ? { ...item, reorder_at: 50 } : item,
      ),
      modifiers: MODIFIERS,
    });
    const stock = packagingStock(withReorder, [
      movement('PKGI_LID', 40, 'COUNT', NOW),
      movement('PKGI_CUP_PLASTIC_16OZ', 0, 'COUNT', NOW),
      movement('PKGI_STRAW_WIDE', 30, 'COUNT', NOW),
    ]);
    expect(packagingWarnings(stock).map((s) => [s.item.id, s.level])).toEqual([
      ['PKGI_CUP_PLASTIC_16OZ', 'OUT'],
      ['PKGI_LID', 'LOW'],
    ]);
  });

  it('never lists ice', () => {
    expect(packagingStock(catalog, []).some((s) => s.item.id === 'PKGI_ICE')).toBe(false);
  });
});
