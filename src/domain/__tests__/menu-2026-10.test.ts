/**
 * The menu of 12 Oct 2026 (docs/recipes-2026-10.md) through the real engines:
 * what each cup contains at each sweetness, what Yakult does to the syrup,
 * what a cup costs, and what limits it.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCostCatalog,
  lineCost,
  materialCost,
  packagingCost,
  uncostedComponents,
  unitPrice,
} from '../cost.ts';
import { recipeFor } from '../recipe.ts';
import { availableCups, productionMovement, type StockSnapshot } from '../stock.ts';
import { applyPromotions } from '../promotions.ts';
import { modifiersFor } from '../cart.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  VARIANTS,
} from '../../data/seed.ts';
import type { ComponentBatch } from '../../db/types.ts';

const catalog = buildCostCatalog({
  products: PRODUCTS,
  variants: VARIANTS,
  components: COMPONENTS,
  bom: BOM_ROWS,
  packagingSets: PACKAGING_SETS,
  packagingItems: PACKAGING_ITEMS,
  modifiers: MODIFIERS,
});

/** Per-cup quantities of a variant, by component, with modifiers applied. */
function cup(variantId: string, modifierIds: string[] = []): Record<string, number> {
  return Object.fromEntries(
    recipeFor(catalog, variantId, modifierIds).map((line) => [line.component.id, line.qty]),
  );
}

/** The PREP modifier offered on a drink under a given name. */
function sweetness(variantId: string, name: string): string {
  const found = modifiersFor(catalog, variantId, 'PREP').find((mod) => mod.name_th === name);
  if (!found) throw new Error(`${name} not offered on ${variantId}`);
  return found.id;
}

const LESS = 'หวานน้อย';
const MUCH_LESS = 'หวานน้อยมาก';
const NONE = 'ไม่เติมน้ำตาล';

describe('the menu', () => {
  it('is fourteen drinks and one dessert, every one with a recipe', () => {
    expect(PRODUCTS.filter((product) => product.kind === 'DRINK')).toHaveLength(14);
    expect(PRODUCTS.filter((product) => product.kind === 'DESSERT')).toHaveLength(1);
    for (const variant of VARIANTS) {
      expect(catalog.bomByVariant.get(variant.id), variant.id).toBeDefined();
    }
  });

  it('points every recipe line and modifier at something that exists', () => {
    for (const row of BOM_ROWS) {
      expect(catalog.components.has(row.component_id), row.component_id).toBe(true);
      expect(catalog.variants.has(row.variant_id), row.variant_id).toBe(true);
    }
    for (const mod of MODIFIERS) {
      for (const id of mod.applies_to_variant_ids) expect(catalog.variants.has(id), id).toBe(true);
      if (mod.component_id) expect(catalog.components.has(mod.component_id)).toBe(true);
    }
  });

  it('has the store prices of the master file, plain tea by the tea', () => {
    const price = (variantId: string) => unitPrice(catalog, variantId) / 100;
    expect(price('VAR_PEAR_ICED')).toBe(59);
    expect(price('VAR_CALAMANSI_ICED')).toBe(45);
    expect(price('VAR_PLAIN_BLACK')).toBe(35);
    expect(price('VAR_PLAIN_JASMINE')).toBe(39);
    expect(price('VAR_PLAIN_WHITE')).toBe(45);
    expect(price('VAR_PEAR_JELLY')).toBe(39);
    expect(unitPrice(catalog, 'VAR_CALAMANSI_ICED', ['MOD_YAKULT']) / 100).toBe(60);
  });

  it('carries the roselle warning on M14', () => {
    expect(catalog.products.get('DRINK_STRAWBERRY_ROSELLE')?.advisory_th).toContain(
      'ควรปรึกษาแพทย์ก่อนดื่มกระเจี๊ยบ',
    );
  });
});

describe('a cup at normal sweetness', () => {
  it('builds M1 from syrup, black tea jelly, Pile B, concentrate and black tea', () => {
    expect(cup('VAR_PEAR_ICED')).toEqual({
      COMP_SYRUP: 20,
      COMP_JELLY_RED_GOJI: 30,
      COMP_PEAR_FRESH: 21,
      COMP_CONC_PEAR: 50,
      COMP_TEA_RED: 200,
      COMP_CHRYS_GARNISH: 1,
    });
  });

  it('sweetens M2 with longan concentrate, never the central syrup', () => {
    expect(cup('VAR_LONGAN_ICED')).toEqual({
      COMP_LONGAN_FLESH: 22,
      COMP_LONGAN_CONC: 40,
      COMP_TEA_WHITE: 260,
      COMP_GARNISH_OSMANTHUS: 0.2,
    });
  });

  it('puts only syrup, the pitcher and a garnish in M10–M15', () => {
    expect(cup('VAR_PEACH_OOLONG_ICED')).toEqual({
      COMP_SYRUP: 30,
      COMP_PITCHER_PEACH_OOLONG: 290,
      COMP_GARNISH_PEACH: 1,
    });
  });
});

