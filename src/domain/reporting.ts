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
import { bangkokDate } from '../lib/datetime.ts';
import type { Satang } from '../lib/money.ts';
import type {
  CashSession,
  ComponentBatch,
  DiscountReason,
  Sale,
  SaleLine,
  SaleLineDiscount,
  Unit,
  WasteEvent,
} from '../db/types.ts';
import type { CostCatalog } from './cost.ts';

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
 * margin — it loses money on a batch that did not sell (CLAUDE.md §7). Which
 * is why the waste comes off before the comparison, once it is known.
 */
export function pastBreakeven(
  totals: DayTotals,
  fixedCostPerDay: Satang,
  wasteCost: Satang = 0,
): boolean {
  return totals.grossProfit - wasteCost >= fixedCostPerDay;
}

export interface WasteLine {
  componentId: string;
  name: string;
  unit: Unit;
  qty: number;
  cost: Satang;
}

export interface DaySummary {
  businessDate: string;
  totals: DayTotals;
  /** Cups and bottles per variant, most sold first. */
  unitsByVariant: { variantId: string; name: string; units: number }[];
  /** Per component, costliest first — the one to make less of tops the list. */
  waste: WasteLine[];
  wasteCost: Satang;
  /** Gross profit less what was thrown away: what the day really made. */
  afterWaste: Satang;
  breakeven: { cups: number; cupsTarget: number; fixedCost: Satang; past: boolean };
  /** Null while the session is open and the drawer has not been counted. */
  cash: {
    openingFloat: Satang;
    expected: Satang;
    counted: Satang;
    variance: Satang;
  } | null;
}

export interface DaySummaryInput {
  catalog: CostCatalog;
  session: CashSession;
  /** The session's sales only — see salesInSession. */
  sales: readonly Sale[];
  lines: readonly SaleLine[];
  discounts: readonly SaleLineDiscount[];
  waste: readonly WasteEvent[];
  batches: readonly ComponentBatch[];
  fixedCostPerDay: Satang;
  breakevenCups: number;
}

/** The close-of-day report (CLAUDE.md §7 Tier 1). */
export function daySummary(input: DaySummaryInput): DaySummary {
  const { catalog, session } = input;
  const totals = dayTotals(input.sales, input.lines, input.discounts);

  const live = new Set(input.sales.filter((sale) => !sale.is_voided).map((sale) => sale.id));
  const byVariant = new Map<string, number>();
  for (const line of input.lines) {
    if (!live.has(line.sale_id)) continue;
    byVariant.set(line.variant_id, (byVariant.get(line.variant_id) ?? 0) + line.qty);
  }

  const componentOf = new Map(input.batches.map((batch) => [batch.id, batch.component_id]));
  const byComponent = new Map<string, { qty: number; cost: Satang }>();
  for (const event of input.waste) {
    const componentId = componentOf.get(event.component_batch_id);
    if (!componentId) continue;
    const entry = byComponent.get(componentId) ?? { qty: 0, cost: 0 };
    entry.qty += event.qty_discarded;
    entry.cost += event.cost;
    byComponent.set(componentId, entry);
  }

  const waste = [...byComponent].map(([componentId, entry]) => {
    const component = catalog.components.get(componentId);
    return {
      componentId,
      name: component?.name_th ?? componentId,
      unit: component?.unit ?? 'G',
      qty: entry.qty,
      cost: entry.cost,
    } satisfies WasteLine;
  });
  waste.sort((a, b) => b.cost - a.cost);

  const wasteCost = waste.reduce((total, line) => total + line.cost, 0);

  return {
    businessDate: bangkokDate(session.opened_at),
    totals,
    // Most sold first; ties in menu order, so the report reads the same every
    // time it is opened rather than in whatever order the rows were stored.
    unitsByVariant: [...byVariant]
      .map(([variantId, units]) => ({
        variantId,
        name: catalog.variants.get(variantId)?.name_th ?? variantId,
        units,
      }))
      .sort((a, b) => b.units - a.units || menuOrder(catalog, a.variantId, b.variantId)),
    waste,
    wasteCost,
    afterWaste: totals.grossProfit - wasteCost,
    breakeven: {
      cups: totals.units,
      cupsTarget: input.breakevenCups,
      fixedCost: input.fixedCostPerDay,
      past: pastBreakeven(totals, input.fixedCostPerDay, wasteCost),
    },
    cash:
      session.counted_cash !== null && session.expected_cash !== null
        ? {
            openingFloat: session.opening_float,
            expected: session.expected_cash,
            counted: session.counted_cash,
            variance: session.variance ?? session.counted_cash - session.expected_cash,
          }
        : null,
  };
}

function menuOrder(catalog: CostCatalog, a: string, b: string): number {
  const va = catalog.variants.get(a);
  const vb = catalog.variants.get(b);
  const pa = va ? (catalog.products.get(va.product_id)?.sort_order ?? 0) : 0;
  const pb = vb ? (catalog.products.get(vb.product_id)?.sort_order ?? 0) : 0;
  return pa - pb || (va?.sort_order ?? 0) - (vb?.sort_order ?? 0);
}
