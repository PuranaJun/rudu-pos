/**
 * The books, checked for anything impossible.
 *
 * Pure. Every check re-derives a figure the long way, from the rows, and
 * compares it with what was recorded or reported — so it catches a report
 * that disagrees with its own records, not only records that disagree with
 * each other. An empty list is a clean set of books.
 */
import type {
  CashSession,
  ComponentBatch,
  Sale,
  SaleLine,
  SaleLineDiscount,
  StockMovement,
  WasteEvent,
} from '../db/types.ts';
import { expectedCash, salesInSession } from './close-day.ts';
import { batchRemaining } from './stock.ts';

export type Check =
  | 'NEGATIVE_STOCK'
  | 'SALE_ARITHMETIC'
  | 'LOYALTY_IN_REVENUE'
  | 'COGS_MISSING_LINES'
  | 'VOID_NOT_REVERSED'
  | 'WASTE_DOUBLE_COUNTED'
  | 'CASH_DOES_NOT_RECONCILE'
  | 'REPORT_DISAGREES';

export interface Finding {
  check: Check;
  detail: string;
}

export interface Books {
  sales: readonly Sale[];
  lines: readonly SaleLine[];
  discounts: readonly SaleLineDiscount[];
  batches: readonly ComponentBatch[];
  movements: readonly StockMovement[];
  waste: readonly WasteEvent[];
  sessions: readonly CashSession[];
}

/** What a report said about one closed day, to check against the rows. */
export interface ReportedDay {
  sessionId: string;
  revenue: number;
  cogs: number;
  units: number;
  wasteCost: number;
}

export function auditBooks(books: Books, reported: readonly ReportedDay[] = []): Finding[] {
  return [
    ...negativeStock(books),
    ...saleArithmetic(books),
    ...voids(books),
    ...wasteCounted(books),
    ...cash(books),
    ...reports(books, reported),
  ];
}

function negativeStock({ batches, movements }: Books): Finding[] {
  return batches
    .map((batch) => ({ batch, remaining: batchRemaining(batch.id, movements) }))
    .filter(({ remaining }) => remaining < -1e-9)
    .map(({ batch, remaining }) => ({
      check: 'NEGATIVE_STOCK' as const,
      detail: `${batch.component_id} batch ${batch.id} is at ${remaining}`,
    }));
}

/**
 * Every sale adds up; a loyalty cup is worth nothing in revenue and still
 * costs what it cost; COGS is every line, free ones included (CLAUDE.md §4).
 */
function saleArithmetic({ sales, lines, discounts }: Books): Finding[] {
  const findings: Finding[] = [];
  const discountsByLine = group(discounts, (discount) => discount.sale_line_id);
  const linesBySale = group(lines, (line) => line.sale_id);

  for (const sale of sales) {
    const saleLines = linesBySale.get(sale.id) ?? [];
    const gross = sum(saleLines, (line) => line.unit_price * line.qty);
    const discount = sum(saleLines, (line) =>
      sum(discountsByLine.get(line.id) ?? [], (applied) => applied.amount),
    );
    const cost = sum(saleLines, (line) => line.unit_cost * line.qty);

    if (gross !== sale.total_gross || discount !== sale.total_discount) {
      findings.push({
        check: 'SALE_ARITHMETIC',
        detail: `sale ${sale.id}: lines say ${gross} − ${discount}, sale says ${sale.total_gross} − ${sale.total_discount}`,
      });
    }
    if (sale.total_gross - sale.total_discount !== sale.total_net || sale.total_net < 0) {
      findings.push({ check: 'SALE_ARITHMETIC', detail: `sale ${sale.id}: net ${sale.total_net}` });
    }
    if (cost !== sale.total_cost) {
      findings.push({
        check: 'COGS_MISSING_LINES',
        detail: `sale ${sale.id}: lines cost ${cost}, sale records ${sale.total_cost}`,
      });
    }

    for (const line of saleLines) {
      const applied = discountsByLine.get(line.id) ?? [];
      if (!applied.some((entry) => entry.reason === 'LOYALTY_REDEEM')) continue;
      const net = line.unit_price * line.qty - sum(applied, (entry) => entry.amount);
      if (net !== 0) {
        findings.push({
          check: 'LOYALTY_IN_REVENUE',
          detail: `loyalty line ${line.id} brings in ${net}`,
        });
      }
      if (!(line.unit_cost > 0)) {
        findings.push({
          check: 'COGS_MISSING_LINES',
          detail: `loyalty line ${line.id} carries no cost`,
        });
      }
    }
  }
  return findings;
}

