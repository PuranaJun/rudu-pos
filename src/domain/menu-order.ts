/**
 * The order of the drinks on the sell screen — pure.
 *
 * Every POS studied (Wongnai, Ocha, Loyverse) lets the owner put the drinks
 * sold most often where the thumb finds them first. Here that is the top of
 * the menu: with fifteen drinks the menu scrolls on a phone, and a drink that
 * needs a scroll is slower to ring (CLAUDE.md §0). Arranging is settings work;
 * it never adds a tap to a sale.
 */
import type { Product } from '../db/types.ts';

/** Move one entry up (−1) or down (+1); out of range leaves the list as it was. */
export function moveEntry<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * Most sold first; drinks that sold nothing keep their place relative to each
 * other, after the rest. Ties keep the current order, so pressing it twice
 * changes nothing.
 */
export function orderBySales(
  products: readonly Product[],
  unitsByProduct: ReadonlyMap<string, number>,
): Product[] {
  return products
    .map((product, index) => ({ product, index, units: unitsByProduct.get(product.id) ?? 0 }))
    .sort((a, b) => b.units - a.units || a.index - b.index)
    .map((entry) => entry.product);
}

/** Cups per product, from the sale lines of sales that stood. */
export function unitsByProduct(
  lines: readonly { sale_id: string; variant_id: string; qty: number }[],
  liveSaleIds: ReadonlySet<string>,
  productOfVariant: (variantId: string) => string | undefined,
): Map<string, number> {
  const units = new Map<string, number>();
  for (const line of lines) {
    if (!liveSaleIds.has(line.sale_id)) continue;
    const productId = productOfVariant(line.variant_id);
    if (!productId) continue;
    units.set(productId, (units.get(productId) ?? 0) + line.qty);
  }
  return units;
}
