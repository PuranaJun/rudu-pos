/**
 * The cash session: the trading day, from open to close.
 *
 * A sale belongs to the session it was rung in, and its business date is the
 * session's — not the calendar date at the moment of the sale — so a night
 * market that runs past midnight is still one day in the reports (CLAUDE.md §8).
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { CashSession } from './types.ts';
import type { Satang } from '../lib/money.ts';
import { bangkokDate } from '../lib/datetime.ts';
import { newId, nowIso } from '../lib/id.ts';

/**
 * The session that is open, if any. `closed_at` is null while it is, and
 * IndexedDB leaves nulls out of an index, so this scans — there is one row a
 * day, which is nothing.
 */
export async function loadOpenSession(db: RuduPosDB = defaultDb): Promise<CashSession | null> {
  const open = (await db.cash_session.toArray()).filter((session) => session.closed_at === null);
  open.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  return open[0] ?? null;
}

/** Who opened last time — the sensible default for who is opening now. */
export async function lastOperator(db: RuduPosDB = defaultDb): Promise<string | null> {
  const latest = await db.cash_session.orderBy('opened_at').last();
  return latest?.operator_id ?? null;
}

export function sessionBusinessDate(session: CashSession): string {
  return bangkokDate(session.opened_at);
}

export interface OpenDay {
  operatorId: string;
  openingFloat: Satang;
  /** The operator's call, every morning. Never carried over, never inferred. */
  rainyDay: boolean;
}

/**
 * Open the day. Idempotent: a second tap while the first write is in flight
 * gets the session the first one opened rather than a second drawer.
 */
export async function openSession(
  day: OpenDay,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<CashSession> {
  return db.transaction('rw', [db.cash_session, db.setting], async () => {
    const existing = await loadOpenSession(db);
    if (existing) return existing;

    const session: CashSession = {
      id: newId(),
      opened_at: now,
      closed_at: null,
      operator_id: day.operatorId,
      opening_float: day.openingFloat,
      expected_cash: null,
      counted_cash: null,
      variance: null,
      note: null,
      synced_at: null,
    };

    await db.cash_session.add(session);
    // Written every morning, so yesterday's rain does not quietly carry into
    // a dry day (CLAUDE.md §4: manually toggled, never date-automated).
    await db.setting.put({ key: 'promo_rainy_day_enabled', value: day.rainyDay, synced_at: null });

    return session;
  });
}
