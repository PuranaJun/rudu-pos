/**
 * Removing a drink, a component or a packaging item from the catalog.
 *
 * Removed is a mark (`removed_at`), never a delete — see `Removable` in
 * db/types.ts for why. These rules decide whether a removal may go ahead.
 *
 * A thing that something else still uses is not removed out from under it: a
 * component in a recipe, a cup in a packaging set. Removing it would quietly
 * change what a cup deducts or costs, and the owner would find out from a
 * wrong number weeks later. The refusal names what still uses it, so the fix
 * is one look away. This is settings, not the sell path: "warn, never block"
 * (CLAUDE.md §2.1.6) is about selling, and nothing here is on it.
 *
 * Pure: catalog in, Thai reasons out.
 */
import type { CostCatalog } from './cost.ts';
import type { PurchaseItem } from '../db/types.ts';

/** Removed rows are kept for history and listed nowhere else. */
export function isRemoved(row: { removed_at?: string | null }): boolean {
  return row.removed_at !== undefined && row.removed_at !== null;
}

/** A variant goes with its drink: one of a removed product is not offered anywhere. */
export function isRemovedVariant(catalog: CostCatalog, variant: { product_id: string }): boolean {
  const product = catalog.products.get(variant.product_id);
  return !product || isRemoved(product);
}

function listed(names: Iterable<string>): string {
  return [...new Set(names)].join(', ');
}

/**
 * Why a component cannot be removed yet. Empty: it can.
 *
 * Counts a drink that is switched off too: switched back on, it would sell
 * with a hole in its recipe.
 */
export function componentRemovalBlockers(catalog: CostCatalog, componentId: string): string[] {
  const problems: string[] = [];

  const inRecipes: string[] = [];
  for (const variant of catalog.variants.values()) {
    const product = catalog.products.get(variant.product_id);
    if (!product || isRemoved(product)) continue;
    const rows = catalog.bomByVariant.get(variant.id) ?? [];
    if (rows.some((row) => row.component_id === componentId)) inRecipes.push(variant.name_th);
  }
  if (inRecipes.length > 0) {
    problems.push(`อยู่ในสูตรของ ${listed(inRecipes)} — เอาออกจากสูตรก่อน`);
  }

  const toppings = [...catalog.modifiers.values()]
    .filter((modifier) => modifier.component_id === componentId)
    .map((modifier) => modifier.name_th);
  if (toppings.length > 0) {
    problems.push(`ท็อปปิ้ง ${listed(toppings)} ใช้อยู่ — เปลี่ยนที่หน้าท็อปปิ้งก่อน`);
  }

  const madeFromIt = [...catalog.components.values()]
    .filter((other) => !isRemoved(other) && other.source_component_id === componentId)
    .map((other) => other.name_th);
  if (madeFromIt.length > 0) {
    problems.push(`${listed(madeFromIt)} ทำจากส่วนประกอบนี้ — เปลี่ยน "ทำจากของอื่น" ก่อน`);
  }

  return problems;
}

/** Why a packaging item cannot be removed yet. Empty: it can. */
export function packagingItemRemovalBlockers(
  catalog: CostCatalog,
  itemId: string,
  purchaseItems: readonly PurchaseItem[],
): string[] {
  const problems: string[] = [];

  const sets = [...catalog.packagingSets.values()]
    .filter((set) => set.items.some((line) => line.packaging_item_id === itemId))
    .map((set) => set.name);
  if (sets.length > 0) problems.push(`อยู่ในชุด ${listed(sets)} — เอาออกจากชุดก่อน`);

  const toppings = [...catalog.modifiers.values()]
    .filter((modifier) => modifier.removes_packaging_item_id === itemId)
    .map((modifier) => modifier.name_th);
  if (toppings.length > 0) {
    problems.push(`ท็อปปิ้ง ${listed(toppings)} ใช้อยู่ — เปลี่ยนที่หน้าท็อปปิ้งก่อน`);
  }

  const bought = purchaseItems
    .filter((item) => item.is_active && item.packaging_item_id === itemId)
    .map((item) => item.name_th);
  if (bought.length > 0) {
    problems.push(`ของที่ซื้อ ${listed(bought)} เติมสต็อกนี้ — เปลี่ยนที่หน้าซื้อของก่อน`);
  }

  return problems;
}
