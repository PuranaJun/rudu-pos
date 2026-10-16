import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { ensureSeeded, resetAndReseed } from './seed.ts';
import { seedLegacyCatalog } from './legacy-catalog.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  EXTRA_SWEET_MODIFIERS,
  MODIFIERS,
  PRODUCTS,
  PURCHASE_ITEMS,
  SEED_VERSION,
  SEED_VERSION_KEY,
  VARIANTS,
} from '../data/seed.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-pos-test-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

async function bomFor(variantId: string): Promise<Record<string, number>> {
  const rows = await db.bom.where('variant_id').equals(variantId).toArray();
  return Object.fromEntries(rows.map((row) => [row.component_id, row.qty_per_cup]));
}

async function setCost(setId: string): Promise<number> {
  const set = await db.packaging_set.get(setId);
  const items = await db.packaging_item.toArray();
  return (set?.items ?? []).reduce((total, line) => {
    const item = items.find((candidate) => candidate.id === line.packaging_item_id);
    return total + (item?.unit_cost ?? 0) * line.qty;
  }, 0);
}

describe('ensureSeeded', () => {
  it('loads the menu of the master file on first run and reports that it did', async () => {
    expect(await ensureSeeded(db)).toBe(true);

    expect(await db.product.count()).toBe(PRODUCTS.length);
    expect(PRODUCTS).toHaveLength(15);
    expect(await db.variant.count()).toBe(VARIANTS.length);
    expect(await db.component.count()).toBe(COMPONENTS.length);
    expect(await db.modifier.count()).toBe(MODIFIERS.length);
    expect(await db.bom.count()).toBe(BOM_ROWS.length);
    expect(await db.purchase_item.count()).toBe(PURCHASE_ITEMS.length);
  });

  it('records the seed version as the guard flag', async () => {
    await ensureSeeded(db);
    expect(await db.setting.get(SEED_VERSION_KEY)).toMatchObject({ value: SEED_VERSION });
  });

  it('does not run twice, and does not duplicate rows', async () => {
    await ensureSeeded(db);
    expect(await ensureSeeded(db)).toBe(false);
    expect(await db.bom.count()).toBe(BOM_ROWS.length);
    expect(await db.product.count()).toBe(PRODUCTS.length);
  });

  it('leaves owner edits alone on the next launch', async () => {
    await ensureSeeded(db);
    // The shop raises the pear to 65 in settings.
    await db.product.update('DRINK_PEAR', { base_price: 6500 });

    await ensureSeeded(db);

    expect((await db.product.get('DRINK_PEAR'))?.base_price).toBe(6500);
  });

  it('offers no rainy-day drink: there is no hot drink on the menu', async () => {
    await ensureSeeded(db);
    expect((await db.setting.get('promo_rainy_day_variant_id'))?.value).toBeNull();
  });
});

describe('bill of materials', () => {
  beforeEach(async () => {
    await ensureSeeded(db);
  });

  it('pours every tea ready to drink — no plain water at assembly', async () => {
    const water = (await db.component.toArray()).filter((c) => c.name_th.includes('น้ำเปล่า'));
    expect(water).toEqual([]);
  });

  it('makes the black tea jelly out of the black tea, 600 ml a litre', async () => {
    expect(await db.component.get('COMP_JELLY_RED_GOJI')).toMatchObject({
      source_component_id: 'COMP_TEA_RED',
      source_qty_per_unit: 0.6,
      lifecycle: 'SLAB_CUT',
      shelf_life_hours: 72,
      cut_shelf_life_hours: 24,
    });
  });

  it('makes the jelly cups out of the pear concentrate, 400 ml a batch', async () => {
    const jelly = await db.component.get('COMP_PEAR_JELLY');
    expect((jelly?.source_qty_per_unit ?? 0) * (jelly?.default_batch_qty ?? 0)).toBe(400);
    expect(await bomFor('VAR_PEAR_JELLY')).toEqual({ COMP_PEAR_JELLY: 160 });
  });

  it.each([
    ['COMP_TEA_RED', 72],
    ['COMP_TEA_WHITE', 72],
    ['COMP_TEA_JASMINE', 48],
    ['COMP_BUTTERFLY_PEA', 72],
    ['COMP_CHRYS_TEA', 72],
    ['COMP_SYRUP', 336],
    ['COMP_LONGAN_CONC', 168],
    ['COMP_LONGAN_FLESH', 120],
    ['COMP_CONC_PEAR', 120],
    ['COMP_BASE_PASSION', 96],
    ['COMP_BASE_CALAMANSI', 96],
    ['COMP_BASE_LYCHEE', 72],
    ['COMP_GRAPE_MASH', 48],
    ['COMP_PEAR_JELLY', 48],
    ['COMP_PITCHER_RASPBERRY', 48],
    ['COMP_PEAR_FRESH', 24],
  ])('keeps %s for the §6 shelf life (%i h)', async (componentId, hours) => {
    expect((await db.component.get(componentId))?.shelf_life_hours).toBe(hours);
  });

  it('steeps the pineapple pitcher 6 hours at most, the others 12', async () => {
    expect((await db.component.get('COMP_PITCHER_PINEAPPLE_GINGER'))?.lead_time_hours).toBe(6);
    expect((await db.component.get('COMP_PITCHER_ORANGE_MINT'))?.lead_time_hours).toBe(12);
  });

  it('points every row at a component that exists', async () => {
    const componentIds = new Set((await db.component.toArray()).map((c) => c.id));
    const rows = await db.bom.toArray();
    expect(rows.filter((row) => !componentIds.has(row.component_id))).toEqual([]);
  });
});

