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
