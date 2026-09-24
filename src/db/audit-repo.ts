/**
 * Run the books audit against the database, reports included: each closed
 * day's summary, as the app would show it, is checked against the rows.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import { loadDaySummary } from './close-repo.ts';
import { auditBooks, type Finding, type ReportedDay } from '../domain/audit.ts';

export async function auditDatabase(db: RuduPosDB = defaultDb): Promise<Finding[]> {
  const [sales, lines, discounts, batches, movements, waste, sessions] = await Promise.all([
    db.sale.toArray(),
    db.sale_line.toArray(),
    db.sale_line_discount.toArray(),
    db.component_batch.toArray(),
    db.stock_movement.toArray(),
    db.waste_event.toArray(),
    db.cash_session.toArray(),
  ]);

  const reported: ReportedDay[] = [];
  for (const session of sessions) {
    if (session.closed_at === null) continue;
    const summary = await loadDaySummary(session.id, db);
    if (!summary) continue;
    reported.push({
      sessionId: session.id,
      revenue: summary.totals.revenue,
      cogs: summary.totals.cogs,
      units: summary.totals.units,
      wasteCost: summary.wasteCost,
    });
  }

  return auditBooks({ sales, lines, discounts, batches, movements, waste, sessions }, reported);
}