describe('sweetness', () => {
  it.each([
    ['VAR_PEAR_ICED', [20, 10, 10, 0]],
    ['VAR_PASSION_ICED', [30, 20, 10, null]],
    ['VAR_GRAPE_ICED', [30, 20, 10, 0]],
    ['VAR_LYCHEE_ICED', [20, 10, 0, null]],
    ['VAR_CALAMANSI_ICED', [30, 20, 10, 0]],
    ['VAR_CHRYS_ICED', [30, 20, 10, 0]],
    ['VAR_PLAIN_WHITE', [30, 20, 10, 0]],
    ['VAR_ORANGE_MINT_ICED', [30, 20, 10, 0]],
    ['VAR_STRAWBERRY_ROSELLE_ICED', [30, 20, 10, null]],
    ['VAR_BLUEBERRY_PEA_ICED', [30, 20, 10, 0]],
  ] as const)('pours %s at the §4 pumps', (variantId, [normal, less, muchLess, none]) => {
    const syrup = (mods: string[] = []) => cup(variantId, mods).COMP_SYRUP;
    expect(syrup()).toBe(normal);
    expect(syrup([sweetness(variantId, LESS)])).toBe(less);
    expect(syrup([sweetness(variantId, MUCH_LESS)])).toBe(muchLess);
    if (none === null) {
      expect(modifiersFor(catalog, variantId, 'PREP').map((mod) => mod.name_th)).not.toContain(
        NONE,
      );
    } else {
      expect(syrup([sweetness(variantId, NONE)])).toBe(none);
    }
  });

  // Not in the master file: the owner asked for it on 16 Oct 2026.
  it.each(VARIANTS.map((variant) => variant.id))(
    'pours หวานมาก on %s one pump over normal, wherever the sweetness is syrup',
    (variantId) => {
      const normal = cup(variantId).COMP_SYRUP;
      const extra = modifiersFor(catalog, variantId, 'PREP').find(
        (mod) => mod.name_th === 'หวานมาก',
      );
      if (normal === undefined) {
        // The longan is sweetened by its concentrate; the jelly cup is fixed.
        expect(extra).toBeUndefined();
        return;
      }
      expect(cup(variantId, [extra!.id]).COMP_SYRUP).toBe(normal + 10);
    },
  );

  it('takes 3 pumps out of หวานมาก for Yakult, as of any sweetness', () => {
    expect(cup('VAR_CALAMANSI_ICED', ['PREP_EXTRA_SWEET', 'MOD_YAKULT'])).toMatchObject({
      COMP_SYRUP: 10,
      COMP_YAKULT: 1,
    });
  });

  it('trades M2 concentrate for white tea on the bottom pour', () => {
    expect(cup('VAR_LONGAN_ICED', [sweetness('VAR_LONGAN_ICED', LESS)])).toMatchObject({
      COMP_LONGAN_CONC: 30,
      COMP_TEA_WHITE: 270,
    });
    expect(cup('VAR_LONGAN_ICED', [sweetness('VAR_LONGAN_ICED', MUCH_LESS)])).toMatchObject({
      COMP_LONGAN_CONC: 20,
      COMP_TEA_WHITE: 280,
    });
  });

  it('has no sweetness choice on the jelly cup', () => {
    expect(modifiersFor(catalog, 'VAR_PEAR_JELLY')).toEqual([]);
  });

  it('costs less sugar as less syrup', () => {
    const normal = materialCost(catalog, 'VAR_CALAMANSI_ICED');
    const none = materialCost(catalog, 'VAR_CALAMANSI_ICED', ['PREP_NO_SUGAR']);
    expect(normal - none).toBe(78);
  });
});

describe('Yakult', () => {
  it('goes in as one bottle and takes 3 pumps of syrup out, never below none', () => {
    expect(cup('VAR_CALAMANSI_ICED', ['MOD_YAKULT'])).toMatchObject({
      COMP_SYRUP: 0,
      COMP_YAKULT: 1,
    });
    expect(cup('VAR_LYCHEE_ICED', ['MOD_YAKULT']).COMP_SYRUP).toBe(0);
    expect(cup('VAR_GRAPE_ICED', ['PREP_LESS_SWEET', 'MOD_YAKULT']).COMP_SYRUP).toBe(0);
  });

  it('leaves plain jasmine one pump at normal and none below it', () => {
    expect(cup('VAR_PLAIN_JASMINE', ['MOD_YAKULT_JASMINE']).COMP_SYRUP).toBe(10);
    expect(cup('VAR_PLAIN_JASMINE', ['PREP_LESS_SWEET', 'MOD_YAKULT_JASMINE']).COMP_SYRUP).toBe(0);
  });

  it('is offered only on M3–M6 and plain jasmine', () => {
    const offered = VARIANTS.filter((variant) =>
      modifiersFor(catalog, variant.id, 'PAID').some((mod) => mod.name_th === 'ยาคูลท์'),
    ).map((variant) => variant.id);
    expect(offered.sort()).toEqual(
      [
        'VAR_CALAMANSI_ICED',
        'VAR_GRAPE_ICED',
        'VAR_LYCHEE_ICED',
        'VAR_PASSION_ICED',
        'VAR_PLAIN_JASMINE',
      ].sort(),
    );
  });
});

