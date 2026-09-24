/**
 * What the operator needs to know before the first sale.
 *
 * Pure. The open-day screen asks three questions of the stock, and the
 * answers live here so they can be tested without a screen:
 *
 * - what is on hand, and is any of it about to go off?
 * - which jelly has to be cut before its drinks can be sold?
 * - which components are not there at all?
 */
import { bangkokDate } from '../lib/datetime.ts';
import { newId } from '../lib/id.ts';
import type { Component, ComponentBatch, StockMovement, Variant } from '../db/types.ts';
import type { CostCatalog } from './cost.ts';
import {
  batchRemaining,
  effectiveExpiry,
  expiryStatus,
  isSellable,
  type StockSnapshot,
} from './stock.ts';

/**
 * Shelf life as the open-day screen colours it. `TODAY` is anything that goes
 * off on today's Bangkok date or inside the next twelve hours — a batch that
 * will not see the next market day.
 */
export type ShelfStatus = 'OK' | 'TODAY' | 'EXPIRED';

export function shelfStatus(batch: ComponentBatch, component: Component, now: string): ShelfStatus {
  const status = expiryStatus(batch, component, now);
  if (status === 'EXPIRED') return 'EXPIRED';
  if (status === 'EXPIRING_SOON') return 'TODAY';
  return bangkokDate(effectiveExpiry(batch, component)) <= bangkokDate(now) ? 'TODAY' : 'OK';
}

export interface BatchOnHand {
  batch: ComponentBatch;
  remaining: number;
  status: ShelfStatus;
  expiresAt: string;
}

export interface ComponentOnHand {
  component: Component;
  /** Combined across batches — what the drinks can actually draw on (FEFO). */
  total: number;
  /** Soonest expiry first, the order they will be poured. */
  batches: BatchOnHand[];
}

/**
 * Every batch-tracked component with sellable stock, grouped, in menu order.
 * A batch stretched below zero by an override is listed too: it is wrong, and
 * open day is where the operator puts it right.
 */
export function stockOnHand(
  catalog: CostCatalog,
  snapshot: StockSnapshot,
  now: string,
): ComponentOnHand[] {
  return trackedComponents(catalog)
    .map((component) => {
      const batches = batchesOf(snapshot, component, now, (batch) => isSellable(batch.state));
      return {
        component,
        total: batches.reduce((sum, entry) => sum + entry.remaining, 0),
        batches,
      };
    })
    .filter((entry) => entry.batches.length > 0);
}

export interface JellyToCut {
  component: Component;
  /**
   * Uncut slabs with something left in them, soonest expiry first. Empty when
   * today's cut took the whole slab — the entry stays so the cut can be seen.
   */
  slabs: BatchOnHand[];
  /** Cut cubes already on hand and still in date. */
  cutRemaining: number;
  /** What cannot be sold until some of this is cut, by variant name. */
  blockedVariants: Variant[];
  /**
   * True while there is an in-date slab and no in-date cubes. The screen will
   * not open the day until this is answered (BUILD-PROMPTS step 7).
   *
   * Per component, not per slab: with Sunday's slab half cut and Monday's
   * still whole, cutting Sunday's is enough — insisting on Monday's too would
   * put good jelly on the short clock for nothing.
   */
  mustCut: boolean;
}

/**
 * Jelly still in the tray. Uncut jelly is not sellable (CLAUDE.md §2.3), so a
 * drink that needs it reads sold out until the cut is recorded — and the
 * operator should hear that here, not from the first customer.
 */
