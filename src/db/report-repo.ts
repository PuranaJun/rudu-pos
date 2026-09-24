/**
 * Reads for the reports (CLAUDE.md §7, Tier 1 only).
 *
 * Nothing here is stored: every figure is computed from the sales, the
 * ledger and the sessions each time it is asked for, so a report can never
 * drift from the records it summarises.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { CashSession } from './types.ts';
import { salesInSession } from '../domain/close-day.ts';
import {
  annualRevenue,
  closedDays,
  dayTotals,
  type ClosedDay,
  type DayTotals,
} from '../domain/reporting.ts';
import { bangkokDate } from '../lib/datetime.ts';
import type { Satang } from '../lib/money.ts';

/**
 * The open session's numbers, for the sell screen. Scoped to the session, not
 * the calendar date, so the header agrees with the close-day summary and with
 * the drawer — a day closed and reopened starts again from the new float.
 */
export async function loadSessionTotals(
  session: CashSession,
  db: RuduPosDB = defaultDb,
): Promise<DayTotals> {
  const sales = salesInSession(
    await db.sale.where('business_date').equals(bangkokDate(session.opened_at)).toArray(),
    session,
  );
  const saleIds = sales.map((sale) => sale.id);
  const lines = await db.sale_line.where('sale_id').anyOf(saleIds).toArray();
  const discounts = await db.sale_line_discount
    .where('sale_line_id')
    .anyOf(lines.map((line) => line.id))
    .toArray();
  return dayTotals(sales, lines, discounts);
}

/** Takings for a Bangkok calendar year (`YYYY`). */
export async function loadAnnualRevenue(year: string, db: RuduPosDB = defaultDb): Promise<Satang> {
  const sales = await db.sale
    .where('business_date')
    .between(`${year}-01-01`, `${year}-12-31`, true, true)
    .toArray();
  return annualRevenue(sales, year);
}

/** Every closed day, newest first. */
export async function loadClosedDays(db: RuduPosDB = defaultDb): Promise<ClosedDay[]> {
  const [sessions, sales, lines, waste] = await Promise.all([
    db.cash_session.toArray(),
    db.sale.toArray(),
    db.sale_line.toArray(),
    db.waste_event.toArray(),
  ]);
  return closedDays(sessions, sales, lines, waste);
}