describe('cost per cup', () => {
  // docs/recipes-2026-10.md §7 puts M10–M15 at 13.9 / 11.2 / 20.0 / 19.2 /
  // 14.7 / 18.5 THB. The app comes in under every one, for reasons it can
  // name rather than force away:
  // - packaging: cup 1.18 + lid 0.59 + straw 0.14 + bag 0.20 = 2.11 THB, not
  //   the cost file's 3.45 (1.34 THB a cup);
  // - the cost file adds 5% waste and splits a pitcher over 10 cups (300 ml);
  //   the app counts waste when it is thrown away, and a cup pours 290 ml;
  // - mint (g per leaf), calamansi (g per fruit) and every garnish have no
  //   price yet.
  it.each([
    ['VAR_ORANGE_MINT_ICED', 987],
    ['VAR_PINEAPPLE_GINGER_ICED', 800],
    ['VAR_RASPBERRY_ICED', 1397],
    ['VAR_PEACH_OOLONG_ICED', 1497],
    ['VAR_STRAWBERRY_ROSELLE_ICED', 1190],
    ['VAR_BLUEBERRY_PEA_ICED', 1416],
  ])('puts %s at %i satang', (variantId, satang) => {
    expect(lineCost(catalog, variantId)).toBe(satang);
  });

  it('accounts for the whole of M13’s gap to the cost file', () => {
    // Peach oolong is the one pitcher with every ingredient priced.
    const pitcherBatch = 24 * 1 + 600 * 0.13 + 15 + 60 * 0.04;
    const costFilePitcher = (pitcherBatch * 1.05) / 10;
    const appPitcher = (pitcherBatch / 3000) * 290;
    const packagingGap = 3.45 - 2.11;
    const garnish = 19.2 - (costFilePitcher + 0.78 + 0.54 + 3.45);
    expect(lineCost(catalog, 'VAR_PEACH_OOLONG_ICED') / 100).toBeCloseTo(
      19.2 - (costFilePitcher - appPitcher) - packagingGap - garnish,
      1,
    );
  });

  it('uses the ice price of the master file', () => {
    expect(packagingCost(catalog, 'VAR_ORANGE_MINT_ICED')).toBe(118 + 59 + 14 + 54 + 20);
  });

  it('says which components of a cup have no cost yet', () => {
    expect(uncostedComponents(catalog, 'VAR_PLAIN_BLACK')).toEqual([]);
    expect(
      uncostedComponents(catalog, 'VAR_PEAR_ICED')
        .map((c) => c.id)
        .sort(),
    ).toEqual(['COMP_CONC_PEAR', 'COMP_JELLY_RED_GOJI'].sort());
    // A cup with no syrup in it does not ask for the syrup's cost.
    expect(
      uncostedComponents(catalog, 'VAR_CHRYS_ICED', ['PREP_NO_SUGAR']).map((c) => c.id),
    ).not.toContain('COMP_SYRUP');
  });
});

describe('available cups', () => {
  function stocked(entries: Array<[string, number]>): StockSnapshot {
    const batches: ComponentBatch[] = entries.map(([componentId, qty]) => ({
      id: `B_${componentId}`,
      component_id: componentId,
      made_at: '2026-10-12T00:00:00.000Z',
      qty_made: qty,
      state: 'READY',
      ready_at: '2026-10-12T00:00:00.000Z',
      expires_at: '2026-10-20T00:00:00.000Z',
      parent_batch_id: null,
      note: null,
      synced_at: null,
    }));
    return {
      batches,
      movements: batches.map((batch) => productionMovement(batch, batch.made_at)),
    };
  }

  it('is limited by the pitcher, never by a garnish nobody counts', () => {
    const stock = stocked([
      ['COMP_SYRUP', 2000],
      ['COMP_PITCHER_RASPBERRY', 1500],
    ]);
    expect(availableCups(catalog, stock, 'VAR_RASPBERRY_ICED')).toEqual({
      cups: 5,
      limitingComponentId: 'COMP_PITCHER_RASPBERRY',
    });
  });

  it('sells every syrup drink out when the syrup runs out', () => {
    const stock = stocked([
      ['COMP_SYRUP', 25],
      ['COMP_TEA_RED', 9000],
    ]);
    expect(availableCups(catalog, stock, 'VAR_PLAIN_BLACK')).toEqual({
      cups: 0,
      limitingComponentId: 'COMP_SYRUP',
    });
  });
});

describe('the jelly cup', () => {
  it('is a dessert: two of them are not a two-cup pair', () => {
    const priced = applyPromotions(
      catalog,
      {
        twoCupEnabled: true,
        twoCupAmount: 1000,
        rainyDayEnabled: false,
        rainyDayAmount: 0,
        rainyDayVariantId: null,
      },
      [{ lineId: 'L1', variantId: 'VAR_PEAR_JELLY', qty: 2, unitPrice: 3900, manualReason: null }],
      '2026-10-12T05:00:00.000Z',
    );
    expect(priced.totalDiscount).toBe(0);
  });
});
