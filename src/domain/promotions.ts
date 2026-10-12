/**
 * Promotions and discounts.
 *
 * Pure. Every amount, every toggle and even which drink the rainy-day price
 * belongs to arrives as a setting or a row — none of it is compiled in
 * (CLAUDE.md §2.1.7, §12).
 *
 * Two rules matter more than the arithmetic:
 *
 * - Promotions apply **automatically**. The operator will forget, and a
 *   forgotten discount is a complaint at the counter (CLAUDE.md §4).
 * - Nothing is ever discounted or zeroed without a reason. Without one,
 *   shrinkage and generosity are indistinguishable in the reports.
 *
 * And the order they apply in, so a cup is never discounted twice by accident:
 *
 * 1. A line given away by the operator goes to zero, and nothing else touches it.
 * 2. Each cup gets the **single best** per-cup offer — the rainy-day price or
 *    one of the owner's ฿/% promotions. They never stack with each other.
 * 3. Buy-X-get-Y frees the cheapest qualifying cups.
 * 4. `PROMO_TWO_CUP` comes off per pair of paid drinks, on top — except for
 *    cups on a promotion that says it does not combine. A free cup never
 *    counts towards a pair.
 */
import type { Satang } from '../lib/money.ts';
import { bangkokDate, bangkokTime, weekdayIndex } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import type { DiscountReason, Promotion } from '../db/types.ts';
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
  /** Present for PROMO_CUSTOM only. */
  promotionId?: string;
  /** Present for PROMO_CUSTOM only: the promotion's name, snapshotted with the sale. */
  label?: string;
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
  /** Every discount in the cart, summed by reason (and promotion), for the day's report. */
  byReason: AppliedDiscount[];
}

/** Working state for one line while the cart is priced. */
interface Working {
  line: PriceableLine;
  priced: PricedLine;
  /** Cups on this line made free by a buy-X-get-Y. */
  freeCups: number;
  /** On a promotion that does not combine with PROMO_TWO_CUP. */
  noTwoCup: boolean;
}

