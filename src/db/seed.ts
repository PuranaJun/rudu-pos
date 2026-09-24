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
 * Wipe the catalog and the trading history and start over. Development only —
 * it is wired to a long press in a DEV build and has no production path.
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
      await markSeeded(db);
    },
  );
}

/**
 * Bring a database seeded by an older build up to the current shape. Each
 * migration touches only the columns that step changed, so prices, costs and
 * BOM quantities the owner has edited are left alone.
 */
async function upgradeCatalog(db: RuduPosDB, from: number): Promise<void> {
  await db.transaction('rw', [db.product, db.component, db.modifier, db.setting], async () => {
    if (from < 2) {
      // v2 gave components a role, so PREP_LESS_SWEET can find the concentrate
      // of a variant, and gave modifiers a packaging item to remove.
      for (const seeded of COMPONENTS) {
        await db.component.update(seeded.id, { role: seeded.role });
      }
      for (const seeded of MODIFIERS) {
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
      for (const seeded of MODIFIERS) {
        await db.modifier.update(seeded.id, {
          overrides_component_role: seeded.overrides_component_role,
        });
      }
    }

    if (from < 4) {
      // v4 told drinks from bottles, which PROMO_TWO_CUP needs in order to
      // exclude the bottle.
      for (const seeded of PRODUCTS) {
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
      for (const seeded of COMPONENTS) {
        await db.component.update(seeded.id, {
          source_component_id: seeded.source_component_id,
          source_qty_per_unit: seeded.source_qty_per_unit,
          prep_start_by: seeded.prep_start_by,
        });
      }
      await moveLegacyPrepTimes(db);
    }

    await markSeeded(db);
  });
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
