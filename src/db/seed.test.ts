import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { ensureSeeded, resetAndReseed } from './seed.ts';
import { SEED_VERSION, SEED_VERSION_KEY } from '../data/seed.ts';

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

/** The bill of materials exactly as docs/seed-data.md §4 states it. */
const EXPECTED_BOM: Record<string, Record<string, number>> = {
  VAR_TAMARIND_ICED: {
    COMP_TEA_RED: 125,
    COMP_CONC_TAMARIND: 50,
    COMP_JELLY_CHRYS: 30,
  },
  VAR_PEAR_ICED: {
    COMP_TEA_WHITE: 100,
    COMP_CONC_PEAR: 50,
    COMP_JELLY_WHITE_GOJI: 30,
    COMP_PEAR_FRESH: 21,
  },
  VAR_PEAR_HOT: {
    COMP_TEA_WHITE: 100,
    COMP_CONC_PEAR: 50,
    COMP_PEAR_FRESH: 21,
    COMP_PEACH_GUM: 20,
  },
  VAR_BOTTLE_TAMARIND: {
    COMP_TEA_RED: 417,
    COMP_CONC_TAMARIND: 167,
  },
};

async function bomFor(variantId: string): Promise<Record<string, number>> {
  const rows = await db.bom.where('variant_id').equals(variantId).toArray();
  return Object.fromEntries(rows.map((row) => [row.component_id, row.qty_per_cup]));
}

describe('ensureSeeded', () => {
  it('loads the catalog on first run and reports that it did', async () => {
    expect(await ensureSeeded(db)).toBe(true);

    expect(await db.product.count()).toBe(3);
    expect(await db.variant.count()).toBe(4);
    expect(await db.component.count()).toBe(10);
    expect(await db.packaging_item.count()).toBe(10);
    expect(await db.packaging_set.count()).toBe(4);
    expect(await db.modifier.count()).toBe(7);
    expect(await db.bom.count()).toBe(15);
  });

  it('records the seed version as the guard flag', async () => {
    await ensureSeeded(db);
    expect(await db.setting.get(SEED_VERSION_KEY)).toMatchObject({ value: SEED_VERSION });
  });

  it('does not run twice, and does not duplicate rows', async () => {
    await ensureSeeded(db);
    expect(await ensureSeeded(db)).toBe(false);
    expect(await db.bom.count()).toBe(15);
    expect(await db.product.count()).toBe(3);
  });

  it('leaves owner edits alone on the next launch', async () => {
    await ensureSeeded(db);
    // The shop raises the pear to 65 in settings.
    await db.product.update('DRINK_PEAR', { base_price: 6500 });

    await ensureSeeded(db);

    expect((await db.product.get('DRINK_PEAR'))?.base_price).toBe(6500);
  });
});

