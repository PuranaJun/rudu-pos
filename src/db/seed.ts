import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { Bom } from './types.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  PURCHASE_ITEMS,
  SEED_VERSION,
  SEED_VERSION_KEY,
  SETTINGS,
  VARIANTS,
} from '../data/seed.ts';
// The catalog the steps before version 10 were written against. Those steps
// backfill columns of rows that were seeded from it, so they read it, never
// the current menu.
import * as V9 from '../data/legacy-seed-v9.ts';
import { applyRecipeUpdate, recipeUpdateTables } from './recipe-update.ts';

/**
 * Load the catalog into an empty database, or bring an older one up to the
 * current shape.
 *
 * Guarded by the `seed_version` setting: after the first run the database owns
 * the catalog and src/data/seed.ts is never read again as data, so a price the
 * owner edits in settings is not silently reverted by the next launch. An
 * upgrade only backfills columns that did not exist before — it never restores
 * a value the owner has changed.
 *
 * Returns true when it wrote anything.
 */
export async function ensureSeeded(db: RuduPosDB = defaultDb): Promise<boolean> {
  const stored = await storedSeedVersion(db);

  if (stored >= SEED_VERSION) return false;

  if (stored === 0) {
    await writeSeed(db);
  } else {
    await upgradeCatalog(db, stored);
  }
  return true;
}

/**
 * Wipe the catalog and the trading history and start over. A long press in a
 * DEV build — and, in production, a view-only device that stops viewing: its
 * data was only ever a copy of the cloud's.
 */
export async function resetAndReseed(db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
  await writeSeed(db);
}

async function storedSeedVersion(db: RuduPosDB): Promise<number> {
  const marker = await db.setting.get(SEED_VERSION_KEY);
  return typeof marker?.value === 'number' ? marker.value : 0;
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
      db.purchase_item,
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
      await db.purchase_item.bulkPut(PURCHASE_ITEMS);
      await db.setting.bulkPut(SETTINGS);

      // Written last: if anything above throws, the transaction rolls back and
      // the next launch sees an unseeded database rather than a half-seeded one.
      await markSeeded(db);
    },
  );
}

/**
 * Bring a database seeded by an older build up to the current shape. Each
 * migration up to version 9 touches only the columns that step changed, so
 * prices, costs and BOM quantities the owner has edited are left alone.
 * Version 10 is the exception, and says why (src/db/recipe-update.ts).
 */
