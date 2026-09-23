/**
 * The stock engine.
 *
 * Pure functions: data in, rows out. Nothing here writes to Dexie — the
 * repository in src/db/stock-repo.ts does that, in one transaction.
 *
 * The rule that shapes everything else (CLAUDE.md §2.1.2): **stock movements
 * are the ledger**. What is left in a batch is derived by summing its
 * movements, never held as a counter that something has to remember to
 * decrement. That is what makes a void reverse exactly, and what makes an
 * override recoverable instead of a mystery.
 */
import { newId } from '../lib/id.ts';
import type { BatchState, Component, ComponentBatch, StockMovement } from '../db/types.ts';
import { recipeFor, requireComponent, resolveModifiers, type RecipeCatalog } from './recipe.ts';

/** A batch can only be sold from in these states (CLAUDE.md §2.3). */
export const sellableStates: readonly BatchState[] = ['READY', 'CUT', 'BLANCHED'];

/** A jelly slab that has not been cut is not stock the operator can pour. */
export function isSellable(state: BatchState): boolean {
  return sellableStates.includes(state);
}

/** Batches and their ledger, as read from the database. */
export interface StockSnapshot {
  batches: readonly ComponentBatch[];
  movements: readonly StockMovement[];
}

export interface AvailableCups {
  cups: number;
  /**
   * The component that bound the minimum, to name on the sell screen:
   * "สาลี่ขาว เหลือ 8 แก้ว — จำกัดโดยกอง B". Null when nothing binds.
   */
  limitingComponentId: string | null;
}

export interface Shortfall {
  componentId: string;
  /** How much could not be sourced from any batch, in the component's unit. */
  qty: number;
}

export interface DeductionPlan {
  movements: StockMovement[];
  /**
   * Components with no sellable batch to deduct from. The sale still goes
   * through — warn, never block (CLAUDE.md §2.1.6) — but the caller must show
   * this and record the override.
   */
  shortfalls: Shortfall[];
}

export interface SaleLineDeduction {
  saleLineId: string;
  variantId: string;
  qty: number;
  modifierIds?: readonly string[];
}

// ------------------------------------------------------------- what is left

/**
 * What remains in one batch: the sum of its ledger.
 *
 * Production adds, sales subtract, voids add back. A batch with no movements
 * has nothing in it — the quantity made is a PRODUCTION row, not a starting
 * balance held somewhere else.
 */
export function batchRemaining(batchId: string, movements: readonly StockMovement[]): number {
  let total = 0;
  for (const movement of movements) {
    if (movement.component_batch_id === batchId) total += movement.qty_delta;
  }
  return total;
}

/** Combined remaining across every sellable batch of a component (FEFO §2.1.4). */
export function componentRemaining(snapshot: StockSnapshot, componentId: string): number {
  let total = 0;
  for (const batch of snapshot.batches) {
    if (batch.component_id !== componentId || !isSellable(batch.state)) continue;
    total += batchRemaining(batch.id, snapshot.movements);
  }
  return total;
}

// ---------------------------------------------------------- available cups

/**
 * How many cups of a variant the stock can still make, and which component
 * runs out first.
 *
 * Deliberately excludes modifier components: if basil seed runs out the
 * *modifier* goes unavailable, the tamarind drink does not (CLAUDE.md §2.2).
 * Components that are not batch tracked never limit anything — the shop does
 * not count chrysanthemum flowers.
 */
export function availableCups(
  catalog: RecipeCatalog,
  snapshot: StockSnapshot,
  variantId: string,
): AvailableCups {
  const limiting = recipeFor(catalog, variantId).filter(
    (line) => line.component.is_batch_tracked && line.qty > 0,
  );

  // A drink with nothing tracked in it cannot run out.
  if (limiting.length === 0) return { cups: Infinity, limitingComponentId: null };

  let cups = Infinity;
  let limitingComponentId: string | null = null;

  for (const line of limiting) {
    const possible = Math.floor(componentRemaining(snapshot, line.component.id) / line.qty);
    if (possible < cups) {
      cups = possible;
      limitingComponentId = line.component.id;
    }
  }

  // A stretched batch can go negative; the operator cannot sell -3 cups.
  return { cups: Math.max(0, cups), limitingComponentId };
}

/**
 * Whether a modifier can still be offered. Separate from availableCups on
 * purpose — a modifier running out must never make a drink unsellable.
 */
