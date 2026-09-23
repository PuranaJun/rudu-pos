import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import { buildCostCatalog, type CostCatalog } from '../domain/cost.ts';

/**
 * Read the catalog out of IndexedDB and index it for the cost engine.
 *
 * This is the only place the two meet: src/domain stays free of Dexie, and
 * costs are never constants in the cost module — they are rows the owner can
 * edit in settings.
 */
export async function loadCostCatalog(db: RuduPosDB = defaultDb): Promise<CostCatalog> {
  const [products, variants, components, bom, packagingSets, packagingItems, modifiers] =
    await Promise.all([
      db.product.toArray(),
      db.variant.toArray(),
      db.component.toArray(),
      db.bom.toArray(),
      db.packaging_set.toArray(),
      db.packaging_item.toArray(),
      db.modifier.toArray(),
    ]);

  return buildCostCatalog({
    products,
    variants,
    components,
    bom,
    packagingSets,
    packagingItems,
    modifiers,
  });
}