export function jellyToCut(
  catalog: CostCatalog,
  snapshot: StockSnapshot,
  now: string,
): JellyToCut[] {
  const result: JellyToCut[] = [];

  for (const component of trackedComponents(catalog)) {
    const slabs = batchesOf(snapshot, component, now, (batch) => batch.state === 'SLAB').filter(
      (entry) => entry.remaining > 0,
    );

    // A slab cut whole this morning leaves nothing in the tray, but the
    // operator still needs to see that the cut landed and the drink is back.
    const cutToday = snapshot.batches.some(
      (batch) =>
        batch.component_id === component.id &&
        batch.state === 'CUT' &&
        batch.parent_batch_id !== null &&
        bangkokDate(batch.made_at) === bangkokDate(now),
    );
    if (slabs.length === 0 && !cutToday) continue;

    const cutRemaining = batchesOf(snapshot, component, now, (batch) => isSellable(batch.state))
      .filter((entry) => entry.status !== 'EXPIRED')
      .reduce((sum, entry) => sum + Math.max(0, entry.remaining), 0);

    // An expired slab is waste, not a reason to hold up the day.
    const inDateSlab = slabs.some((entry) => entry.status !== 'EXPIRED');

    result.push({
      component,
      slabs,
      cutRemaining,
      blockedVariants: variantsUsing(catalog, component.id),
      mustCut: inDateSlab && cutRemaining <= 0,
    });
  }

  return result;
}

/**
 * Tracked components with nothing sellable and no slab waiting to be cut.
 * The drinks that need them will read sold out all day.
 */
export function missingComponents(catalog: CostCatalog, snapshot: StockSnapshot): Component[] {
  return trackedComponents(catalog).filter((component) => {
    let sellable = 0;
    let slab = 0;
    for (const batch of snapshot.batches) {
      if (batch.component_id !== component.id) continue;
      const remaining = batchRemaining(batch.id, snapshot.movements);
      if (isSellable(batch.state)) sellable += remaining;
      else if (batch.state === 'SLAB') slab += remaining;
    }
    return sellable <= 0 && slab <= 0;
  });
}

/**
 * Active variants whose bill of materials needs this component, in menu
 * order. Modifier components never appear here: a missing modifier makes the
 * modifier unavailable, not the drink (CLAUDE.md §2.2).
 */
export function variantsUsing(catalog: CostCatalog, componentId: string): Variant[] {
  const products = catalog.products;
  return [...catalog.variants.values()]
    .filter((variant) => {
      const product = products.get(variant.product_id);
      if (!variant.is_active || !product?.is_active) return false;
      const bom = catalog.bomByVariant.get(variant.id) ?? [];
      return bom.some((row) => row.component_id === componentId && row.qty_per_cup > 0);
    })
    .sort(
      (a, b) =>
        (products.get(a.product_id)?.sort_order ?? 0) -
          (products.get(b.product_id)?.sort_order ?? 0) || a.sort_order - b.sort_order,
    );
}

/**
 * The ledger row that brings a batch to what the operator actually counted.
 *
 * Never an overwrite: the difference goes in as its own ADJUSTMENT row, so
 * what was recorded and what was found both stay visible (CLAUDE.md §2.1.2).
 * Null when there is nothing to correct.
 */
export function adjustmentMovement(
  batchId: string,
  current: number,
  counted: number,
  now: string,
): StockMovement | null {
  if (!Number.isFinite(counted) || counted < 0) {
    throw new Error('a counted quantity must be zero or more');
  }

  const delta = counted - current;
  if (delta === 0) return null;

  return {
    id: newId(),
    sale_line_id: null,
    component_batch_id: batchId,
    qty_delta: delta,
    reason: 'ADJUSTMENT',
    reverses_movement_id: null,
    created_at: now,
    synced_at: null,
  };
}

// ------------------------------------------------------------------ private

function trackedComponents(catalog: CostCatalog): Component[] {
  return [...catalog.components.values()]
    .filter((component) => component.is_batch_tracked)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function batchesOf(
  snapshot: StockSnapshot,
  component: Component,
  now: string,
  include: (batch: ComponentBatch) => boolean,
): BatchOnHand[] {
  return snapshot.batches
    .filter((batch) => batch.component_id === component.id && include(batch))
    .map((batch) => ({
      batch,
      remaining: batchRemaining(batch.id, snapshot.movements),
      status: shelfStatus(batch, component, now),
      expiresAt: effectiveExpiry(batch, component),
    }))
    .filter((entry) => entry.remaining !== 0)
    .sort(
      (a, b) =>
        a.expiresAt.localeCompare(b.expiresAt) ||
        a.batch.made_at.localeCompare(b.batch.made_at) ||
        a.batch.id.localeCompare(b.batch.id),
    );
}
