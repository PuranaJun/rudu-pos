/**
 * Closing the day (CLAUDE.md §6.4).
 *
 * Pure. Waste is where this shop loses money — not margin — so the defaults
 * here are the product: on an ordinary evening the operator confirms them in
 * one tap, and what gets thrown away is recorded with a reason and a price
 * rather than tipped into the drain unrecorded.
 */
import { bangkokDate } from '../lib/datetime.ts';
import { newId } from '../lib/id.ts';
import type { Satang } from '../lib/money.ts';
import type {
  CashSession,
  Component,
  ComponentBatch,
  Sale,
  StockMovement,
  WasteEvent,
  WasteReason,
} from '../db/types.ts';
import type { CostCatalog } from './cost.ts';
import { adjustmentMovement, shelfStatus, type ShelfStatus } from './open-day.ts';
import { batchRemaining, isSellable, type StockSnapshot } from './stock.ts';

export const WASTE_REASONS: readonly WasteReason[] = [
  'END_OF_DAY_PERISHABLE',
  'EXPIRED',
  'QUALITY',
  'SPILLAGE',
];

export const WASTE_REASON_TH: Record<WasteReason, string> = {
  END_OF_DAY_PERISHABLE: 'ของวันเดียว',
  EXPIRED: 'หมดอายุ',
  QUALITY: 'คุณภาพไม่ดี',
  SPILLAGE: 'หก',
};

export type Decision = 'CARRY' | 'DISCARD';

/**
 * Made to be used the day it is made: cut jelly, and anything whose shelf
 * life is a day or less (the fresh pear, the basil seed). Read from the
 * batch and the component row, so a recipe change moves it without code.
 */
export function isSameDay(batch: ComponentBatch, component: Component): boolean {
  if (batch.state === 'CUT') return true;
  return component.shelf_life_hours !== null && component.shelf_life_hours <= 24;
}

export interface CloseLine {
  batch: ComponentBatch;
  component: Component;
  /** What the ledger says is left. Can be negative after an override. */
  remaining: number;
  status: ShelfStatus;
  sameDay: boolean;
  /** The default, which the operator confirms or flips. */
  decision: Decision;
  /** The reason a discard would carry — also the default. */
  reason: WasteReason;
}

/**
 * Everything at the stall or in the fridge that has a fate to decide, with
 * the decision already made the way it usually goes:
 *
 * - expired → discard, EXPIRED
 * - same-day → discard, END_OF_DAY_PERISHABLE
 * - anything else still in date → carry over
 *
 * Tomorrow's tea, still steeping, is not listed: its life has not started.
 */
export function closingLines(
  catalog: CostCatalog,
  snapshot: StockSnapshot,
  now: string,
): CloseLine[] {
  const lines: CloseLine[] = [];

  for (const batch of snapshot.batches) {
    if (!isSellable(batch.state) && batch.state !== 'SLAB') continue;

    const component = catalog.components.get(batch.component_id);
    if (!component?.is_batch_tracked) continue;

    const remaining = batchRemaining(batch.id, snapshot.movements);
    if (remaining === 0) continue;

    const status = shelfStatus(batch, component, now);
    const sameDay = isSameDay(batch, component);
    const expired = status === 'EXPIRED';

    lines.push({
      batch,
      component,
      remaining,
      status,
      sameDay,
      decision: expired || sameDay ? 'DISCARD' : 'CARRY',
      reason: expired ? 'EXPIRED' : sameDay ? 'END_OF_DAY_PERISHABLE' : 'QUALITY',
    });
  }

  return lines.sort(
    (a, b) =>
      a.component.sort_order - b.component.sort_order ||
      a.batch.expires_at.localeCompare(b.batch.expires_at),
  );
}

/** What the operator settled on for one batch. */
export interface CloseDecision {
  batchId: string;
  /** What is actually there, by eye. Defaults to the ledger's figure. */
  counted: number;
  decision: Decision;
  reason: WasteReason;
}

export interface CloseStockPlan {
  movements: StockMovement[];
  wasteEvents: WasteEvent[];
  discardedBatchIds: string[];
}

/**
 * The rows that settle the stock at close.
 *
 * Two separate facts, recorded separately:
 * - a count that differs from the ledger is an ADJUSTMENT — shrinkage,
 *   over-pouring, a spill nobody rang up;
 * - what is then thrown away is WASTE, with a waste_event carrying its reason
 *   and its cost.
 *
 * Folding the two together would make waste look worse on a sloppy day and
 * better on a careful one, which is backwards.
 */
export function planCloseStock(
  catalog: CostCatalog,
  snapshot: StockSnapshot,
  decisions: readonly CloseDecision[],
  sessionId: string,
  now: string,
): CloseStockPlan {
  const plan: CloseStockPlan = { movements: [], wasteEvents: [], discardedBatchIds: [] };

  for (const decision of decisions) {
    const batch = snapshot.batches.find((entry) => entry.id === decision.batchId);
    if (!batch) throw new Error(`batch ${decision.batchId} not found`);
    const component = catalog.components.get(batch.component_id);
    if (!component) throw new Error(`component ${batch.component_id} not found`);

    // Read here, not trusted from the screen: a sale rung after the screen
    // drew would otherwise be silently undone by the adjustment.
    const remaining = batchRemaining(batch.id, snapshot.movements);
    const adjustment = adjustmentMovement(batch.id, remaining, decision.counted, now);
    if (adjustment) plan.movements.push(adjustment);

    if (decision.decision !== 'DISCARD') continue;
    plan.discardedBatchIds.push(batch.id);
    if (decision.counted <= 0) continue;

    plan.movements.push({
      id: newId(),
      sale_line_id: null,
      component_batch_id: batch.id,
      qty_delta: -decision.counted,
      reason: 'WASTE',
      reverses_movement_id: null,
      created_at: now,
      synced_at: null,
    });
    plan.wasteEvents.push({
      id: newId(),
      component_batch_id: batch.id,
      qty_discarded: decision.counted,
      reason: decision.reason,
      recorded_at: now,
      note: null,
      cash_session_id: sessionId,
      cost: wasteCost(component, decision.counted),
      synced_at: null,
    });
  }

  return plan;
}

/** What a quantity of a component cost to make, in satang, at today's cost. */
export function wasteCost(component: Component, qty: number): Satang {
  return Math.round(qty * component.cost_per_unit * 100);
}

// ------------------------------------------------------------------- cash

/**
 * The sales that belong to a session: its business date, rung after it
 * opened and before it closed. The time bounds keep a second session on the
 * same date — closed, then reopened — from counting the first one's cash.
 */
export function salesInSession(sales: readonly Sale[], session: CashSession): Sale[] {
  const date = bangkokDate(session.opened_at);
  return sales.filter(
    (sale) =>
      sale.business_date === date &&
      sale.created_at >= session.opened_at &&
      (session.closed_at === null || sale.created_at <= session.closed_at),
  );
}

/** Float plus what cash sales put in the drawer. Voided sales took their cash back out. */
export function expectedCash(session: CashSession, sales: readonly Sale[]): Satang {
  return salesInSession(sales, session)
    .filter((sale) => sale.payment_method === 'CASH' && !sale.is_voided)
    .reduce((total, sale) => total + sale.total_net, session.opening_float);
}

/** Thai notes and coins, largest first, in satang. A currency, not a recipe. */
export const THB_DENOMINATIONS: readonly Satang[] = [
  100_000, 50_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
];

export function countedFromDenominations(counts: ReadonlyMap<Satang, number>): Satang {
  let total = 0;
  for (const [denomination, count] of counts) total += denomination * count;
  return total;
}
