/**
 * The recipe update on a phone that has been trading on the old menu: what
 * it replaces, what it keeps, and that no history comes loose.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { ensureSeeded } from './seed.ts';
import { seedLegacyCatalog } from './legacy-catalog.ts';
import { productionMovement } from '../domain/stock.ts';
import { PRODUCTS, SEED_VERSION_KEY } from '../data/seed.ts';
import type { ComponentBatch } from './types.ts';

let db: RuduPosDB;
let dbName: string;

const OWNER_JASMINE = 'owner-made-jasmine-tea';

beforeEach(async () => {
  dbName = `rudu-recipe-update-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();

  // A phone on the v9 menu, with a week of the owner's own changes on it.
  await seedLegacyCatalog(db);
  await db.setting.put({ key: SEED_VERSION_KEY, value: 9, synced_at: null });

  await db.component.update('COMP_TEA_RED', { prep_start_by: '20:15' });
  await db.component.update('COMP_PEAR_FRESH', { cost_per_unit: 0.08 });
  await db.bom.update('BOM_VAR_PEAR_ICED_COMP_CHRYS_GARNISH', { qty_per_cup: 2 });
  await db.packaging_item.update('PKGI_CUP_PLASTIC_16OZ', { unit_cost: 125, reorder_at: 50 });
  // She had started setting up jasmine tea herself, under its Thai name.
  const jasmine = (await db.component.get('COMP_TEA_WHITE'))!;
  await db.component.put({
    ...jasmine,
    id: OWNER_JASMINE,
    name_th: 'ชามะลิสกัดเย็น',
    prep_start_by: null,
  });
  await db.purchase_item.put({
    id: 'owner-black-tea',
    name_th: 'ใบชาแดง',
    unit: 'ถุง',
    pack_size: null,
    packaging_item_id: null,
    default_supplier_id: null,
    last_unit_cost: 9900,
    is_active: true,
    synced_at: null,
  });

  // And she has sold tamarind from a batch still in the fridge.
  const batch: ComponentBatch = {
    id: 'B_TAMARIND',
    component_id: 'COMP_CONC_TAMARIND',
    made_at: '2026-10-10T00:00:00.000Z',
    qty_made: 3000,
    state: 'READY',
    ready_at: '2026-10-10T00:00:00.000Z',
    expires_at: '2026-10-17T00:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
  await db.component_batch.put(batch);
  await db.stock_movement.put(productionMovement(batch, batch.made_at));
  await db.sale_line.put({
    id: 'LINE_TAMARIND',
    sale_id: 'SALE_1',
    variant_id: 'VAR_TAMARIND_ICED',
    qty: 1,
    unit_price: 4000,
    line_discount: 0,
    discount_reason: null,
    unit_cost: 684,
    synced_at: null,
  });

  expect(await ensureSeeded(db)).toBe(true);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

async function bomFor(variantId: string): Promise<Record<string, number>> {
  const rows = await db.bom.where('variant_id').equals(variantId).toArray();
  return Object.fromEntries(rows.map((row) => [row.component_id, row.qty_per_cup]));
}

describe('the recipe update on a phone already trading', () => {
  it('puts all fifteen menus on sale', async () => {
    const active = (await db.product.toArray()).filter((product) => product.is_active);
    expect(active.map((product) => product.id).sort()).toEqual(
      PRODUCTS.map((product) => product.id).sort(),
    );
  });

  it('switches the old menu off without deleting any of it', async () => {
    expect((await db.product.get('DRINK_TAMARIND'))?.is_active).toBe(false);
    expect((await db.product.get('BOTTLE_TAMARIND_1L'))?.is_active).toBe(false);
    expect((await db.variant.get('VAR_PEAR_HOT'))?.is_active).toBe(false);
    for (const id of ['COMP_CONC_TAMARIND', 'COMP_JELLY_WHITE_GOJI', 'COMP_PEACH_GUM']) {
      expect((await db.component.get(id))?.is_active, id).toBe(false);
    }
    for (const id of ['MOD_BASIL_SEED', 'MOD_PEACH_GUM', 'PREP_NO_ICE', 'PREP_TAKEAWAY_BAG']) {
      expect((await db.modifier.get(id))?.applies_to_variant_ids, id).toEqual([]);
    }
  });

  it('leaves every sale, batch and movement exactly where it was', async () => {
    expect(await db.sale_line.get('LINE_TAMARIND')).toMatchObject({
      variant_id: 'VAR_TAMARIND_ICED',
      unit_price: 4000,
      unit_cost: 684,
    });
    expect((await db.component_batch.get('B_TAMARIND'))?.component_id).toBe('COMP_CONC_TAMARIND');
    expect(await db.stock_movement.count()).toBe(1);
  });

  it('replaces the pear recipe in place, keeping the row ids', async () => {
    expect(await bomFor('VAR_PEAR_ICED')).toEqual({
      COMP_SYRUP: 20,
      COMP_JELLY_RED_GOJI: 30,
      COMP_PEAR_FRESH: 21,
      COMP_CONC_PEAR: 50,
      COMP_TEA_RED: 200,
      // "qty not set" in the master file: hers stays.
      COMP_CHRYS_GARNISH: 2,
    });
    expect(await db.bom.get('BOM_VAR_PEAR_ICED_COMP_CONC_PEAR')).toBeDefined();
  });

  it('rewrites a matched component to the master file, keeping what it says to keep', async () => {
    expect(await db.component.get('COMP_TEA_RED')).toMatchObject({
      name_th: 'ชาแดงสกัดเย็น',
      default_batch_qty: 9000,
      shelf_life_hours: 72,
      is_active: true,
      prep_start_by: '20:15',
    });
    expect((await db.component.get('COMP_PEAR_FRESH'))?.cost_per_unit).toBe(0.08);
    expect(await db.component.get('COMP_CONC_PEAR')).toMatchObject({
      name_th: 'หัวเชื้อสาลี่',
      default_batch_qty: 4000,
      shelf_life_hours: 120,
      cost_per_unit: null,
    });
  });

  it('matches a component she made herself by its Thai name, and uses her id', async () => {
    expect(await db.component.get('COMP_TEA_JASMINE')).toBeUndefined();
    expect(await db.component.get(OWNER_JASMINE)).toMatchObject({
      default_batch_qty: 8000,
      shelf_life_hours: 48,
      lead_time_hours: 8,
    });
    expect(await bomFor('VAR_LYCHEE_ICED')).toHaveProperty(OWNER_JASMINE, 245);
    expect(await bomFor('VAR_PLAIN_JASMINE')).toHaveProperty(OWNER_JASMINE, 290);
  });

  it('keeps packaging prices and reorder points, but takes the new ice price', async () => {
    expect(await db.packaging_item.get('PKGI_CUP_PLASTIC_16OZ')).toMatchObject({
      unit_cost: 125,
      reorder_at: 50,
    });
    expect((await db.packaging_item.get('PKGI_ICE'))?.unit_cost).toBe(54);
    const set = await db.packaging_set.get('PKG_ICED_STRAW');
    expect(set?.items.map((line) => line.packaging_item_id)).not.toContain('PKGI_LOGO_STICKER');
  });

  it('matches a purchase item by name and gives it the master file’s price', async () => {
    expect(await db.purchase_item.get('PI_TEA_BLACK')).toBeUndefined();
    expect(await db.purchase_item.get('owner-black-tea')).toMatchObject({
      unit: 'กก.',
      last_unit_cost: 40_000,
    });
  });

  it('marks what it changed for the next cloud send', async () => {
    expect((await db.component.get('COMP_TEA_RED'))?.sync_dirty).toBe(1);
    expect((await db.product.get('DRINK_TAMARIND'))?.sync_dirty).toBe(1);
  });

  it('runs once', async () => {
    const counts = await Promise.all([db.bom.count(), db.component.count(), db.modifier.count()]);
    expect(await ensureSeeded(db)).toBe(false);
    expect(await Promise.all([db.bom.count(), db.component.count(), db.modifier.count()])).toEqual(
      counts,
    );
  });
});
