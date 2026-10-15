/**
 * A week's or a month's numbers (CLAUDE.md §7, Tier 2).
 *
 * Pure, and computed from the records every time — the sales, the stock
 * ledger, the waste — never from a total kept somewhere. A voided sale never
 * happened; a loyalty cup counts as a unit and is worth nothing in revenue.
 *
 * The questions it is for: which market day is worth keeping (by day of the
 * week), when to have the tea ready (by hour), whether the 2-cup discount
 * grows the basket, whether 1 in 3 really takes a paid topping, and which
 * component is being thrown away (waste %, against the 10% target).
 */
import type { Satang } from '../lib/money.ts';
import { bangkokDate, bangkokTime, weekdayIndex } from '../lib/datetime.ts';
import type {
  CashSession,
  ComponentBatch,
  OrderType,
  PaymentMethod,
  Sale,
  SaleLine,
  SaleLineDiscount,
  SaleLineMod,
  StockMovement,
  Unit,
  WasteEvent,
} from '../db/types.ts';
import type { CostCatalog } from './cost.ts';
import { dayTotals, type DayTotals } from './reporting.ts';

/** Business dates, `YYYY-MM-DD`, both ends included. */
export interface PeriodRange {
  from: string;
  to: string;
}

export type PeriodPreset = 'LAST_7' | 'LAST_30' | 'THIS_MONTH' | 'LAST_MONTH';

export const PERIOD_PRESET_TH: Record<PeriodPreset, string> = {
  LAST_7: '7 วัน',
  LAST_30: '30 วัน',
  THIS_MONTH: 'เดือนนี้',
  LAST_MONTH: 'เดือนที่แล้ว',
};

/** `today` is a Bangkok business date. */
export function presetRange(preset: PeriodPreset, today: string): PeriodRange {
  switch (preset) {
    case 'LAST_7':
      return { from: addDays(today, -6), to: today };
    case 'LAST_30':
      return { from: addDays(today, -29), to: today };
    case 'THIS_MONTH':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'LAST_MONTH': {
      const firstOfThis = `${today.slice(0, 7)}-01`;
      const lastOfPrev = addDays(firstOfThis, -1);
      return { from: `${lastOfPrev.slice(0, 7)}-01`, to: lastOfPrev };
    }
  }
}

/** Calendar arithmetic on a date string, with no time zone in it to go wrong. */
export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Monday first, the way a market week is planned. */
export const WEEKDAY_TH = [
  'จันทร์',
  'อังคาร',
  'พุธ',
  'พฤหัส',
  'ศุกร์',
  'เสาร์',
  'อาทิตย์',
] as const;

export { weekdayIndex } from '../lib/datetime.ts';

export interface PeriodInput {
  catalog: CostCatalog;
  range: PeriodRange;
  /** Every sale in the range, voided ones included. */
  sales: readonly Sale[];
  lines: readonly SaleLine[];
  mods: readonly SaleLineMod[];
  discounts: readonly SaleLineDiscount[];
  /** Stock movements tied to the lines above. */
  movements: readonly StockMovement[];
  /** Every waste event; the range is applied here. */
  waste: readonly WasteEvent[];
  /**
   * Count corrections — ADJUSTMENT movements from open day and close day,
   * any date; the range is applied here. Optional: a report built without
   * them simply has no count gap.
   */
  adjustments?: readonly StockMovement[];
  batches: readonly ComponentBatch[];
  sessions: readonly CashSession[];
}

export interface PeriodReport {
  range: PeriodRange;
  totals: DayTotals;
  /** Business dates with at least one sale that stood. */
  tradingDays: number;
  revenuePerDay: Satang;
  /** The basket: does the 2-cup discount grow it? */
  cupsPerBill: number;
  revenuePerBill: Satang;
  wasteCost: Satang;
  /** Most cups first. */
  bestSellers: { variantId: string; name: string; units: number; revenue: Satang }[];
  /** Monday to Sunday, every day present, traded or not. */
  byWeekday: { weekday: number; label: string; days: number; revenue: Satang; perDay: Satang }[];
  /** Cups by Bangkok hour, from the first hour sold in to the last. */
  byHour: { hour: number; cups: number }[];
  orderTypes: Record<OrderType, number>;
  payments: Record<PaymentMethod, number>;
  /** Paid toppings: cups that took one, of cups it could have gone on. */
  attach: { modifierId: string; name: string; attached: number; eligible: number }[];
  /** Thrown away, of what left the shelf (sold + thrown away). Worst first. */
  waste: { componentId: string; name: string; unit: Unit; wasted: number; used: number }[];
  /** Counted against what the recipes say is left — see CountGap. Costliest first. */
  countGap: CountGap[];
  /** Every voided bill in the range, oldest first: the owner's void log. */
  voids: VoidEntry[];
  /** Voids per operator, most money first. */
  voidsByOperator: { operator: string; count: number; amount: Satang }[];
}

/**
 * A voided bill, as the owner reads it from home. A void cannot be deleted
 * (CLAUDE.md §10), so the log is complete; a void long after its sale, or
 * one person voiding far more than another, is the question to ask.
 */