describe('packaging sets', () => {
  beforeEach(async () => {
    await ensureSeeded(db);
  });

  // Cup, lid, straw, ice and bag, in satang — not the cost file's 3.45 + ice,
  // because the item prices on the phone add up to less.
  it.each([
    ['PKG_ICED_STRAW', 118 + 59 + 14 + 54 + 20],
    ['PKG_ICED_STRAW_SPOON', 118 + 59 + 25 + 35 + 54 + 20],
  ])('%s costs %i satang', async (setId, expected) => {
    expect(await setCost(setId)).toBe(expected);
  });

  it('gives menus 1–5 a large straw and a spoon, and the rest a regular straw', async () => {
    expect((await db.variant.get('VAR_GRAPE_ICED'))?.packaging_set_id).toBe('PKG_ICED_STRAW_SPOON');
    expect((await db.variant.get('VAR_CALAMANSI_ICED'))?.packaging_set_id).toBe('PKG_ICED_STRAW');
    expect((await db.variant.get('VAR_PEAR_JELLY'))?.packaging_set_id).toBe('PKG_JELLY_CUP');
  });
});

describe('purchase items', () => {
  it('lists the raw ingredients with the prices the master file gives, and none it does not', async () => {
    await ensureSeeded(db);
    expect((await db.purchase_item.get('PI_TEA_BLACK'))?.last_unit_cost).toBe(40_000);
    expect(await db.purchase_item.get('PI_LEMON')).toMatchObject({
      unit: 'ลูก',
      last_unit_cost: 1500,
    });
    expect((await db.purchase_item.get('PI_HONEY'))?.last_unit_cost).toBeNull();
  });
});

describe('resetAndReseed', () => {
  it('clears trading history and reloads the catalog', async () => {
    await ensureSeeded(db);
    await db.sale_line.put({
      id: crypto.randomUUID(),
      sale_id: crypto.randomUUID(),
      variant_id: 'VAR_PEAR_ICED',
      qty: 1,
      unit_price: 5900,
      line_discount: 0,
      discount_reason: null,
      unit_cost: 684,
      synced_at: null,
    });
    await db.product.update('DRINK_PEAR', { base_price: 6500 });

    await resetAndReseed(db);

    expect(await db.sale_line.count()).toBe(0);
    expect(await db.product.count()).toBe(PRODUCTS.length);
    expect((await db.product.get('DRINK_PEAR'))?.base_price).toBe(5900);
  });
});

