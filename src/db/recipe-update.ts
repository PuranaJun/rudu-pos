/**
 * The recipe update of 12 Oct 2026 (docs/recipes-2026-10.md): seed version 10.
 *
 * Unlike every earlier upgrade step, this one is asked to replace the owner's
 * recipes — the master file is the new source of truth. It still keeps what
 * the master file says to keep, and it never deletes a record that history
 * can point at:
 *
 * - a row is matched by its stable id, or else by its Thai name, and updated
 *   in place, so its id — and every sale, batch and waste row that names it —
 *   stays linked;
 * - anything missing is created;
 * - a product, variant or component that is no longer on the menu is
 *   switched off, a modifier is taken off every drink; none is removed;
 * - a recipe line that is no longer in a recipe is removed. Nothing points at
 *   a BOM row: each sale line carries its own cost snapshot (CLAUDE.md §2.1.8).
 *
 * Runs inside the caller's transaction, over the tables in RECIPE_UPDATE_TABLES.
 */
import type { RuduPosDB } from './database.ts';
import type {
  Bom,
  Component,
  Modifier,
  PackagingItem,
  PackagingSet,
  Product,
  PurchaseItem,
  Variant,
} from './types.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  PURCHASE_ITEMS,
  VARIANTS,
} from '../data/seed.ts';

export function recipeUpdateTables(db: RuduPosDB) {
  return [
    db.product,
    db.variant,
    db.component,
    db.bom,
    db.packaging_item,
    db.packaging_set,
    db.modifier,
    db.purchase_item,
  ];
}

/**
 * Values the master file says to keep as the phone has them ("keep existing"),
 * or that are the owner's own choices about this phone rather than recipe:
 * prep reminder times, what is counted, reorder points.
 */
const KEEP_COMPONENT: Record<string, readonly (keyof Component)[]> = {
  COMP_TEA_RED: ['prep_start_by'],
  COMP_TEA_WHITE: ['prep_start_by'],
  COMP_PEAR_FRESH: ['cost_per_unit'],
  COMP_CHRYS_GARNISH: ['name_th', 'cost_per_unit'],
};
const KEEP_PRODUCT: Record<string, readonly (keyof Product)[]> = {
  DRINK_PEAR: ['advisory_th'],
};
/** Large straw, spoon and the rest keep their prices; ice takes the new one. */
const KEEP_PACKAGING_ITEM: readonly (keyof PackagingItem)[] = [
  'name_th',
  'unit_cost',
  'is_stock_tracked',
  'reorder_at',
];
const KEEP_ICE: readonly (keyof PackagingItem)[] = ['name_th', 'is_stock_tracked', 'reorder_at'];
/** The chrysanthemum garnish on pear: "qty not set", so the phone's stays. */
const KEEP_BOM_QTY = new Set(['VAR_PEAR_ICED:COMP_CHRYS_GARNISH']);

interface Row {
  id: string;
  synced_at?: string | null;
  sync_dirty?: 1;
  sync_rev?: number;
}

/** What to write over an existing row: everything but its identity and sync state. */
function changesFrom<T extends Row>(target: T, existing: T, keep: readonly (keyof T)[] = []) {
  const changes: Partial<T> = { ...target };
  delete changes.id;
  delete changes.synced_at;
  delete changes.sync_dirty;
  delete changes.sync_rev;
  for (const key of keep) changes[key] = existing[key];
  return changes;
}

/**
 * Pair each target row with the existing row it replaces: by id first, then
 * by name among the rows not yet taken — so two targets with the same name
 * (three kinds of หวานน้อย) never both claim the same row.
 */
