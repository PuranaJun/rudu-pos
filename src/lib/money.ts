/**
 * Money. Every persisted amount in this app is an integer number of satang
 * (1 THB = 100 satang). Floats never touch the database — see CLAUDE.md §3.
 */

/** An integer number of satang. Nominal type alias, for readability only. */
export type Satang = number;

/** Baht → satang. Rounds, because 1.18 * 100 is 117.99999999999999 in IEEE 754. */
export function toSatang(baht: number): Satang {
  return Math.round(baht * 100);
}

/** Satang → baht as a float. For display and arithmetic against unit costs only. */
export function toBaht(satang: Satang): number {
  return satang / 100;
}

/**
 * Prices display as whole baht — `฿40`, never `฿40.00` (CLAUDE.md §3).
 * Amounts that are not a whole number of baht (costs, COGS) keep two decimals,
 * because rounding them away would make a cost report silently wrong.
 */
export function formatTHB(satang: Satang): string {
  const negative = satang < 0;
  const abs = Math.abs(Math.round(satang));
  const baht = Math.trunc(abs / 100);
  const remainder = abs % 100;

  const digits = baht.toLocaleString('th-TH');
  const body = remainder === 0 ? digits : `${digits}.${String(remainder).padStart(2, '0')}`;

  return `${negative ? '-' : ''}฿${body}`;
}

/**
 * Baht as typed into a settings field — `40`, `1.18`, `1,500` — to satang.
 * Null for anything that is not a sensible amount, so a stray letter is
 * refused rather than saved as ฿0.
 */
export function parseBaht(text: string): Satang | null {
  const cleaned = text.replace(/[,\s฿]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return toSatang(Number(cleaned));
}

/** Satang as it goes back into a field: `40`, `1.18`. No symbol, no separators. */
export function bahtInput(satang: Satang): string {
  return satang % 100 === 0 ? String(satang / 100) : (satang / 100).toFixed(2);
}
