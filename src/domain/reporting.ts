/**
 * The day's numbers.
 *
 * Pure. One rule runs through all of it: **a voided sale never happened**. It
 * is not deleted and not edited — the row stays, struck through, with its
 * reason — but it contributes nothing to units, revenue, cost or discounts
 * (CLAUDE.md §2.1.5, §10).
 *
 * A loyalty cup is the mirror image: it counts as a unit and lands in COGS,
 * and is simply worth nothing in revenue.
 */
import type { Satang } from '../lib/money.ts';
import type { DiscountReason, Sale, SaleLine, SaleLineDiscount } from '../db/types.ts';

export interface DayTotals {
  /** Cups and bottles rung, voids excluded. Free cups count. */
  units: number;
  /** What the shop actually took. */
  revenue: Satang;
  cogs: Satang;
  grossProfit: Satang;
  discountsByReason: { reason: DiscountReason; amount: Satang }[];
  totalDiscount: Satang;
  saleCount: number;
  voidedCount: number;
}

export function dayTotals(
  sales: readonly Sale[],
  lines: readonly SaleLine[],
  discounts: readonly SaleLineDiscount[] = [],
): DayTotals {
  const live = sales.filter((sale) => !sale.is_voided);
  const liveIds = new Set(live.map((sale) => sale.id));
  const liveLines = lines.filter((line) => liveIds.has(line.sale_id));
  const liveLineIds = new Set(liveLines.map((line) => line.id));

  const revenue = live.reduce((total, sale) => total + sale.total_net, 0);
  const cogs = live.reduce((total, sale) => total + sale.total_cost, 0);

  const byReason = new Map<DiscountReason, number>();
  for (const discount of discounts) {
    if (!liveLineIds.has(discount.sale_line_id)) continue;
    byReason.set(discount.reason, (byReason.get(discount.reason) ?? 0) + discount.amount);
  }

  return {
    units: liveLines.reduce((total, line) => total + line.qty, 0),
    revenue,
    cogs,
    grossProfit: revenue - cogs,
    discountsByReason: [...byReason].map(([reason, amount]) => ({ reason, amount })),
    totalDiscount: live.reduce((total, sale) => total + sale.total_discount, 0),
    saleCount: live.length,
    voidedCount: sales.length - live.length,
  };
}

/**
 * Whether the day has covered its fixed cost yet. Breakeven is about ten cups
 * and gross margin is around 81%, so a day cannot realistically lose money on
 * margin — it loses money on a batch that did not sell (CLAUDE.md §7).
 */
export function pastBreakeven(totals: DayTotals, fixedCostPerDay: Satang): boolean {
  return totals.grossProfit >= fixedCostPerDay;
}