function matchRows<T extends Row>(
  targets: readonly T[],
  existing: readonly T[],
  sameName: (target: T, row: T) => boolean,
): Map<string, T> {
  const byId = new Map(existing.map((row) => [row.id, row]));
  const taken = new Set<string>();
  const matched = new Map<string, T>();

  for (const target of targets) {
    const row = byId.get(target.id);
    if (row) {
      matched.set(target.id, row);
      taken.add(row.id);
    }
  }
  for (const target of targets) {
    if (matched.has(target.id)) continue;
    const row = existing.find(
      (candidate) => !taken.has(candidate.id) && sameName(target, candidate),
    );
    if (row) {
      matched.set(target.id, row);
      taken.add(row.id);
    }
  }
  return matched;
}

const trimmed = (text: string) => text.trim();

/** The target's id, or the id of the existing row it was matched to. */
function idMap(matched: ReadonlyMap<string, Row>): (id: string) => string {
  return (id) => matched.get(id)?.id ?? id;
}

export async function applyRecipeUpdate(db: RuduPosDB): Promise<void> {
  const [products, variants, components, bom, items, sets, modifiers, purchaseItems] =
    await Promise.all([
      db.product.toArray(),
      db.variant.toArray(),
      db.component.toArray(),
      db.bom.toArray(),
      db.packaging_item.toArray(),
      db.packaging_set.toArray(),
      db.modifier.toArray(),
      db.purchase_item.toArray(),
    ]);

  // ---- match
  const productMatch = matchRows<Product>(
    PRODUCTS,
    products,
    (target, row) =>
      trimmed(row.name_full_th) === target.name_full_th ||
      trimmed(row.name_short_th) === target.name_short_th,
  );
  const productId = idMap(productMatch);

  const componentMatch = matchRows<Component>(
    COMPONENTS,
    components,
    (target, row) => trimmed(row.name_th) === target.name_th,
  );
  const componentId = idMap(componentMatch);

  const itemMatch = matchRows<PackagingItem>(
    PACKAGING_ITEMS,
    items,
    (target, row) => trimmed(row.name_th) === target.name_th,
  );
  const itemId = idMap(itemMatch);

  const setMatch = matchRows<PackagingSet>(
    PACKAGING_SETS,
    sets,
    (target, row) => trimmed(row.name) === target.name,
  );
  const setId = idMap(setMatch);

  const variantMatch = matchRows<Variant>(
    VARIANTS,
    variants,
    (target, row) =>
      row.product_id === productId(target.product_id) && trimmed(row.name_th) === target.name_th,
  );
  const variantId = idMap(variantMatch);

  const modifierMatch = matchRows<Modifier>(
    MODIFIERS,
    modifiers,
    (target, row) => trimmed(row.name_th) === target.name_th,
  );

  const purchaseMatch = matchRows<PurchaseItem>(
    PURCHASE_ITEMS,
    purchaseItems,
    (target, row) => trimmed(row.name_th) === target.name_th,
  );

  // ---- products and variants
  for (const target of PRODUCTS) {
    const row = productMatch.get(target.id);
    if (row) await db.product.update(row.id, changesFrom(target, row, KEEP_PRODUCT[target.id]));
    else await db.product.add(target);
  }
  const matchedProducts = new Set(productMatch.values());
  for (const row of products) {
    if (!matchedProducts.has(row) && row.is_active) {
      await db.product.update(row.id, { is_active: false });
    }
  }

  const keptVariants = new Set<Variant>();
  for (const target of VARIANTS) {
    const mapped: Variant = {
      ...target,
      product_id: productId(target.product_id),
      packaging_set_id: setId(target.packaging_set_id),
    };
    const row = variantMatch.get(target.id);
    if (row) {
      keptVariants.add(row);
      await db.variant.update(row.id, changesFrom(mapped, row));
    } else {
      await db.variant.add(mapped);
    }
  }
  for (const row of variants) {
    if (!keptVariants.has(row) && row.is_active) {
      await db.variant.update(row.id, { is_active: false });
    }
  }

  // ---- components
  for (const target of COMPONENTS) {
    const mapped: Component = {
      ...target,
      source_component_id:
        target.source_component_id === null ? null : componentId(target.source_component_id),
    };
    const row = componentMatch.get(target.id);
    if (row) {
      await db.component.update(row.id, changesFrom(mapped, row, KEEP_COMPONENT[target.id]));
    } else {
      await db.component.add(mapped);
    }
  }
  const matchedComponents = new Set(componentMatch.values());
  for (const row of components) {
    if (!matchedComponents.has(row) && row.is_active !== false) {
      await db.component.update(row.id, { is_active: false });
    }
  }

  // ---- packaging
  for (const target of PACKAGING_ITEMS) {
    const row = itemMatch.get(target.id);
    if (row) {
      const keep = target.id === 'PKGI_ICE' ? KEEP_ICE : KEEP_PACKAGING_ITEM;
      await db.packaging_item.update(row.id, changesFrom(target, row, keep));
    } else {
      await db.packaging_item.add(target);
    }
  }
  for (const target of PACKAGING_SETS) {
    const mapped: PackagingSet = {
      ...target,
      items: target.items.map((line) => ({
        ...line,
        packaging_item_id: itemId(line.packaging_item_id),
      })),
    };
    const row = setMatch.get(target.id);
    if (row) await db.packaging_set.update(row.id, changesFrom(mapped, row));
    else await db.packaging_set.add(mapped);
  }

  // ---- recipes: every drink on the new menu gets exactly its master-file BOM
  const targetBom = BOM_ROWS.map((row) => ({
    ...row,
    variant_id: variantId(row.variant_id),
    component_id: componentId(row.component_id),
  }));
  const keepQty = new Set(
    [...KEEP_BOM_QTY].map((key) => {
      const [variant, component] = key.split(':') as [string, string];
      return `${variantId(variant)}:${componentId(component)}`;
    }),
  );
  const recipeVariants = new Set(targetBom.map((row) => row.variant_id));
  const existingByKey = new Map<string, Bom>(
    bom.map((row) => [`${row.variant_id}:${row.component_id}`, row]),
  );
  const wanted = new Set(targetBom.map((row) => `${row.variant_id}:${row.component_id}`));

  for (const row of bom) {
    if (
      recipeVariants.has(row.variant_id) &&
      !wanted.has(`${row.variant_id}:${row.component_id}`)
    ) {
      await db.bom.delete(row.id);
    }
  }
  for (const target of targetBom) {
    const key = `${target.variant_id}:${target.component_id}`;
    const row = existingByKey.get(key);
    if (row) {
      if (!keepQty.has(key)) await db.bom.update(row.id, { qty_per_cup: target.qty_per_cup });
    } else {
      await db.bom.add(target);
    }
  }

  // ---- modifiers
  const matchedModifiers = new Set(modifierMatch.values());
  for (const target of MODIFIERS) {
    const mapped: Modifier = {
      ...target,
      applies_to_variant_ids: target.applies_to_variant_ids.map(variantId),
      component_id: target.component_id === null ? null : componentId(target.component_id),
    };
    const row = modifierMatch.get(target.id);
    if (row) await db.modifier.update(row.id, changesFrom(mapped, row));
    else await db.modifier.add(mapped);
  }
  for (const row of modifiers) {
    if (matchedModifiers.has(row)) continue;
    // Not on the new menu: offered on no drink. Kept, because past bills name it.
    await db.modifier.update(row.id, {
      applies_to_variant_ids: [],
      adjusts_component_role: row.adjusts_component_role ?? null,
      adjust_qty_per_cup: row.adjust_qty_per_cup ?? null,
    });
  }

  // ---- raw ingredients, as purchase items. A price the master file does not
  // give leaves the one on the phone alone.
  for (const target of PURCHASE_ITEMS) {
    const row = purchaseMatch.get(target.id);
    if (!row) {
      await db.purchase_item.add(target);
    } else if (target.last_unit_cost !== null) {
      await db.purchase_item.update(row.id, {
        unit: target.unit,
        last_unit_cost: target.last_unit_cost,
      });
    }
  }
}
