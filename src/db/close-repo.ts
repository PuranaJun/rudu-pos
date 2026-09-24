/**
 * Closing the day, and reading a closed day back.
 *
 * The close is one transaction: every count, every discard, every waste event
 * and the drawer count land together. A phone that dies halfway leaves the
 * day open and the stock untouched, to be closed again — never half closed.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { loadSettings } from './settings-repo.ts';
import { loadStockSnapshot } from './stock-repo.ts';
import type { CashSession, Sale } from './types.ts';
import type { CostCatalog } from '../domain/cost.ts';
import {
  expectedCash,
  planCloseStock,
  salesInSession,
  type CloseDecision,
} from '../domain/close-day.ts';
import { daySummary, type DaySummary } from '../domain/reporting.ts';
import { bangkokDate } from '../lib/datetime.ts';
import type { Satang } from '../lib/money.ts';
import { nowIso } from '../lib/id.ts';

async function sessionSales(session: CashSession, db: RuduPosDB): Promise<Sale[]> {
  const sales = await db.sale
    .where('business_date')
    .equals(bangkokDate(session.opened_at))
    .toArray();
  return salesInSession(sales, session);
}

/** What should be in the drawer right now. */
export async function loadExpectedCash(
  session: CashSession,
  db: RuduPosDB = defaultDb,
): Promise<Satang> {
  return expectedCash(session, await sessionSales(session, db));
}

export interface CloseDay {
  sessionId: string;
  decisions: readonly CloseDecision[];
  countedCash: Satang;
  note: string | null;
}

/**
 * Close the session. The variance is recorded whatever it is — a drawer that
 * is 200 baht short is exactly the day the record matters most, so nothing
 * here refuses on it (BUILD-PROMPTS step 9).
 */
export async function closeDay(
  close: CloseDay,
  catalog: CostCatalog,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<CashSession> {
  return db.transaction(
    'rw',
    [db.cash_session, db.sale, db.component_batch, db.stock_movement, db.waste_event],
    async () => {
      const session = await db.cash_session.get(close.sessionId);
      if (!session) throw new Error(`session ${close.sessionId} not found`);
      if (session.closed_at !== null)
        throw new Error(`session ${close.sessionId} is already closed`);

      const snapshot = await loadStockSnapshot(db, now);
      const plan = planCloseStock(catalog, snapshot, close.decisions, session.id, now);

      await db.stock_movement.bulkAdd(plan.movements);
      await db.waste_event.bulkAdd(plan.wasteEvents);
      for (const batchId of plan.discardedBatchIds) {
        await db.component_batch.update(batchId, { state: 'DISCARDED' });
      }

      const expected = expectedCash(session, await sessionSales(session, db));
      const closed: CashSession = {
        ...session,
        closed_at: now,
        expected_cash: expected,
        counted_cash: close.countedCash,
        variance: close.countedCash - expected,
        note: close.note,
      };
      await db.cash_session.put(closed);

      return closed;
    },
  );
}

/** A day's report, by its session. Works for the day just closed and any before it. */
export async function loadDaySummary(
  sessionId: string,
  db: RuduPosDB = defaultDb,
): Promise<DaySummary | null> {
  const session = await db.cash_session.get(sessionId);
  if (!session) return null;

  const [catalog, settings, sales, waste] = await Promise.all([
    loadCostCatalog(db),
    loadSettings(db),
    sessionSales(session, db),
    db.waste_event.where('cash_session_id').equals(sessionId).toArray(),
  ]);

  const saleIds = new Set(sales.map((sale) => sale.id));
  const lines = (await db.sale_line.toArray()).filter((line) => saleIds.has(line.sale_id));
  const lineIds = new Set(lines.map((line) => line.id));
  const discounts = (await db.sale_line_discount.toArray()).filter((discount) =>
    lineIds.has(discount.sale_line_id),
  );
  const batches = await db.component_batch
    .where('id')
    .anyOf(waste.map((event) => event.component_batch_id))
    .toArray();

  return daySummary({
    catalog,
    session,
    sales,
    lines,
    discounts,
    waste,
    batches,
    fixedCostPerDay: settings.fixedCostPerDay,
    breakevenCups: settings.breakevenCups,
  });
}
