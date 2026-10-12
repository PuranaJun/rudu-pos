/**
 * Packaging as stock: cups, lids, straws (CLAUDE.md §6.6).
 *
 * The same ledger rule as components — remaining is the sum of movements,
 * never a counter — so a void reverses exactly what its sale took. Unlike a
 * component, packaging **never limits what can be sold**: a count that has
 * drifted must not grey out a drink and add a tap to a sale. It warns.
 *
 * An item is unknown until it has been counted once. Sales deduct from it all
 * the same, and the first count settles the difference.
 */
import type { PackagingItem, PackagingMovement } from '../db/types.ts';
import type { CostCatalog } from './cost.ts';
import { resolveModifiers } from './recipe.ts';

export interface PackagingUse {
  packagingItemId: string;
  qty: number;
}

/**
 * What one cup puts in the customer's hand: the variant's packaging set, less
 * anything a modifier takes out (no ice). The cost engine prices this same
 * list, so cost and stock cannot disagree about what a cup used.
 */
export function packagingPerCup(
  catalog: CostCatalog,
  variantId: string,
  modifierIds: readonly string[] = [],
): PackagingUse[] {
  const variant = catalog.variants.get(variantId);
  if (!variant) throw new Error(`unknown variant ${variantId}`);
  const set = catalog.packagingSets.get(variant.packaging_set_id);
  if (!set) {
    throw new Error(`packaging set ${variant.packaging_set_id} missing for variant ${variantId}`);
  }

  const removed = new Set(
    resolveModifiers(catalog, modifierIds)
      .map((mod) => mod.removes_packaging_item_id)
      .filter((id): id is string => id !== null),
  );

  return set.items
    .filter((line) => !removed.has(line.packaging_item_id))
    .map((line) => ({ packagingItemId: line.packaging_item_id, qty: line.qty }));
}

export interface PackagingSaleLine {
  saleLineId: string;
  variantId: string;
  qty: number;
  modifierIds: readonly string[];
}

/** The movements a sale writes: one per counted item per line. */
export function packagingForSale(
  catalog: CostCatalog,
  lines: readonly PackagingSaleLine[],
  now: string,
): PackagingMovement[] {
  const movements: PackagingMovement[] = [];
  for (const line of lines) {
    const totals = new Map<string, number>();
    for (const use of packagingPerCup(catalog, line.variantId, line.modifierIds)) {
      if (!catalog.packagingItems.get(use.packagingItemId)?.is_stock_tracked) continue;
      totals.set(use.packagingItemId, (totals.get(use.packagingItemId) ?? 0) + use.qty * line.qty);
    }
    for (const [packagingItemId, qty] of totals) {
      movements.push(
        movement(packagingItemId, -qty, 'SALE', now, { sale_line_id: line.saleLineId }),
      );
    }
  }
  return movements;
}

/**
 * Undo a sale's packaging. A SALE row that already has a reversal is skipped,
 * so voiding twice can never credit twice.
 */
export function reversePackaging(
  saleLineIds: readonly string[],
  movements: readonly PackagingMovement[],
  now: string,
): PackagingMovement[] {
  const lines = new Set(saleLineIds);
  const reversed = new Set(
    movements
      .filter((m) => m.reason === 'VOID_REVERSAL' && m.reverses_movement_id !== null)
      .map((m) => m.reverses_movement_id),
  );
  return movements
    .filter(
      (m) =>
        m.reason === 'SALE' &&
        m.sale_line_id !== null &&
        lines.has(m.sale_line_id) &&
        !reversed.has(m.id),
    )
    .map((m) =>
      movement(m.packaging_item_id, -m.qty_delta, 'VOID_REVERSAL', now, {
        sale_line_id: m.sale_line_id,
        reverses_movement_id: m.id,
      }),
    );
}

/** The sum of the ledger, whether or not it has been counted. */
export function packagingRemaining(
  packagingItemId: string,
  movements: readonly PackagingMovement[],
): number {
  let total = 0;
  for (const m of movements) if (m.packaging_item_id === packagingItemId) total += m.qty_delta;
  return total;
}

/**
 * A count: the difference between what is on the shelf and what the ledger
 * says, recorded as one row. The ledger is never rewritten, so a count that
 * was wrong is put right by the next one.
 */
export function countMovement(
  packagingItemId: string,
  counted: number,
  movements: readonly PackagingMovement[],
  now: string,
): PackagingMovement {
  return movement(
    packagingItemId,
    counted - packagingRemaining(packagingItemId, movements),
    'COUNT',
    now,
  );
}

export type PackagingLevel = 'UNCOUNTED' | 'OK' | 'LOW' | 'OUT';

export interface PackagingStock {
  item: PackagingItem;
  /** Null until the item has been counted once. */
  remaining: number | null;
  level: PackagingLevel;
}

const LEVEL_ORDER: Record<PackagingLevel, number> = { OUT: 0, LOW: 1, OK: 2, UNCOUNTED: 3 };

/**
 * Every counted-as-stock item: what has run out first, then what is low, then
 * the rest, then what has never been counted — the shelf read top down.
 */
export function packagingStock(
  catalog: CostCatalog,
  movements: readonly PackagingMovement[],
): PackagingStock[] {
  const counted = new Set(
    movements.filter((m) => m.reason === 'COUNT').map((m) => m.packaging_item_id),
  );
  return [...catalog.packagingItems.values()]
    .filter((item) => item.is_stock_tracked)
    .map((item) => {
      if (!counted.has(item.id)) return { item, remaining: null, level: 'UNCOUNTED' as const };
      const remaining = packagingRemaining(item.id, movements);
      const level: PackagingLevel =
        remaining <= 0
          ? 'OUT'
          : item.reorder_at !== null && remaining <= item.reorder_at
            ? 'LOW'
            : 'OK';
      return { item, remaining, level };
    })
    .sort(
      (a, b) =>
        LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
        a.item.name_th.localeCompare(b.item.name_th, 'th'),
    );
}

/** The ones to warn about, worst first. */
export function packagingWarnings(stock: readonly PackagingStock[]): PackagingStock[] {
  return stock
    .filter((entry) => entry.level === 'OUT' || entry.level === 'LOW')
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'OUT' ? -1 : 1));
}

export function movement(
  packagingItemId: string,
  qtyDelta: number,
  reason: PackagingMovement['reason'],
  now: string,
  links: Partial<
    Pick<PackagingMovement, 'sale_line_id' | 'purchase_order_line_id' | 'reverses_movement_id'>
  > = {},
): PackagingMovement {
  return {
    id: crypto.randomUUID(),
    packaging_item_id: packagingItemId,
    qty_delta: qtyDelta,
    reason,
    sale_line_id: links.sale_line_id ?? null,
    purchase_order_line_id: links.purchase_order_line_id ?? null,
    reverses_movement_id: links.reverses_movement_id ?? null,
    created_at: now,
    synced_at: null,
  };
}
