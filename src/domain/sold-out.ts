/**
 * หมดวันนี้ — a drink the operator has taken off for the rest of the day.
 *
 * For what stock cannot see: a garnish or a fruit that is not counted ran
 * out. Stock-tracked components already make their drinks sold out by
 * themselves (CLAUDE.md §2.2). Like any sold-out drink it is greyed out and
 * can still be sold through the override, which is recorded (§2.1.6).
 *
 * Marked by business date, never by a clock: it ends with the day, with no
 * timer and nothing to reset (§1).
 */
export function soldOutToday(
  product: { sold_out_on?: string | null },
  businessDate: string,
): boolean {
  return product.sold_out_on === businessDate;
}
