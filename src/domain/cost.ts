/**
 * The cost engine.
 *
 * Pure functions: data in, satang out. No React, no Dexie, no recipe knowledge
 * — every quantity, cost and price arrives from the database, because none of
 * the recipes have been taste-tested and all of them will change (CLAUDE.md
 * §2.1.7).
 *
 * Rounding follows CLAUDE.md §3: each line is rounded to the nearest satang
 * as `round(qty × cost_per_unit × 100)`, and the rounded lines are summed.
 * Rounding the sum instead drifts by a satang or two against the margin table.
 */
import type { Satang } from '../lib/money.ts';
import type {
  Bom,
  Component,
  Modifier,
  PackagingItem,
  PackagingSet,
  Product,
  Variant,
} from '../db/types.ts';
import { recipeFor, resolveModifiers } from './recipe.ts';

/** The catalog rows the engine needs, exactly as they come out of the tables. */
export interface CatalogRows {
  products: readonly Product[];
  variants: readonly Variant[];
  components: readonly Component[];
  bom: readonly Bom[];
  packagingSets: readonly PackagingSet[];
  packagingItems: readonly PackagingItem[];
  modifiers: readonly Modifier[];
}

/** The same rows, indexed for lookup. Build it once per screen, not per tap. */
export interface CostCatalog {
  products: ReadonlyMap<string, Product>;
  variants: ReadonlyMap<string, Variant>;
  components: ReadonlyMap<string, Component>;
  bomByVariant: ReadonlyMap<string, readonly Bom[]>;
  packagingSets: ReadonlyMap<string, PackagingSet>;
  packagingItems: ReadonlyMap<string, PackagingItem>;
  modifiers: ReadonlyMap<string, Modifier>;
}

export function buildCostCatalog(rows: CatalogRows): CostCatalog {
  const bomByVariant = new Map<string, Bom[]>();
  for (const row of rows.bom) {
    const list = bomByVariant.get(row.variant_id);
    if (list) list.push(row);
    else bomByVariant.set(row.variant_id, [row]);
  }

  return {
    products: byId(rows.products),
    variants: byId(rows.variants),
    components: byId(rows.components),
    bomByVariant,
    packagingSets: byId(rows.packagingSets),
    packagingItems: byId(rows.packagingItems),
    modifiers: byId(rows.modifiers),
  };
}

/**
 * Material cost of one cup: the variant's bill of materials, plus any modifier
 * that brings a component of its own, plus any modifier that is a flat cost.
 *
 * `modifierIds` carries both paid modifiers and preparation instructions — the
 * operator makes one selection and the kind is a property of the row, not of
 * the call.
 */
export function materialCost(
  catalog: CostCatalog,
  variantId: string,
  modifierIds: readonly string[] = [],
): Satang {
  let total = 0;

  // Everything the cup physically contains, including modifier components and
  // any role override such as "less sweet". The stock engine deducts from this
  // same list, so cost and stock cannot drift apart.
  for (const line of recipeFor(catalog, variantId, modifierIds)) {
    total += costOf(line.qty, line.component.cost_per_unit);
  }

  // A modifier with no component of its own is a flat cost: salted plum is
  // counted, not weighed. Modifiers that do bring a component are already
  // priced through that component above, and must not be charged twice.
  for (const mod of resolveModifiers(catalog, modifierIds)) {
    if (mod.component_id === null) total += mod.cost_delta;
  }

  return total;
}

/**
 * Packaging cost of one cup, from the variant's packaging set.
 *
 * `PREP_NO_ICE` drops the ice item. `PREP_TAKEAWAY_BAG` changes nothing: the
 * carry bag is already inside every set, and charging for it again would count
 * it twice (docs/seed-data.md §6.2).
 */
export function packagingCost(
  catalog: CostCatalog,
  variantId: string,
  modifierIds: readonly string[] = [],
): Satang {
  const variant = requireVariant(catalog, variantId);
  const set = catalog.packagingSets.get(variant.packaging_set_id);
  if (!set) {
    throw new Error(`packaging set ${variant.packaging_set_id} missing for variant ${variantId}`);
  }

  const removed = new Set(
    resolveModifiers(catalog, modifierIds)
      .map((mod) => mod.removes_packaging_item_id)
      .filter((id): id is string => id !== null),
  );

  let total = 0;
  for (const line of set.items) {
    if (removed.has(line.packaging_item_id)) continue;
    const item = catalog.packagingItems.get(line.packaging_item_id);
    if (!item)
      throw new Error(`packaging item ${line.packaging_item_id} missing from set ${set.id}`);
    total += item.unit_cost * line.qty;
  }

  return total;
}

/** What one cup costs to put in the customer's hand: material plus packaging. */
export function lineCost(
  catalog: CostCatalog,
  variantId: string,
  modifierIds: readonly string[] = [],
): Satang {
  return (
    materialCost(catalog, variantId, modifierIds) + packagingCost(catalog, variantId, modifierIds)
  );
}

/**
 * What one cup sells for, before any promotion: the variant's price override
 * or its product's base price, plus every paid modifier.
 */
export function unitPrice(
  catalog: CostCatalog,
  variantId: string,
  modifierIds: readonly string[] = [],
): Satang {
  const variant = requireVariant(catalog, variantId);
  const product = catalog.products.get(variant.product_id);
  if (!product) throw new Error(`product ${variant.product_id} missing for variant ${variantId}`);

  const base = variant.price_override ?? product.base_price;
  return resolveModifiers(catalog, modifierIds).reduce(
    (total, mod) => total + mod.price_delta,
    base,
  );
}

/** Gross profit on one cup, in satang. */
export function grossProfit(price: Satang, cost: Satang): Satang {
  return price - cost;
}

/** Gross margin as a percentage. Returns 0 for a free cup rather than NaN. */
export function grossMarginPct(price: Satang, cost: Satang): number {
  if (price === 0) return 0;
  return (grossProfit(price, cost) / price) * 100;
}

// ------------------------------------------------------------------ private

/** CLAUDE.md §3: round every line to the nearest satang, then sum. */
function costOf(qty: number, costPerUnit: number): Satang {
  return Math.round(qty * costPerUnit * 100);
}

function byId<T extends { id: string }>(rows: readonly T[]): ReadonlyMap<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

function requireVariant(catalog: CostCatalog, variantId: string): Variant {
  const variant = catalog.variants.get(variantId);
  if (!variant) throw new Error(`variant ${variantId} not in the catalog`);
  return variant;
}
