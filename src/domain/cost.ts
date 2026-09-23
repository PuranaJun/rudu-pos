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
  const bom = catalog.bomByVariant.get(variantId) ?? [];
  const modifiers = resolveModifiers(catalog, modifierIds);

  // "Less sweet" is 35 ml of concentrate instead of 50, made up with dilution
  // water. The concentrate is whichever BOM component carries that role, so a
  // third drink with a different concentrate works without a code change.
  const lessSweet = modifiers.find(
    (mod) => mod.id === 'PREP_LESS_SWEET' && mod.qty_per_cup !== null,
  );

  let total = 0;

  for (const row of bom) {
    const component = requireComponent(catalog, row.component_id);
    const qty =
      lessSweet && component.role === 'CONCENTRATE'
        ? (lessSweet.qty_per_cup ?? row.qty_per_cup)
        : row.qty_per_cup;
    total += costOf(qty, component.cost_per_unit);
  }

  for (const mod of modifiers) {
    if (mod.component_id !== null) {
      // The cost comes from the component, never from cost_delta as well, or
      // the basil seed is paid for twice.
      const component = requireComponent(catalog, mod.component_id);
      total += costOf(mod.qty_per_cup ?? 0, component.cost_per_unit);
    } else {
      // Salted plum has no component of its own — it is counted, not weighed.
      total += mod.cost_delta;
    }
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

function resolveModifiers(catalog: CostCatalog, modifierIds: readonly string[]): Modifier[] {
  return modifierIds.map((id) => {
    const mod = catalog.modifiers.get(id);
    if (!mod) throw new Error(`modifier ${id} not in the catalog`);
    return mod;
  });
}

function requireVariant(catalog: CostCatalog, variantId: string): Variant {
  const variant = catalog.variants.get(variantId);
  if (!variant) throw new Error(`variant ${variantId} not in the catalog`);
  return variant;
}

/**
 * A BOM row pointing at a component that no longer exists is a data fault that
 * would quietly understate cost. Fail loudly instead.
 */
function requireComponent(catalog: CostCatalog, componentId: string): Component {
  const component = catalog.components.get(componentId);
  if (!component) throw new Error(`component ${componentId} not in the catalog`);
  return component;
}
