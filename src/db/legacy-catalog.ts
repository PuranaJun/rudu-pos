/**
 * The version-9 catalog (src/data/legacy-seed-v9.ts) loaded as if it were
 * current: for the tests, which use its three small drinks as a known
 * fixture, and for the dev menu's generated week, which is written against
 * it. Never the shop's data, and no production path reaches it.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import * as V9 from '../data/legacy-seed-v9.ts';
import { SEED_VERSION, SEED_VERSION_KEY, SETTINGS } from '../data/seed.ts';

/** Write the v9 catalog and the settings, marked as fully seeded. */
export async function seedLegacyCatalog(db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.product,
      db.variant,
      db.component,
      db.bom,
      db.packaging_item,
      db.packaging_set,
      db.modifier,
      db.setting,
    ],
    async () => {
      await db.product.bulkPut(V9.PRODUCTS);
      await db.variant.bulkPut(V9.VARIANTS);
      await db.component.bulkPut(V9.COMPONENTS);
      await db.bom.bulkPut(V9.BOM_ROWS);
      await db.packaging_item.bulkPut(V9.PACKAGING_ITEMS);
      await db.packaging_set.bulkPut(V9.PACKAGING_SETS);
      await db.modifier.bulkPut(V9.MODIFIERS);
      await db.setting.bulkPut(SETTINGS);
      // The v9 menu had a hot pear for the rainy-day price.
      await db.setting.put({
        key: 'promo_rainy_day_variant_id',
        value: 'VAR_PEAR_HOT',
        synced_at: null,
      });
      await db.setting.put({ key: SEED_VERSION_KEY, value: SEED_VERSION, synced_at: null });
    },
  );
}

/** Wipe everything and load the v9 catalog. */
export async function resetToLegacyCatalog(db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
  await seedLegacyCatalog(db);
}
