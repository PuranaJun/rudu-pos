import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  SEED_VERSION,
  SEED_VERSION_KEY,
  SETTINGS,
  VARIANTS,
} from '../data/seed.ts';

/**
 * Load the catalog into an empty database, once.
 *
 * Guarded by the `seed_version` setting: after the first run the database owns
 * the catalog and src/data/seed.ts is never read again, so an edit the owner
 * makes in settings is not silently reverted by the next launch.
 */
export async function ensureSeeded(db: RuduPosDB = defaultDb): Promise<boolean> {
  const marker = await db.setting.get(SEED_VERSION_KEY);
  if (marker) return false;

  await writeSeed(db);
  return true;
}

/**
 * Wipe the catalog and the trading history and start over. Development only —
 * it is wired to a long-press in a DEV build and has no production path.
 */
export async function resetAndReseed(db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
  await writeSeed(db);
}

async function writeSeed(db: RuduPosDB): Promise<void> {
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
      await db.product.bulkPut(PRODUCTS);
      await db.variant.bulkPut(VARIANTS);
      await db.component.bulkPut(COMPONENTS);
      await db.bom.bulkPut(BOM_ROWS);
      await db.packaging_item.bulkPut(PACKAGING_ITEMS);
      await db.packaging_set.bulkPut(PACKAGING_SETS);
      await db.modifier.bulkPut(MODIFIERS);
      await db.setting.bulkPut(SETTINGS);

      // Written last: if anything above throws, the transaction rolls back and
      // the next launch sees an unseeded database rather than a half-seeded one.
      await db.setting.put({ key: SEED_VERSION_KEY, value: SEED_VERSION, synced_at: null });
    },
  );
}