export function modifierAvailable(
  catalog: RecipeCatalog,
  snapshot: StockSnapshot,
  modifierId: string,
  cups = 1,
): boolean {
  const [modifier] = resolveModifiers(catalog, [modifierId]);
  if (!modifier || modifier.component_id === null) return true;

  const component = requireComponent(catalog, modifier.component_id);
  if (!component.is_batch_tracked) return true;

  const needed = (modifier.qty_per_cup ?? 0) * cups;
  return componentRemaining(snapshot, component.id) >= needed;
}

// ---------------------------------------------------------------- deducting

/**
 * The movements to write for one sale line. Nothing is persisted here.
 *
 * FEFO: the batch that expires soonest is drained first, spilling into the
 * next when it is short. If every sellable batch is exhausted the remainder
 * comes out of the last one, pushing it negative under reason `OVERRIDE` —
 * that is the operator stretching a batch, and the ledger should say so
 * rather than silently losing the cup.
 */
export function deductForSaleLine(
  catalog: RecipeCatalog,
  snapshot: StockSnapshot,
  line: SaleLineDeduction,
  now: string,
): DeductionPlan {
  return deductForSale(catalog, snapshot, [line], now);
}

/**
 * The movements for a whole sale. Lines share one working balance, so two
 * tamarinds in one transaction drain the same batch in sequence rather than
 * both reading the opening quantity.
 */
export function deductForSale(
  catalog: RecipeCatalog,
  snapshot: StockSnapshot,
  lines: readonly SaleLineDeduction[],
  now: string,
): DeductionPlan {
  const remaining = openingBalances(snapshot);
  const movements: StockMovement[] = [];
  const shortfalls = new Map<string, number>();

  for (const line of lines) {
    for (const recipeLine of recipeFor(catalog, line.variantId, line.modifierIds ?? [])) {
      if (!recipeLine.component.is_batch_tracked) continue;

      const needed = recipeLine.qty * line.qty;
      if (needed <= 0) continue;

      const unsourced = consume(
        recipeLine.component.id,
        needed,
        line.saleLineId,
        now,
        snapshot,
        remaining,
        movements,
      );

      if (unsourced > 0) {
        shortfalls.set(
          recipeLine.component.id,
          (shortfalls.get(recipeLine.component.id) ?? 0) + unsourced,
        );
      }
    }
  }

  return {
    movements,
    shortfalls: [...shortfalls].map(([componentId, qty]) => ({ componentId, qty })),
  };
}

/**
 * Movements that exactly undo a sale's deductions.
 *
 * A completed sale is never edited — it is voided and re-rung (CLAUDE.md
 * §2.1.5) — so this inverts every SALE and OVERRIDE row the sale wrote, batch
 * by batch. Rows that have already been reversed are skipped: voiding twice
 * returns nothing rather than crediting the stock a second time.
 */
export function reverseForSale(
  saleLineIds: readonly string[],
  movements: readonly StockMovement[],
  now: string,
): StockMovement[] {
  const lineIds = new Set(saleLineIds);
  const alreadyReversed = new Set(
    movements
      .map((movement) => movement.reverses_movement_id)
      .filter((id): id is string => id !== null),
  );

  return movements
    .filter(
      (movement) =>
        movement.sale_line_id !== null &&
        lineIds.has(movement.sale_line_id) &&
        (movement.reason === 'SALE' || movement.reason === 'OVERRIDE') &&
        !alreadyReversed.has(movement.id),
    )
    .map((movement) => ({
      id: newId(),
      sale_line_id: movement.sale_line_id,
      component_batch_id: movement.component_batch_id,
      qty_delta: -movement.qty_delta,
      reason: 'VOID_REVERSAL' as const,
      reverses_movement_id: movement.id,
      created_at: now,
      synced_at: null,
    }));
}

// ------------------------------------------------------------------- expiry

export type ExpiryStatus = 'OK' | 'EXPIRING_SOON' | 'EXPIRED';

/** How long before expiry a batch starts warning. A display hint, not a rule. */
export const EXPIRING_SOON_HOURS = 12;

/**
 * When a batch actually expires.
 *
 * Cutting a jelly slab drops its shelf life from 72 h to 24 h, so a CUT batch
 * is clocked from when it was cut. `cutSlab` already writes that into
 * `expires_at`; taking the earlier of the two means a batch that was cut
 * without it still reads correctly rather than claiming three days.
 */
export function effectiveExpiry(batch: ComponentBatch, component: Component): string {
  if (batch.state !== 'CUT' || component.cut_shelf_life_hours === null) return batch.expires_at;

  const cutClock = addHours(batch.made_at, component.cut_shelf_life_hours);
  return cutClock < batch.expires_at ? cutClock : batch.expires_at;
}