export interface VoidEntry {
  saleId: string;
  businessDate: string;
  orderNo: number;
  rungAt: string;
  /** Null for voids from before the time was kept. */
  voidedAt: string | null;
  amount: Satang;
  method: PaymentMethod;
  reason: string;
  operator: string;
}

/**
 * One component's count gap: what open-day and close-day counts found, less
 * what the recipes said should be there. Negative is missing — poured over
 * the recipe, spilt, or a cup made and never rung. Positive is more than
 * expected — poured under the recipe, or a batch bigger than recorded.
 */
export interface CountGap {
  componentId: string;
  name: string;
  unit: Unit;
  /** Sum of the corrections: negative is short. */
  gap: number;
  /** What sales took by the recipe over the same days, to size the gap against. */
  used: number;
  /** The gap at the component's cost today, in satang: a size, not a ledger figure. */
  cost: Satang;
}

export function periodReport(input: PeriodInput): PeriodReport {
  const { catalog, range } = input;
  const inRange = (date: string) => date >= range.from && date <= range.to;

  const sales = input.sales.filter((sale) => inRange(sale.business_date));
  const live = sales.filter((sale) => !sale.is_voided);
  const liveIds = new Set(live.map((sale) => sale.id));
  const saleIds = new Set(sales.map((sale) => sale.id));
  const lines = input.lines.filter((line) => saleIds.has(line.sale_id));
  const liveLines = lines.filter((line) => liveIds.has(line.sale_id));
  const liveLineIds = new Set(liveLines.map((line) => line.id));
  const totals = dayTotals(sales, lines, input.discounts);

  const tradingDates = new Set(live.map((sale) => sale.business_date));
  const tradingDays = tradingDates.size;

  // Best sellers, by variant: hot pear and iced pear are different drinks.
  const byVariant = new Map<string, { units: number; revenue: Satang }>();
  for (const line of liveLines) {
    const entry = byVariant.get(line.variant_id) ?? { units: 0, revenue: 0 };
    entry.units += line.qty;
    entry.revenue += line.unit_price * line.qty - line.line_discount;
    byVariant.set(line.variant_id, entry);
  }

  // By day of the week, averaged over the days actually traded: three
  // Saturdays and one Tuesday are not compared on their totals.
  const weekdays = WEEKDAY_TH.map((label, weekday) => ({
    weekday,
    label,
    dates: new Set<string>(),
    revenue: 0,
  }));
  for (const sale of live) {
    const day = weekdays[weekdayIndex(sale.business_date)]!;
    day.dates.add(sale.business_date);
    day.revenue += sale.total_net;
  }

  // By hour of the clock in Bangkok, in cups: when the tea has to be ready.
  const saleHour = new Map(
    live.map((sale) => [sale.id, Number(bangkokTime(sale.created_at).slice(0, 2))]),
  );
  const cupsByHour = new Map<number, number>();
  for (const line of liveLines) {
    const hour = saleHour.get(line.sale_id)!;
    cupsByHour.set(hour, (cupsByHour.get(hour) ?? 0) + line.qty);
  }
  const hours = [...cupsByHour.keys()];
  const byHour =
    hours.length === 0
      ? []
      : hoursBetween(Math.min(...hours), Math.max(...hours)).map((hour) => ({
          hour,
          cups: cupsByHour.get(hour) ?? 0,
        }));

  const orderTypes: Record<OrderType, number> = { TAKEAWAY: 0, DINE_IN: 0 };
  const payments: Record<PaymentMethod, number> = { CASH: 0, PROMPTPAY: 0 };
  for (const sale of live) {
    orderTypes[sale.order_type] += 1;
    payments[sale.payment_method] += 1;
  }

  // Attach rate: of the cups a paid topping could have gone on, how many took it.
  const attached = new Map<string, number>();
  const lineQty = new Map(liveLines.map((line) => [line.id, line.qty]));
  for (const mod of input.mods) {
    const qty = lineQty.get(mod.sale_line_id);
    if (qty === undefined) continue;
    attached.set(mod.modifier_id, (attached.get(mod.modifier_id) ?? 0) + qty);
  }
  const attach = [...catalog.modifiers.values()]
    .filter((modifier) => modifier.is_paid)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((modifier) => {
      const eligibleVariants = new Set(modifier.applies_to_variant_ids);
      return {
        modifierId: modifier.id,
        name: modifier.name_th,
        attached: attached.get(modifier.id) ?? 0,
        eligible: liveLines
          .filter((line) => eligibleVariants.has(line.variant_id))
          .reduce((total, line) => total + line.qty, 0),
      };
    })
    .filter((entry) => entry.eligible > 0);

  // Waste %: thrown away, of everything that left the shelf in the period.
  const componentOf = new Map(input.batches.map((batch) => [batch.id, batch.component_id]));
  const sessionDate = new Map(input.sessions.map((s) => [s.id, bangkokDate(s.opened_at)]));
  const wasted = new Map<string, number>();
  let wasteCost = 0;
  for (const event of input.waste) {
    const date =
      (event.cash_session_id ? sessionDate.get(event.cash_session_id) : undefined) ??
      bangkokDate(event.recorded_at);
    if (!inRange(date)) continue;
    wasteCost += event.cost;
    const componentId = componentOf.get(event.component_batch_id);
    if (componentId) wasted.set(componentId, (wasted.get(componentId) ?? 0) + event.qty_discarded);
  }
  const used = new Map<string, number>();
  for (const movement of input.movements) {
    if (movement.sale_line_id === null || !liveLineIds.has(movement.sale_line_id)) continue;
    if (movement.reason !== 'SALE' && movement.reason !== 'OVERRIDE') continue;
    const componentId = componentOf.get(movement.component_batch_id);
    if (componentId) used.set(componentId, (used.get(componentId) ?? 0) - movement.qty_delta);
  }
  // Count gap: corrections the counts made, against what sales used.
  // Open day counts at the session's opening, close day at its closing: both
  // fall within the session they belong to.
  const countDate = (at: string): string => {
    const session = input.sessions.find(
      (entry) => entry.opened_at <= at && (entry.closed_at === null || at <= entry.closed_at),
    );
    return session ? bangkokDate(session.opened_at) : bangkokDate(at);
  };
  const gaps = new Map<string, number>();
  for (const movement of input.adjustments ?? []) {
    if (movement.reason !== 'ADJUSTMENT') continue;
    // The trading day the count belonged to, not the clock date: a close
    // counted at 00:30 is still yesterday's close (CLAUDE.md §8).
    if (!inRange(countDate(movement.created_at))) continue;
    const componentId = componentOf.get(movement.component_batch_id);
    if (componentId) gaps.set(componentId, (gaps.get(componentId) ?? 0) + movement.qty_delta);
  }
  const countGap = [...gaps]
    .filter(([, gap]) => gap !== 0)
    .map(([componentId, gap]): CountGap => {
      const component = catalog.components.get(componentId);
      return {
        componentId,
        name: component?.name_th ?? componentId,
        unit: component?.unit ?? 'G',
        gap,
        used: used.get(componentId) ?? 0,
        cost: Math.round(gap * (component?.cost_per_unit ?? 0) * 100),
      };
    })
    .sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost) || Math.abs(b.gap) - Math.abs(a.gap));

  // The void log.
  const voids: VoidEntry[] = input.sales
    .filter((sale) => sale.is_voided && inRange(sale.business_date))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((sale) => ({
      saleId: sale.id,
      businessDate: sale.business_date,
      orderNo: sale.order_no,
      rungAt: sale.created_at,
      voidedAt: sale.voided_at ?? null,
      amount: sale.total_net,
      method: sale.payment_method,
      reason: sale.void_reason ?? '',
      operator: sale.operator_id,
    }));
  const voidsByOperator = new Map<string, { count: number; amount: Satang }>();
  for (const entry of voids) {
    const current = voidsByOperator.get(entry.operator) ?? { count: 0, amount: 0 };
    voidsByOperator.set(entry.operator, {
      count: current.count + 1,
      amount: current.amount + entry.amount,
    });
  }

  const waste = [...new Set([...wasted.keys(), ...used.keys()])]
    .map((componentId) => {
      const component = catalog.components.get(componentId);
      return {
        componentId,
        name: component?.name_th ?? componentId,
        unit: component?.unit ?? ('G' as Unit),
        wasted: wasted.get(componentId) ?? 0,
        used: used.get(componentId) ?? 0,
      };
    })
    .sort((a, b) => wastePct(b) - wastePct(a) || b.wasted - a.wasted);

  return {
    range,
    totals,
    tradingDays,
    revenuePerDay: tradingDays === 0 ? 0 : Math.round(totals.revenue / tradingDays),
    cupsPerBill: totals.saleCount === 0 ? 0 : totals.units / totals.saleCount,
    revenuePerBill: totals.saleCount === 0 ? 0 : Math.round(totals.revenue / totals.saleCount),
    wasteCost,
    bestSellers: [...byVariant]
      .map(([variantId, entry]) => ({
        variantId,
        name: catalog.variants.get(variantId)?.name_th ?? variantId,
        ...entry,
      }))
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue),
    byWeekday: weekdays.map((day) => ({
      weekday: day.weekday,
      label: day.label,
      days: day.dates.size,
      revenue: day.revenue,
      perDay: day.dates.size === 0 ? 0 : Math.round(day.revenue / day.dates.size),
    })),
    byHour,
    orderTypes,
    payments,
    attach,
    waste,
    countGap,
    voids,
    voidsByOperator: [...voidsByOperator]
      .map(([operator, entry]) => ({ operator, ...entry }))
      .sort((a, b) => b.amount - a.amount || b.count - a.count),
  };
}

/** Share thrown away, 0–1. Zero when nothing left the shelf at all. */
export function wastePct(entry: { wasted: number; used: number }): number {
  const out = entry.wasted + entry.used;
  return out === 0 ? 0 : entry.wasted / out;
}

function hoursBetween(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