export function applyPromotions(
  catalog: CostCatalog,
  settings: PromotionSettings,
  lines: readonly PriceableLine[],
  now: string = nowIso(),
): PricedCart {
  const work: Working[] = lines.map((line) => ({
    line,
    priced: {
      lineId: line.lineId,
      unitPrice: line.unitPrice,
      qty: line.qty,
      gross: line.unitPrice * line.qty,
      discounts: [],
      net: line.unitPrice * line.qty,
    },
    freeCups: 0,
    noTwoCup: false,
  }));

  const live = (catalog.promotions ?? [])
    .filter((promotion) => promotionLive(promotion, now))
    .sort((a, b) => a.sort_order - b.sort_order);

  for (const entry of work) {
    // A given-away line goes to zero and carries the operator's reason. A
    // loyalty cup still counts as a unit and still deducts its components;
    // it simply never becomes revenue (CLAUDE.md §4).
    if (entry.line.manualReason !== null) {
      charge(entry.priced, { reason: entry.line.manualReason }, entry.priced.net);
      continue;
    }
    applyBestPerCup(catalog, settings, live, entry);
  }

  for (const promotion of live) {
    if (promotion.kind === 'BUY_X_GET_Y') applyBuyXGetY(catalog, promotion, work);
  }

  applyTwoCup(catalog, settings, work);

  const priced = work.map((entry) => entry.priced);
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
 * Whether a promotion is running at this moment. A MANUAL one runs when the
 * operator switched it on this morning; an AUTO one runs on its schedule.
 * Both respect their dates.
 */
export function promotionLive(promotion: Promotion, now: string): boolean {
  if (!promotion.is_active) return false;
  const date = bangkokDate(now);
  if (promotion.starts_on !== null && date < promotion.starts_on) return false;
  if (promotion.ends_on !== null && date > promotion.ends_on) return false;
  if (promotion.activation === 'MANUAL') return promotion.manual_on;
  if (promotion.weekdays.length > 0 && !promotion.weekdays.includes(weekdayIndex(date))) {
    return false;
  }
  if (promotion.hours_from !== null && promotion.hours_to !== null) {
    const time = bangkokTime(now);
    if (time < promotion.hours_from || time >= promotion.hours_to) return false;
  }
  return true;
}

/** On a chosen drink, or — with none chosen — on any drink, never a bottle. */
export function promotionAppliesTo(
  catalog: CostCatalog,
  promotion: Promotion,
  variantId: string,
): boolean {
  if (promotion.variant_ids.length > 0) return promotion.variant_ids.includes(variantId);
  const variant = catalog.variants.get(variantId);
  return catalog.products.get(variant?.product_id ?? '')?.kind === 'DRINK';
}

/** What a ฿ or % promotion takes off one cup at this price. */
export function perCupOff(promotion: Promotion, unitPrice: Satang): Satang {
  if (promotion.kind === 'AMOUNT_OFF') return Math.min(promotion.amount, unitPrice);
  if (promotion.kind === 'PERCENT_OFF') return Math.round((unitPrice * promotion.percent) / 100);
  return 0;
}

function applyBestPerCup(
  catalog: CostCatalog,
  settings: PromotionSettings,
  live: readonly Promotion[],
  entry: Working,
): void {
  const { line } = entry;
  let best: { off: Satang; tag: Tag; promotion: Promotion | null } | null = null;

  if (
    settings.rainyDayEnabled &&
    settings.rainyDayVariantId !== null &&
    line.variantId === settings.rainyDayVariantId
  ) {
    best = { off: settings.rainyDayAmount, tag: { reason: 'PROMO_RAINY_DAY' }, promotion: null };
  }
  for (const promotion of live) {
    if (promotion.kind === 'BUY_X_GET_Y') continue;
    if (!promotionAppliesTo(catalog, promotion, line.variantId)) continue;
    const off = perCupOff(promotion, line.unitPrice);
    // Strictly better: on a tie the earlier one — the rainy day, then the
    // promotions in their order — keeps the cup.
    if (off > (best?.off ?? 0)) best = { off, tag: customTag(promotion), promotion };
  }

  if (!best) return;
  charge(entry.priced, best.tag, best.off * line.qty);
  if (best.promotion && !best.promotion.stacks_with_two_cup) entry.noTwoCup = true;
}

/**
 * For every buy + free cups of the promotion's drinks in the cart, the free
 * ones go for nothing — always the cheapest, so the customer gets exactly what
 * the sign promised and the shop gives away no more than that.
 */
function applyBuyXGetY(catalog: CostCatalog, promotion: Promotion, work: Working[]): void {
  const group = promotion.buy_qty + promotion.free_qty;
  if (promotion.buy_qty <= 0 || promotion.free_qty <= 0) return;

  const pool = work.filter(
    (entry) =>
      entry.line.manualReason === null &&
      paidCups(entry) > 0 &&
      promotionAppliesTo(catalog, promotion, entry.line.variantId),
  );
  const cups = pool.reduce((total, entry) => total + paidCups(entry), 0);
  let free = Math.floor(cups / group) * promotion.free_qty;
  if (free <= 0) return;

  const cheapestFirst = [...pool].sort(
    (a, b) => a.priced.net / paidCups(a) - b.priced.net / paidCups(b),
  );
  for (const entry of cheapestFirst) {
    if (free <= 0) break;
    const paid = paidCups(entry);
    const take = Math.min(free, paid);
    const amount = take === paid ? entry.priced.net : Math.round((entry.priced.net * take) / paid);
    charge(entry.priced, customTag(promotion), amount);
    entry.freeCups += take;
    free -= take;
  }
  if (!promotion.stacks_with_two_cup) for (const entry of pool) entry.noTwoCup = true;
}

function paidCups(entry: Working): number {
  return entry.line.qty - entry.freeCups;
}

/**
 * 10 THB off per pair of qualifying drinks in one transaction.
 *
 * Bottles do not qualify — they are not a cup — and neither do lines the
 * operator has already given away or cups a promotion made free, so a free cup
 * cannot drag a paid one into a pair it did not earn.
 */
function applyTwoCup(catalog: CostCatalog, settings: PromotionSettings, work: Working[]): void {
  if (!settings.twoCupEnabled || settings.twoCupAmount <= 0) return;

  const qualifying: Working[] = [];
  let cups = 0;

  for (const entry of work) {
    if (entry.line.manualReason !== null || entry.noTwoCup) continue;
    const variant = catalog.variants.get(entry.line.variantId);
    const product = variant ? catalog.products.get(variant.product_id) : undefined;
    if (product?.kind !== 'DRINK') continue;
    if (paidCups(entry) <= 0) continue;

    cups += paidCups(entry);
    qualifying.push(entry);
  }

  let remaining = Math.floor(cups / 2) * settings.twoCupAmount;
  if (remaining <= 0) return;

  // Spread it across the qualifying lines, never past what a line is worth,
  // so no line can end up owing the shop money.
  for (const entry of qualifying) {
    if (remaining <= 0) break;
    if (entry.priced.net <= 0) continue;
    const take = Math.min(entry.priced.net, remaining);
    charge(entry.priced, { reason: 'PROMO_TWO_CUP' }, take);
    remaining -= take;
  }
}

type Tag = Pick<AppliedDiscount, 'reason' | 'promotionId' | 'label'>;

function customTag(promotion: Promotion): Tag {
  return { reason: 'PROMO_CUSTOM', promotionId: promotion.id, label: promotion.name_th };
}

function sameTag(a: Tag, b: Tag): boolean {
  return a.reason === b.reason && (a.promotionId ?? null) === (b.promotionId ?? null);
}

function charge(line: PricedLine, tag: Tag, amount: Satang): void {
  if (amount <= 0) return;

  const capped = Math.min(amount, line.net);
  if (capped <= 0) return;

  const existing = line.discounts.find((discount) => sameTag(discount, tag));
  if (existing) existing.amount += capped;
  else line.discounts.push({ ...tag, amount: capped });

  line.net -= capped;
}

function sumByReason(lines: readonly PricedLine[]): AppliedDiscount[] {
  const totals: AppliedDiscount[] = [];
  for (const line of lines) {
    for (const discount of line.discounts) {
      const existing = totals.find((total) => sameTag(total, discount));
      if (existing) existing.amount += discount.amount;
      else totals.push({ ...discount });
    }
  }
  return totals;
}

/**
 * The reasons an operator can pick by hand. Promotions are applied by the app
 * — offering them as manual choices would let a forgotten one look like a
 * deliberate one.
 */
export const MANUAL_DISCOUNT_REASONS: readonly DiscountReason[] = [
  'LOYALTY_REDEEM',
  'STAFF_DRINK',
  'COMP_GOODWILL',
];

export const DISCOUNT_REASON_TH: Record<DiscountReason, string> = {
  PROMO_TWO_CUP: 'ส่วนลด 2 แก้ว',
  PROMO_RAINY_DAY: 'ส่วนลดวันฝนตก',
  PROMO_CUSTOM: 'โปรโมชั่น',
  LOYALTY_REDEEM: 'แลกแสตมป์',
  STAFF_DRINK: 'พนักงาน',
  COMP_GOODWILL: 'อภินันทนาการ',
};

/** What a discount is called on screen: the promotion's own name, or the reason's. */
export function discountLabel(discount: {
  reason: DiscountReason;
  label?: string | null | undefined;
}): string {
  return discount.label ?? DISCOUNT_REASON_TH[discount.reason];
}

const WEEKDAY_SHORT = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

/**
 * "ลด ฿10 · มะขามแดง · อ. 14:00–16:00" — a promotion in one line, for lists.
 * `withWhen: false` leaves off when it runs, for the screen where it is switched on.
 */
export function promotionSummary(
  catalog: CostCatalog,
  promotion: Promotion,
  { withWhen = true }: { withWhen?: boolean } = {},
): string {
  const what =
    promotion.kind === 'AMOUNT_OFF'
      ? `ลด ฿${promotion.amount / 100}`
      : promotion.kind === 'PERCENT_OFF'
        ? `ลด ${promotion.percent}%`
        : `ซื้อ ${promotion.buy_qty} แถม ${promotion.free_qty}`;
  const on =
    promotion.variant_ids.length === 0
      ? 'ทุกเมนู'
      : promotion.variant_ids.map((id) => catalog.variants.get(id)?.name_th ?? id).join(', ');
  const when =
    promotion.activation === 'MANUAL'
      ? 'เปิดเองตอนเปิดร้าน'
      : [
          promotion.weekdays.length > 0 && promotion.weekdays.length < 7
            ? [...promotion.weekdays]
                .sort()
                .map((day) => WEEKDAY_SHORT[day])
                .join(' ')
            : null,
          promotion.hours_from && promotion.hours_to
            ? `${promotion.hours_from}–${promotion.hours_to}`
            : null,
        ]
          .filter(Boolean)
          .join(' ') || 'ทุกวัน';
  return (withWhen ? [what, on, when] : [what, on]).join(' · ');
}
