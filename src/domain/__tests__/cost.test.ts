/**
 * The margin table in docs/seed-data.md §6.3, as a fixture.
 *
 * Every row reconciles to the satang against the seeded catalog. A recipe or
 * cost change that quietly breaks the model fails here instead of surfacing as
 * a wrong COGS number three months into trading.
 *
 * The catalog is read out of a real (fake-indexeddb) database, so this also
 * proves the engine takes its costs from rows rather than from constants.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';
import { RuduPosDB } from '../../db/database.ts';
import { loadCostCatalog } from '../../db/catalog.ts';
import { ensureSeeded } from '../../db/seed.ts';
import {
  buildCostCatalog,
  grossMarginPct,
  grossProfit,
  lineCost,
  materialCost,
  packagingCost,
  unitPrice,
  type CostCatalog,
} from '../cost.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

beforeAll(async () => {
  dbName = `rudu-cost-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterAll(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

interface MarginRow {
  label: string;
  variantId: string;
  modifierIds: string[];
  material: number;
  packaging: number;
  total: number;
  price: number;
  profit: number;
  gp: number;
}

/** docs/seed-data.md §6.3, in satang. */
const MARGIN_TABLE: MarginRow[] = [
  {
    label: 'Tamarind, iced',
    variantId: 'VAR_TAMARIND_ICED',
    modifierIds: [],
    material: 332,
    packaging: 352,
    total: 684,
    price: 4000,
    profit: 3316,
    gp: 82.9,
  },
  {
    label: 'Tamarind + basil seed',
    variantId: 'VAR_TAMARIND_ICED',
    modifierIds: ['MOD_BASIL_SEED'],
    material: 407,
    packaging: 352,
    total: 759,
    price: 4500,
    profit: 3741,
    gp: 83.1,
  },
  {
    label: 'Tamarind + salted plum',
    variantId: 'VAR_TAMARIND_ICED',
    modifierIds: ['MOD_SALTED_PLUM'],
    material: 457,
    packaging: 352,
    total: 809,
    price: 4500,
    profit: 3691,
    gp: 82.0,
  },
  {
    label: 'Pear, iced',
    variantId: 'VAR_PEAR_ICED',
    modifierIds: [],
    material: 773,
    packaging: 387,
    total: 1160,
    price: 5900,
    profit: 4740,
    gp: 80.3,
  },
  {
    label: 'Pear, iced + peach gum',
    variantId: 'VAR_PEAR_ICED',
    modifierIds: ['MOD_PEACH_GUM'],
    material: 853,
    packaging: 387,
    total: 1240,
    price: 6900,
    profit: 5660,
    gp: 82.0,
  },
  {
    label: 'Pear, hot',
    variantId: 'VAR_PEAR_HOT',
    modifierIds: [],
    material: 785,
    packaging: 294,
    total: 1079,
    price: 5900,
    profit: 4821,
    gp: 81.7,
  },
  {
    label: 'Bottle 1 L',
    variantId: 'VAR_BOTTLE_TAMARIND',
    modifierIds: [],
    material: 972,
    packaging: 700,
    total: 1672,
    price: 9900,
    profit: 8228,
    gp: 83.1,
  },
];

describe('margin table, docs/seed-data.md §6.3', () => {
  it.each(MARGIN_TABLE)('$label', (row) => {
    expect(materialCost(catalog, row.variantId, row.modifierIds)).toBe(row.material);
    expect(packagingCost(catalog, row.variantId, row.modifierIds)).toBe(row.packaging);
    expect(lineCost(catalog, row.variantId, row.modifierIds)).toBe(row.total);
    expect(unitPrice(catalog, row.variantId, row.modifierIds)).toBe(row.price);
    expect(grossProfit(row.price, row.total)).toBe(row.profit);
    expect(grossMarginPct(row.price, row.total)).toBeCloseTo(row.gp, 1);
  });

  it('blends two plain drinks to 9.22 cost, 40.28 profit, 81.4% GP', () => {
    const tamarind = lineCost(catalog, 'VAR_TAMARIND_ICED');
    const pear = lineCost(catalog, 'VAR_PEAR_ICED');
    const cost = (tamarind + pear) / 2;
    const price =
      (unitPrice(catalog, 'VAR_TAMARIND_ICED') + unitPrice(catalog, 'VAR_PEAR_ICED')) / 2;

    expect(cost).toBe(922);
    expect(price).toBe(4950);
    expect(grossProfit(price, cost)).toBe(4028);
    expect(grossMarginPct(price, cost)).toBeCloseTo(81.4, 1);
  });
});