describe('upgrading a database seeded by an older build', () => {
  /** The v9 menu, rolled back to how v1 stored it. */
  async function rollBackToV1(): Promise<void> {
    await seedLegacyCatalog(db);
    for (const component of await db.component.toArray()) {
      delete (component as Partial<typeof component>).role;
      delete (component as Partial<typeof component>).is_active;
      await db.component.put(component);
    }
    for (const modifier of await db.modifier.toArray()) {
      delete (modifier as Partial<typeof modifier>).removes_packaging_item_id;
      delete (modifier as Partial<typeof modifier>).overrides_component_role;
      delete (modifier as Partial<typeof modifier>).adjusts_component_role;
      delete (modifier as Partial<typeof modifier>).adjust_qty_per_cup;
      // v1 priced "no ice" as a hardcoded -1.00 instead of removing the item.
      await db.modifier.put({
        ...modifier,
        cost_delta: modifier.id === 'PREP_NO_ICE' ? -100 : modifier.cost_delta,
      });
    }
    await db.setting.put({ key: SEED_VERSION_KEY, value: 1, synced_at: null });
  }

  it('backfills the columns v2 added, on rows the new menu no longer uses', async () => {
    await rollBackToV1();
    expect((await db.component.get('COMP_JELLY_CHRYS'))?.role).toBeUndefined();

    expect(await ensureSeeded(db)).toBe(true);

    expect((await db.component.get('COMP_JELLY_CHRYS'))?.role).toBe('SOLID');
    expect((await db.component.get('COMP_CONC_TAMARIND'))?.role).toBe('CONCENTRATE');
    expect((await db.modifier.get('PREP_NO_ICE'))?.removes_packaging_item_id).toBe('PKGI_ICE');
    expect((await db.modifier.get('MOD_BASIL_SEED'))?.removes_packaging_item_id).toBeNull();
  });

  it('drops the hardcoded no-ice discount now that the item is removed instead', async () => {
    await rollBackToV1();
    await ensureSeeded(db);

    expect((await db.modifier.get('PREP_NO_ICE'))?.cost_delta).toBe(0);
  });

  it('gives every component and modifier the columns v10 added', async () => {
    await rollBackToV1();
    await ensureSeeded(db);

    for (const component of await db.component.toArray()) {
      expect(typeof component.is_active, component.id).toBe('boolean');
    }
    for (const modifier of await db.modifier.toArray()) {
      expect(modifier.adjusts_component_role, modifier.id).not.toBeUndefined();
      expect(modifier.adjust_qty_per_cup, modifier.id).not.toBeUndefined();
    }
  });

  it('applies the master file’s price, over an older edit, to a drink still on the menu', async () => {
    await rollBackToV1();
    await db.product.update('DRINK_PEAR', { base_price: 6500 });

    await ensureSeeded(db);

    // The master file prices pear at 59: the recipe update is asked to apply it.
    expect((await db.product.get('DRINK_PEAR'))?.base_price).toBe(5900);
  });

  it('moves an edited prep time off the old setting and onto its component (v7)', async () => {
    await seedLegacyCatalog(db);
    for (const component of await db.component.toArray()) {
      delete (component as Partial<typeof component>).source_component_id;
      delete (component as Partial<typeof component>).source_qty_per_unit;
      delete (component as Partial<typeof component>).prep_start_by;
      await db.component.put(component);
    }
    // The owner had moved red tea to 20:30 under v6.
    await db.setting.put({ key: 'prep_reminder_red_tea', value: '20:30', synced_at: null });
    await db.setting.put({ key: 'prep_reminder_white_tea', value: '19:00', synced_at: null });
    await db.setting.put({ key: SEED_VERSION_KEY, value: 6, synced_at: null });

    await ensureSeeded(db);

    // …and the recipe update keeps it: it is when she starts, not the recipe.
    expect((await db.component.get('COMP_TEA_RED'))?.prep_start_by).toBe('20:30');
    expect((await db.component.get('COMP_TEA_WHITE'))?.prep_start_by).toBe('19:00');
    expect((await db.component.get('COMP_JELLY_CHRYS'))?.prep_start_by).toBeNull();
    expect(await db.setting.get('prep_reminder_red_tea')).toBeUndefined();
  });

  it('does not run again once it has upgraded', async () => {
    await rollBackToV1();
    expect(await ensureSeeded(db)).toBe(true);
    expect(await ensureSeeded(db)).toBe(false);
  });
});

describe('upgrading a phone already on the menu of Oct 2026 (v11)', () => {
  /** The shop phone as it was: seeded at v11, before หวานมาก. */
  async function phoneAtV11() {
    await ensureSeeded(db);
    await db.modifier.bulkDelete(EXTRA_SWEET_MODIFIERS.map((modifier) => modifier.id));
    await db.setting.put({ key: SEED_VERSION_KEY, value: 11, synced_at: null });
  }

  it('adds หวานมาก, one pump over normal, to the drinks sweetened with syrup', async () => {
    await phoneAtV11();
    expect(await ensureSeeded(db)).toBe(true);

    expect(await db.modifier.get('PREP_EXTRA_SWEET')).toMatchObject({
      name_th: 'หวานมาก',
      kind: 'PREP',
      overrides_component_role: 'SWEETENER',
      qty_per_cup: 40,
    });
    expect(await db.modifier.get('PREP_EXTRA_SWEET_3_PUMPS')).toMatchObject({
      qty_per_cup: 30,
      applies_to_variant_ids: ['VAR_PEAR_ICED', 'VAR_LYCHEE_ICED'],
    });
    // A new row the cloud has not had: the next send takes it to the iPhone.
    expect((await db.modifier.get('PREP_EXTRA_SWEET'))?.sync_dirty).toBe(1);
  });

  it('leaves one the owner already made or changed alone', async () => {
    await phoneAtV11();
    await db.modifier.put({ ...EXTRA_SWEET_MODIFIERS[0]!, name_th: 'หวานเจี๊ยบ', qty_per_cup: 50 });

    await ensureSeeded(db);

    expect(await db.modifier.get('PREP_EXTRA_SWEET')).toMatchObject({
      name_th: 'หวานเจี๊ยบ',
      qty_per_cup: 50,
    });
    expect(await db.modifier.get('PREP_EXTRA_SWEET_3_PUMPS')).toBeDefined();
  });
});