describe('bill of materials', () => {
  beforeEach(async () => {
    await ensureSeeded(db);
  });

  it.each(Object.keys(EXPECTED_BOM))('has the §4 quantities for %s', async (variantId) => {
    const actual = await bomFor(variantId);
    expect(actual).toMatchObject(EXPECTED_BOM[variantId] as Record<string, number>);
  });

  it('gives VAR_PEAR_HOT no jelly — agar melts at ~85 °C', async () => {
    const hot = await bomFor('VAR_PEAR_HOT');
    expect(hot).not.toHaveProperty('COMP_JELLY_WHITE_GOJI');
    expect(hot).not.toHaveProperty('COMP_JELLY_CHRYS');
  });

  it('gives VAR_PEAR_HOT 20 g of peach gum, always', async () => {
    expect(await bomFor('VAR_PEAR_HOT')).toHaveProperty('COMP_PEACH_GUM', 20);
  });

  it('keeps peach gum off iced pear, where it is a paid modifier instead', async () => {
    expect(await bomFor('VAR_PEAR_ICED')).not.toHaveProperty('COMP_PEACH_GUM');
    const mod = await db.modifier.get('MOD_PEACH_GUM');
    expect(mod?.applies_to_variant_ids).toEqual(['VAR_PEAR_ICED']);
  });

  it('is variant level — hot and iced pear differ', async () => {
    expect(await bomFor('VAR_PEAR_HOT')).not.toEqual(await bomFor('VAR_PEAR_ICED'));
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

  // docs/seed-data.md §6.2, in satang.
  it.each([
    ['PKG_ICED_STRAW', 352],
    ['PKG_ICED_STRAW_SPOON', 387],
    ['PKG_HOT', 294],
    ['PKG_BOTTLE', 700],
  ])('%s costs %i satang', async (setId, expected) => {
    const set = await db.packaging_set.get(setId as string);
    const items = await db.packaging_item.toArray();
    const cost = (set?.items ?? []).reduce((total, line) => {
      const item = items.find((candidate) => candidate.id === line.packaging_item_id);
      return total + (item?.unit_cost ?? 0) * line.qty;
    }, 0);
    expect(cost).toBe(expected);
  });

  it('includes the carry bag in every cup set, so PREP_TAKEAWAY_BAG is free', async () => {
    const cupSets = ['PKG_ICED_STRAW', 'PKG_ICED_STRAW_SPOON', 'PKG_HOT'];
    for (const setId of cupSets) {
      const set = await db.packaging_set.get(setId);
      expect(set?.items.map((line) => line.packaging_item_id)).toContain('PKGI_CARRY_BAG');
    }
    expect((await db.modifier.get('PREP_TAKEAWAY_BAG'))?.cost_delta).toBe(0);
  });
});

describe('resetAndReseed', () => {
  it('clears trading history and reloads the catalog', async () => {
    await ensureSeeded(db);
    await db.sale_line.put({
      id: crypto.randomUUID(),
      sale_id: crypto.randomUUID(),
      variant_id: 'VAR_TAMARIND_ICED',
      qty: 1,
      unit_price: 4000,
      line_discount: 0,
      discount_reason: null,
      unit_cost: 684,
      synced_at: null,
    });
    await db.product.update('DRINK_PEAR', { base_price: 6500 });

    await resetAndReseed(db);

    expect(await db.sale_line.count()).toBe(0);
    expect(await db.product.count()).toBe(3);
    expect((await db.product.get('DRINK_PEAR'))?.base_price).toBe(5900);
  });
});

describe('upgrading a database seeded by an older build', () => {
  /** Roll the seeded catalog back to how v1 stored it. */
  async function rollBackToV1(): Promise<void> {
    await ensureSeeded(db);
    for (const component of await db.component.toArray()) {
      delete (component as Partial<typeof component>).role;
      await db.component.put(component);
    }
    for (const modifier of await db.modifier.toArray()) {
      delete (modifier as Partial<typeof modifier>).removes_packaging_item_id;
      // v1 priced "no ice" as a hardcoded -1.00 instead of removing the item.
      await db.modifier.put({
        ...modifier,
        cost_delta: modifier.id === 'PREP_NO_ICE' ? -100 : modifier.cost_delta,
      });
    }
    await db.setting.put({ key: SEED_VERSION_KEY, value: 1, synced_at: null });
  }

  it('backfills the columns v2 added', async () => {
    await rollBackToV1();
    expect((await db.component.get('COMP_CONC_PEAR'))?.role).toBeUndefined();

    expect(await ensureSeeded(db)).toBe(true);

    expect((await db.component.get('COMP_CONC_PEAR'))?.role).toBe('CONCENTRATE');
    expect((await db.component.get('COMP_TEA_RED'))?.role).toBe('TEA_BASE');
    expect((await db.component.get('COMP_JELLY_CHRYS'))?.role).toBe('SOLID');
    expect((await db.modifier.get('PREP_NO_ICE'))?.removes_packaging_item_id).toBe('PKGI_ICE');
    expect((await db.modifier.get('MOD_BASIL_SEED'))?.removes_packaging_item_id).toBeNull();
  });

  it('drops the hardcoded no-ice discount now that the item is removed instead', async () => {
    await rollBackToV1();
    await ensureSeeded(db);

    expect((await db.modifier.get('PREP_NO_ICE'))?.cost_delta).toBe(0);
  });

  it('leaves owner edits alone while upgrading', async () => {
    await rollBackToV1();
    await db.component.update('COMP_CONC_PEAR', { cost_per_unit: 0.12 });
    await db.product.update('DRINK_PEAR', { base_price: 6500 });

    await ensureSeeded(db);

    expect((await db.component.get('COMP_CONC_PEAR'))?.cost_per_unit).toBe(0.12);
    expect((await db.product.get('DRINK_PEAR'))?.base_price).toBe(6500);
  });

  it('does not run again once it has upgraded', async () => {
    await rollBackToV1();
    expect(await ensureSeeded(db)).toBe(true);
    expect(await ensureSeeded(db)).toBe(false);
  });
});
