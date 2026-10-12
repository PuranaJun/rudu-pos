/**
 * Order numbers and the queue (CLAUDE.md §6.1, §6.1a).
 *
 * The number is what the customer is called by. It is assigned at payment,
 * never typed or picked, and starts again at 1 every business date. The queue
 * is every paid order not yet handed over — a convenience for a busy moment,
 * never a step: an order nobody marks changes no figure anywhere.
 */
import type { OrderType, Sale } from '../db/types.ts';

export const ORDER_TYPE_TH: Record<OrderType, string> = {
  TAKEAWAY: 'กลับบ้าน',
  DINE_IN: 'ทานที่ร้าน',
};

/**
 * The next number for a business date, given the sales already on it.
 * Voided sales count: a number that was called out once is never reused.
 */
export function nextOrderNo(sameDay: readonly Pick<Sale, 'order_no'>[]): number {
  let highest = 0;
  for (const sale of sameDay) {
    if (typeof sale.order_no === 'number' && sale.order_no > highest) highest = sale.order_no;
  }
  return highest + 1;
}

/** Paid, not voided, not handed over: oldest number first, the order they are made in. */
export function waitingOrders<T extends Sale>(sales: readonly T[]): T[] {
  return sales
    .filter((sale) => !sale.is_voided && sale.handed_over_at === null)
    .sort((a, b) => a.order_no - b.order_no);
}

/** The ones handed over most recently first — where a mis-tap is put right. */
export function handedOverOrders<T extends Sale>(sales: readonly T[]): T[] {
  return sales
    .filter((sale) => !sale.is_voided && sale.handed_over_at !== null)
    .sort((a, b) => (b.handed_over_at ?? '').localeCompare(a.handed_over_at ?? ''));
}

/** A sale row as an older build wrote it: no number, no type, no hand-over. */
type LegacySale = Pick<Sale, 'id' | 'business_date' | 'created_at'> &
  Partial<Pick<Sale, 'order_no' | 'order_type' | 'handed_over_at'>>;

export interface SalePatch {
  id: string;
  changes: Pick<Sale, 'order_no' | 'order_type' | 'handed_over_at'>;
}

/**
 * Bring sales written before order numbers existed up to shape: numbered in
 * the order they were rung on each business date (after any number the date
 * already uses), takeaway, and already handed over — they were, long ago.
 * Rows that already have all three are left alone.
 */
export function legacySalePatches(sales: readonly LegacySale[]): SalePatch[] {
  const byDate = new Map<string, LegacySale[]>();
  for (const sale of sales) {
    const list = byDate.get(sale.business_date);
    if (list) list.push(sale);
    else byDate.set(sale.business_date, [sale]);
  }

  const patches: SalePatch[] = [];
  for (const sameDay of byDate.values()) {
    let next = nextOrderNo(sameDay as Pick<Sale, 'order_no'>[]);
    const ordered = [...sameDay].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
    for (const sale of ordered) {
      const numbered = typeof sale.order_no === 'number';
      if (numbered && sale.order_type !== undefined && sale.handed_over_at !== undefined) continue;
      patches.push({
        id: sale.id,
        changes: {
          order_no: numbered ? sale.order_no! : next++,
          order_type: sale.order_type ?? 'TAKEAWAY',
          handed_over_at: sale.handed_over_at === undefined ? sale.created_at : sale.handed_over_at,
        },
      });
    }
  }
  return patches;
}