describe('preparation instructions', () => {
  it('PREP_LESS_SWEET drops the concentrate to 35 ml, whichever concentrate it is', () => {
    // Tamarind: 50 ml at 0.0482 = 241 satang, 35 ml = 169.
    expect(materialCost(catalog, 'VAR_TAMARIND_ICED', ['PREP_LESS_SWEET'])).toBe(332 - 241 + 169);
    // Pear: 50 ml at 0.0954 = 477 satang, 35 ml = 334.
    expect(materialCost(catalog, 'VAR_PEAR_ICED', ['PREP_LESS_SWEET'])).toBe(773 - 477 + 334);
  });

  it('PREP_LESS_SWEET leaves the tea base and the solids alone', () => {
    const full = materialCost(catalog, 'VAR_PEAR_HOT');
    const less = materialCost(catalog, 'VAR_PEAR_HOT', ['PREP_LESS_SWEET']);
    // Only the concentrate moves: 477 → 334.
    expect(full - less).toBe(143);
  });

  it('PREP_NO_ICE removes the ice item, not a fixed amount', () => {
    const ice = 100;
    expect(packagingCost(catalog, 'VAR_TAMARIND_ICED', ['PREP_NO_ICE'])).toBe(352 - ice);
    expect(packagingCost(catalog, 'VAR_PEAR_ICED', ['PREP_NO_ICE'])).toBe(387 - ice);
    // It also costs nothing in material — the ice is packaging.
    expect(materialCost(catalog, 'VAR_TAMARIND_ICED', ['PREP_NO_ICE'])).toBe(332);
  });

  it('PREP_NO_ICE tracks the price of ice rather than hardcoding it', async () => {
    await db.packaging_item.update('PKGI_ICE', { unit_cost: 150 });
    const dearerIce = await loadCostCatalog(db);

    expect(packagingCost(dearerIce, 'VAR_TAMARIND_ICED')).toBe(402);
    expect(packagingCost(dearerIce, 'VAR_TAMARIND_ICED', ['PREP_NO_ICE'])).toBe(252);

    await db.packaging_item.update('PKGI_ICE', { unit_cost: 100 });
  });

  it('PREP_TAKEAWAY_BAG changes nothing — the bag is already in the set', () => {
    for (const variantId of ['VAR_TAMARIND_ICED', 'VAR_PEAR_ICED', 'VAR_PEAR_HOT']) {
      expect(lineCost(catalog, variantId, ['PREP_TAKEAWAY_BAG'])).toBe(
        lineCost(catalog, variantId),
      );
    }
  });

  it('PREP_NO_SOLIDS still costs the solids — they were portioned for this cup', () => {
    expect(lineCost(catalog, 'VAR_PEAR_ICED', ['PREP_NO_SOLIDS'])).toBe(
      lineCost(catalog, 'VAR_PEAR_ICED'),
    );
  });

  it('combines instructions additively', () => {
    const both = lineCost(catalog, 'VAR_TAMARIND_ICED', ['PREP_LESS_SWEET', 'PREP_NO_ICE']);
    expect(both).toBe(332 - 241 + 169 + 352 - 100);
  });
});

describe('the garnish', () => {
  it('is in both pear variants and neither tamarind one', () => {
    const garnish = 3;
    const pearRows = catalog.bomByVariant.get('VAR_PEAR_ICED') ?? [];
    expect(pearRows.some((row) => row.component_id === 'COMP_CHRYS_GARNISH')).toBe(true);

    // Removing it would drop pear material from 7.73 to 7.70, which is exactly
    // the discrepancy that says the §6.3 table has stopped reconciling.
    expect(materialCost(catalog, 'VAR_PEAR_ICED')).toBe(770 + garnish);
    expect(materialCost(catalog, 'VAR_PEAR_HOT')).toBe(782 + garnish);

    const tamarindRows = catalog.bomByVariant.get('VAR_TAMARIND_ICED') ?? [];
    expect(tamarindRows.some((row) => row.component_id === 'COMP_CHRYS_GARNISH')).toBe(false);
  });
});

describe('costs come from the database, not from the module', () => {
  afterEach(async () => {
    await db.component.update('COMP_CONC_PEAR', { cost_per_unit: 0.0954 });
  });

  it('follows a cost the owner edits in settings', async () => {
    await db.component.update('COMP_CONC_PEAR', { cost_per_unit: 0.1954 });
    const dearer = await loadCostCatalog(db);

    // 50 ml at 0.1954 = 977 satang instead of 477.
    expect(materialCost(dearer, 'VAR_PEAR_ICED')).toBe(773 + 500);
    // The original catalog object is untouched — it is a snapshot, not a view.
    expect(materialCost(catalog, 'VAR_PEAR_ICED')).toBe(773);
  });

  it('follows a BOM quantity the owner edits after a taste test', async () => {
    await db.bom.update('BOM_VAR_PEAR_ICED_COMP_CONC_PEAR', { qty_per_cup: 60 });
    const stronger = await loadCostCatalog(db);

    // 60 ml at 0.0954 = 572 satang instead of 477.
    expect(materialCost(stronger, 'VAR_PEAR_ICED')).toBe(773 - 477 + 572);

    await db.bom.update('BOM_VAR_PEAR_ICED_COMP_CONC_PEAR', { qty_per_cup: 50 });
  });
});

describe('failure modes', () => {
  it('is pure — the same catalog gives the same answer', () => {
    expect(lineCost(catalog, 'VAR_PEAR_HOT')).toBe(lineCost(catalog, 'VAR_PEAR_HOT'));
  });

  it('throws on an unknown variant rather than returning zero', () => {
    expect(() => lineCost(catalog, 'VAR_DOES_NOT_EXIST')).toThrow(/VAR_DOES_NOT_EXIST/);
  });

  it('throws when a BOM row points at a missing component', () => {
    const broken = buildCostCatalog({
      products: [...catalog.products.values()],
      variants: [...catalog.variants.values()],
      components: [...catalog.components.values()].filter((c) => c.id !== 'COMP_TEA_RED'),
      bom: [...catalog.bomByVariant.values()].flat(),
      packagingSets: [...catalog.packagingSets.values()],
      packagingItems: [...catalog.packagingItems.values()],
      modifiers: [...catalog.modifiers.values()],
    });

    expect(() => materialCost(broken, 'VAR_TAMARIND_ICED')).toThrow(/COMP_TEA_RED/);
  });
});
