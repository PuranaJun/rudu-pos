/**
 * What the cart adds up to.
 *
 * Pure. Promotions are not applied here — they arrive in step 5 and belong in
 * their own module; this is the undiscounted arithmetic the sell screen shows
 * while the operator is still building the order.
 */
import type { Satang } from '../lib/money.ts';
import type { Variant } from '../db/types.ts';
import { lineCost, unitPrice, type CostCatalog } from './cost.ts';

export interface CartEntry {
  variantId: string;
  qty: number;
  modifierIds: readonly string[];
}

export interface CartTotals {
  /** Cups and bottles both count as units sold. */
  units: number;
  gross: Satang;
  cost: Satang;
}

export function cartTotals(catalog: CostCatalog, entries: readonly CartEntry[]): CartTotals {
  let units = 0;
  let gross = 0;
  let cost = 0;

  for (const entry of entries) {
    units += entry.qty;
    gross += unitPrice(catalog, entry.variantId, entry.modifierIds) * entry.qty;
    cost += lineCost(catalog, entry.variantId, entry.modifierIds) * entry.qty;
  }

  return { units, gross, cost };
}

/**
 * The variants of one product, in menu order. Temperature is a variant
 * selection on the cart line, not a second button on the menu.
 */
export function variantsOf(catalog: CostCatalog, productId: string): Variant[] {
  return [...catalog.variants.values()]
    .filter((variant) => variant.product_id === productId && variant.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** The variant a tap on the product button rings: pear defaults to ICED. */
export function defaultVariantOf(catalog: CostCatalog, productId: string): Variant | undefined {
  const variants = variantsOf(catalog, productId);
  return variants.find((variant) => variant.is_default) ?? variants[0];
}

/**
 * The modifiers offerable on a line. Driven entirely by
 * `applies_to_variant_ids`, which is why peach gum disappears on hot pear —
 * it is already in that variant's bill of materials.
 */
export function modifiersFor(catalog: CostCatalog, variantId: string, kind?: 'PAID' | 'PREP') {
  return [...catalog.modifiers.values()]
    .filter(
      (modifier) =>
        modifier.applies_to_variant_ids.includes(variantId) &&
        (kind === undefined || modifier.kind === kind),
    )
    .sort((a, b) => a.sort_order - b.sort_order);
}
