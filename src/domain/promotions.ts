/**
 * Promotions and discounts.
 *
 * Pure. Every amount, every toggle and even which drink the rainy-day price
 * belongs to arrives as a setting — none of it is compiled in (CLAUDE.md
 * §2.1.7, §12).
 *
 * Two rules matter more than the arithmetic:
 *
 * - `PROMO_TWO_CUP` applies **automatically**. The operator will forget, and a
 *   forgotten discount is a complaint at the counter (CLAUDE.md §4).
 * - Nothing is ever discounted or zeroed without a reason. Without one,
 *   shrinkage and generosity are indistinguishable in the reports.
 */
import type { Satang } from '../lib/money.ts';
import type { DiscountReason } from '../db/types.ts';
import type { CostCatalog } from './cost.ts';

export interface PromotionSettings {
  twoCupEnabled: boolean;
  /** Off one pair, not one cup. */
  twoCupAmount: Satang;
  /** Manually toggled by the operator. Never date-automated (CLAUDE.md §4). */
  rainyDayEnabled: boolean;
  rainyDayAmount: Satang;
  rainyDayVariantId: string | null;
}

export interface PriceableLine {
  lineId: string;
  variantId: string;
  qty: number;
  /** The snapshot price for one cup, modifiers included. */
  unitPrice: Satang;
  /** Set by the operator to give the line away. Requires a reason by type. */
  manualReason: DiscountReason | null;
}

export interface AppliedDiscount {
  reason: DiscountReason;
  /** For the whole line, not per cup. */
  amount: Satang;
}

export interface PricedLine {
  lineId: string;
  unitPrice: Satang;
  qty: number;
  gross: Satang;
  discounts: AppliedDiscount[];
  net: Satang;
}

export interface PricedCart {
  lines: PricedLine[];
  totalGross: Satang;
  totalDiscount: Satang;
  /** What the customer pays, and the only figure that counts as revenue. */
  totalNet: Satang;
  /** Every discount in the cart, summed by reason, for the day's report. */
  byReason: AppliedDiscount[];
}

export function applyPromotions(
  catalog: CostCatalog,
  settings: PromotionSettings,
  lines: readonly PriceableLine[],
): PricedCart {
  const priced: PricedLine[] = lines.map((line) => ({
    lineId: line.lineId,
    unitPrice: line.unitPrice,
    qty: line.qty,
    gross: line.unitPrice * line.qty,
    discounts: [],
    net: line.unitPrice * line.qty,
  }));

  lines.forEach((line, index) => {
    const target = priced[index];
    if (!target) return;

    // A given-away line goes to zero and carries the operator's reason. A
    // loyalty cup still counts as a unit and still deducts its components;
    // it simply never becomes revenue (CLAUDE.md §4).
    if (line.manualReason !== null) {
      charge(target, line.manualReason, target.net);
      return;
    }

    if (
      settings.rainyDayEnabled &&
      settings.rainyDayVariantId !== null &&
      line.variantId === settings.rainyDayVariantId
    ) {
      charge(target, 'PROMO_RAINY_DAY', settings.rainyDayAmount * line.qty);
    }
  });

  applyTwoCup(catalog, settings, lines, priced);

  const totalGross = priced.reduce((total, line) => total + line.gross, 0);
  const totalNet = priced.reduce((total, line) => total + line.net, 0);

  return {
    lines: priced,
    totalGross,
    totalDiscount: totalGross - totalNet,
    totalNet,
    byReason: sumByReason(priced),
  };
}

/**
 * 10 THB off per pair of qualifying drinks in one transaction.
 *
 * Bottles do not qualify — they are not a cup — and neither do lines the
 * operator has already given away, so a loyalty cup cannot drag a paid one
 * into a pair it did not earn.
 */
function applyTwoCup(
  catalog: CostCatalog,
  settings: PromotionSettings,
  lines: readonly PriceableLine[],
  priced: PricedLine[],
): void {
  if (!settings.twoCupEnabled || settings.twoCupAmount <= 0) return;

  const qualifying: number[] = [];
  let cups = 0;

  lines.forEach((line, index) => {
    if (line.manualReason !== null) return;

    const variant = catalog.variants.get(line.variantId);
    const product = variant ? catalog.products.get(variant.product_id) : undefined;
    if (product?.kind !== 'DRINK') return;

    cups += line.qty;
    qualifying.push(index);
  });

  let remaining = Math.floor(cups / 2) * settings.twoCupAmount;
  if (remaining <= 0) return;

  // Spread it across the qualifying lines, never past what a line is worth,
  // so no line can end up owing the shop money.
  for (const index of qualifying) {
    if (remaining <= 0) break;
    const line = priced[index];
    if (!line || line.net <= 0) continue;

    const take = Math.min(line.net, remaining);
    charge(line, 'PROMO_TWO_CUP', take);
    remaining -= take;
  }
}

function charge(line: PricedLine, reason: DiscountReason, amount: Satang): void {
  if (amount <= 0) return;

  const capped = Math.min(amount, line.net);
  if (capped <= 0) return;

  const existing = line.discounts.find((discount) => discount.reason === reason);
  if (existing) existing.amount += capped;
  else line.discounts.push({ reason, amount: capped });

  line.net -= capped;
}

function sumByReason(lines: readonly PricedLine[]): AppliedDiscount[] {
  const totals = new Map<DiscountReason, number>();
  for (const line of lines) {
    for (const discount of line.discounts) {
      totals.set(discount.reason, (totals.get(discount.reason) ?? 0) + discount.amount);
    }
  }
  return [...totals].map(([reason, amount]) => ({ reason, amount }));
}

/**
 * The reasons an operator can pick by hand. The two promotions are applied by
 * the app — offering them as manual choices would let a forgotten one look
 * like a deliberate one.
 */
export const MANUAL_DISCOUNT_REASONS: readonly DiscountReason[] = [
  'LOYALTY_REDEEM',
  'STAFF_DRINK',
  'COMP_GOODWILL',
];

export const DISCOUNT_REASON_TH: Record<DiscountReason, string> = {
  PROMO_TWO_CUP: 'ส่วนลด 2 แก้ว',
  PROMO_RAINY_DAY: 'ส่วนลดวันฝนตก',
  LOYALTY_REDEEM: 'แลกแสตมป์',
  STAFF_DRINK: 'พนักงาน',
  COMP_GOODWILL: 'อภินันทนาการ',
};