/** A voided sale's stock movements net to nothing, batch by batch. */
function voids({ sales, lines, movements }: Books): Finding[] {
  const findings: Finding[] = [];
  const voided = new Set(sales.filter((sale) => sale.is_voided).map((sale) => sale.id));
  const lineIds = new Set(lines.filter((line) => voided.has(line.sale_id)).map((line) => line.id));

  const net = new Map<string, number>();
  for (const movement of movements) {
    if (movement.sale_line_id === null || !lineIds.has(movement.sale_line_id)) continue;
    const key = `${movement.sale_line_id}:${movement.component_batch_id}`;
    net.set(key, (net.get(key) ?? 0) + movement.qty_delta);
  }
  for (const [key, left] of net) {
    if (Math.abs(left) > 1e-9) {
      findings.push({ check: 'VOID_NOT_REVERSED', detail: `${key} is off by ${left}` });
    }
  }
  return findings;
}

/**
 * Each thing thrown away is counted once: the waste events for a batch match
 * its WASTE ledger rows, and nothing is thrown out of a batch twice.
 */
function wasteCounted({ waste, movements }: Books): Finding[] {
  const findings: Finding[] = [];
  const events = group(waste, (event) => event.component_batch_id);
  const ledger = group(
    movements.filter((movement) => movement.reason === 'WASTE'),
    (movement) => movement.component_batch_id,
  );

  for (const batchId of new Set([...events.keys(), ...ledger.keys()])) {
    const recorded = sum(events.get(batchId) ?? [], (event) => event.qty_discarded);
    const moved = -sum(ledger.get(batchId) ?? [], (movement) => movement.qty_delta);
    if (Math.abs(recorded - moved) > 1e-9) {
      findings.push({
        check: 'WASTE_DOUBLE_COUNTED',
        detail: `batch ${batchId}: waste events ${recorded}, ledger ${moved}`,
      });
    }
    if ((events.get(batchId)?.length ?? 0) > 1) {
      findings.push({
        check: 'WASTE_DOUBLE_COUNTED',
        detail: `batch ${batchId} was thrown out ${events.get(batchId)!.length} times`,
      });
    }
  }
  return findings;
}

/**
 * Each closed day's drawer: expected is float plus cash sales, variance is
 * counted less expected, and every cash sale's change is what was handed
 * over less what it cost.
 */
function cash({ sales, sessions }: Books): Finding[] {
  const findings: Finding[] = [];

  for (const sale of sales) {
    if (sale.payment_method !== 'CASH') continue;
    if (
      sale.cash_received === null ||
      sale.cash_change === null ||
      sale.cash_change < 0 ||
      sale.cash_received - sale.cash_change !== sale.total_net
    ) {
      findings.push({
        check: 'CASH_DOES_NOT_RECONCILE',
        detail: `sale ${sale.id}: received ${sale.cash_received}, change ${sale.cash_change}, net ${sale.total_net}`,
      });
    }
  }

  for (const session of sessions) {
    if (session.closed_at === null) continue;
    const expected = expectedCash(session, sales);
    if (session.expected_cash !== expected) {
      findings.push({
        check: 'CASH_DOES_NOT_RECONCILE',
        detail: `day ${session.id}: recorded expected ${session.expected_cash}, the sales say ${expected}`,
      });
    }
    if (
      session.counted_cash === null ||
      session.variance !== session.counted_cash - (session.expected_cash ?? 0)
    ) {
      findings.push({
        check: 'CASH_DOES_NOT_RECONCILE',
        detail: `day ${session.id}: variance ${session.variance} is not counted less expected`,
      });
    }
  }
  return findings;
}

/** What the reports said about each day, against the rows the long way. */
function reports(books: Books, reported: readonly ReportedDay[]): Finding[] {
  const findings: Finding[] = [];
  const linesBySale = group(books.lines, (line) => line.sale_id);
  const wasteBySession = group(books.waste, (event) => event.cash_session_id ?? '');

  for (const day of reported) {
    const session = books.sessions.find((entry) => entry.id === day.sessionId);
    if (!session) continue;
    const live = salesInSession(books.sales, session).filter((sale) => !sale.is_voided);
    const expected = {
      revenue: sum(live, (sale) => sale.total_net),
      cogs: sum(live, (sale) => sale.total_cost),
      units: sum(live, (sale) => sum(linesBySale.get(sale.id) ?? [], (line) => line.qty)),
      wasteCost: sum(wasteBySession.get(session.id) ?? [], (event) => event.cost),
    };
    for (const key of ['revenue', 'cogs', 'units', 'wasteCost'] as const) {
      if (day[key] !== expected[key]) {
        findings.push({
          check: 'REPORT_DISAGREES',
          detail: `day ${session.id}: report says ${key} ${day[key]}, the rows say ${expected[key]}`,
        });
      }
    }
  }
  return findings;
}

function group<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = groups.get(k);
    if (list) list.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function sum<T>(rows: readonly T[], value: (row: T) => number): number {
  return rows.reduce((total, row) => total + value(row), 0);
}