async function upgradeCatalog(db: RuduPosDB, from: number): Promise<void> {
  await db.transaction('rw', [...recipeUpdateTables(db), db.setting], async () => {
    if (from < 2) {
      // v2 gave components a role, so PREP_LESS_SWEET can find the concentrate
      // of a variant, and gave modifiers a packaging item to remove.
      for (const seeded of V9.COMPONENTS) {
        await db.component.update(seeded.id, { role: seeded.role });
      }
      for (const seeded of V9.MODIFIERS) {
        // cost_delta moves with it: PREP_NO_ICE carried a hardcoded -1.00
        // before, which would double count now that it removes the ice item.
        await db.modifier.update(seeded.id, {
          removes_packaging_item_id: seeded.removes_packaging_item_id,
          cost_delta: seeded.cost_delta,
        });
      }
    }

    if (from < 3) {
      // v3 let a modifier replace a component by role, so PREP_LESS_SWEET no
      // longer has to be recognised by its id in the engine.
      for (const seeded of V9.MODIFIERS) {
        await db.modifier.update(seeded.id, {
          overrides_component_role: seeded.overrides_component_role,
        });
      }
    }

    if (from < 4) {
      // v4 told drinks from bottles, which PROMO_TWO_CUP needs in order to
      // exclude the bottle.
      for (const seeded of V9.PRODUCTS) {
        await db.product.update(seeded.id, { kind: seeded.kind });
      }
    }

    if (from < 6) {
      // v5 moved the rainy-day drink into a setting; v6 added the void
      // reasons. Both are new rows, and this inserts whatever is missing.
      await addMissingSettings(db);
    }

    if (from < 7) {
      // v7 gave white-tea jelly its source, and moved the prep-reminder times
      // from two named settings onto the components they belong to.
      for (const seeded of V9.COMPONENTS) {
        await db.component.update(seeded.id, {
          source_component_id: seeded.source_component_id,
          source_qty_per_unit: seeded.source_qty_per_unit,
          prep_start_by: seeded.prep_start_by,
        });
      }
      await moveLegacyPrepTimes(db);
    }

    if (from < 8) {
      // v8 added the annual revenue warning band.
      await addMissingSettings(db);
    }

    if (from < 9) {
      // v9 counts packaging as stock. Seeded items take the seed's choice (ice
      // is not counted); items the owner added are counted.
      const seeded = new Map(V9.PACKAGING_ITEMS.map((item) => [item.id, item]));
      for (const item of await db.packaging_item.toArray()) {
        await db.packaging_item.update(item.id, {
          is_stock_tracked: seeded.get(item.id)?.is_stock_tracked ?? true,
          reorder_at: null,
        });
      }
    }

    if (from < 10) {
      // v10 is the shop's recipe update of 12 Oct 2026: fifteen menus,
      // sweetness levels, Yakult, and the raw ingredients to buy.
      await applyRecipeUpdate(db);
    }

    if (from < 11) {
      // v11 marks removed rows instead of deleting them. Recipe lines deleted
      // before that never reached the cloud as gone, so view-only phones may
      // still count them; mark the ones whose ids are known as removed now.
      await markDeletedRecipeLines(db);
    }

    await markSeeded(db);
  });
}

/**
 * Recipe lines from the seeds that are no longer on this phone were deleted —
 * by the v10 recipe update, or from settings — before deleting became marking
 * (see Removable in types.ts). Seeded lines have ids made from their variant
 * and component, so each one can be written back as removed: sync then tells
 * the cloud and every view-only phone, which may still be counting it.
 *
 * A line the owner added by hand and then deleted had a random id and cannot
 * be named here; a view-only phone paired again from scratch drops it.
 */
export async function markDeletedRecipeLines(
  db: RuduPosDB,
  at: string = new Date().toISOString(),
): Promise<number> {
  const present = new Set(await db.bom.toCollection().primaryKeys());
  const gone = new Map<string, Bom>();
  for (const row of [...V9.BOM_ROWS, ...BOM_ROWS]) {
    if (!present.has(row.id)) gone.set(row.id, { ...row, removed_at: at, synced_at: null });
  }
  if (gone.size > 0) await db.bom.bulkAdd([...gone.values()]);
  return gone.size;
}

/** The v6 setting keys, and the component each one was about. */
const LEGACY_PREP_SETTINGS: Record<string, string> = {
  prep_reminder_red_tea: 'COMP_TEA_RED',
  prep_reminder_white_tea: 'COMP_TEA_WHITE',
};

/** Carry a time the owner may have edited over to its component, then drop the old row. */
async function moveLegacyPrepTimes(db: RuduPosDB): Promise<void> {
  for (const [key, componentId] of Object.entries(LEGACY_PREP_SETTINGS)) {
    const row = await db.setting.get(key);
    if (typeof row?.value === 'string') {
      await db.component.update(componentId, { prep_start_by: row.value });
    }
    await db.setting.delete(key);
  }
}

/**
 * Insert settings rows this build expects and an older one never wrote.
 * Existing rows are left exactly as they are — the owner may have edited them.
 */
async function addMissingSettings(db: RuduPosDB): Promise<void> {
  for (const seeded of SETTINGS) {
    const existing = await db.setting.get(seeded.key);
    if (!existing) await db.setting.put(seeded);
  }
}

async function markSeeded(db: RuduPosDB): Promise<void> {
  await db.setting.put({ key: SEED_VERSION_KEY, value: SEED_VERSION, synced_at: null });
}