export function expiryStatus(
  batch: ComponentBatch,
  component: Component,
  now: string,
  soonHours: number = EXPIRING_SOON_HOURS,
): ExpiryStatus {
  const expires = Date.parse(effectiveExpiry(batch, component));
  const at = Date.parse(now);

  if (at >= expires) return 'EXPIRED';
  if (expires - at <= soonHours * 3_600_000) return 'EXPIRING_SOON';
  return 'OK';
}

// ---------------------------------------------------------------- the cut

export interface CutPlan {
  /** The cut cubes, as a batch of their own with the shorter clock. */
  batch: ComponentBatch;
  movements: StockMovement[];
}

/**
 * Cut grams off a jelly slab.
 *
 * The cut cubes become a new CUT batch on a same-day clock, and the slab keeps
 * whatever is left on its original 72 h clock (CLAUDE.md §2.3). Modelling it
 * as one batch that changes state would put the uncut remainder on the short
 * clock and throw away good jelly.
 */
export function cutSlab(
  catalog: RecipeCatalog,
  slab: ComponentBatch,
  grams: number,
  now: string,
): CutPlan {
  if (grams <= 0) throw new Error('a cut records the grams cut, which must be positive');
  if (slab.state !== 'SLAB') throw new Error(`batch ${slab.id} is ${slab.state}, not a SLAB`);

  const component = requireComponent(catalog, slab.component_id);
  const shelfLife = component.cut_shelf_life_hours ?? component.shelf_life_hours ?? 24;

  const batch: ComponentBatch = {
    id: newId(),
    component_id: slab.component_id,
    made_at: now,
    qty_made: grams,
    state: 'CUT',
    ready_at: now,
    expires_at: addHours(now, shelfLife),
    parent_batch_id: slab.id,
    note: null,
    synced_at: null,
  };

  return {
    batch,
    movements: [
      movement(slab.id, -grams, 'PRODUCTION', now),
      movement(batch.id, grams, 'PRODUCTION', now),
    ],
  };
}

/** The opening balance of a newly recorded batch, as a ledger row. */
export function productionMovement(batch: ComponentBatch, now: string): StockMovement {
  return movement(batch.id, batch.qty_made, 'PRODUCTION', now);
}

// ------------------------------------------------------------------ private

function openingBalances(snapshot: StockSnapshot): Map<string, number> {
  const balances = new Map<string, number>();
  for (const batch of snapshot.batches) {
    balances.set(batch.id, batchRemaining(batch.id, snapshot.movements));
  }
  return balances;
}

/**
 * Take `needed` from a component's sellable batches, soonest expiry first.
 * Returns whatever could not be sourced at all.
 */
function consume(
  componentId: string,
  needed: number,
  saleLineId: string,
  now: string,
  snapshot: StockSnapshot,
  remaining: Map<string, number>,
  out: StockMovement[],
): number {
  const batches = snapshot.batches
    .filter((batch) => batch.component_id === componentId && isSellable(batch.state))
    .sort(byExpiryThenAge);

  if (batches.length === 0) return needed;

  let left = needed;

  for (const batch of batches) {
    if (left <= 0) break;
    const available = remaining.get(batch.id) ?? 0;
    if (available <= 0) continue;

    const take = Math.min(available, left);
    remaining.set(batch.id, available - take);
    out.push(movement(batch.id, -take, 'SALE', now, saleLineId));
    left -= take;
  }

  if (left > 0) {
    // Every batch is empty and the operator poured it anyway. Record it
    // against the longest-lived batch as an override rather than losing it.
    const stretched = batches[batches.length - 1];
    if (stretched) {
      remaining.set(stretched.id, (remaining.get(stretched.id) ?? 0) - left);
      out.push(movement(stretched.id, -left, 'OVERRIDE', now, saleLineId));
      left = 0;
    }
  }

  return left;
}

/** FEFO: soonest expiry first, oldest first on a tie, then id for stability. */
function byExpiryThenAge(a: ComponentBatch, b: ComponentBatch): number {
  return (
    a.expires_at.localeCompare(b.expires_at) ||
    a.made_at.localeCompare(b.made_at) ||
    a.id.localeCompare(b.id)
  );
}

function movement(
  batchId: string,
  qtyDelta: number,
  reason: StockMovement['reason'],
  now: string,
  saleLineId: string | null = null,
): StockMovement {
  return {
    id: newId(),
    sale_line_id: saleLineId,
    component_batch_id: batchId,
    qty_delta: qtyDelta,
    reason,
    reverses_movement_id: null,
    created_at: now,
    synced_at: null,
  };
}

function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}
