/**
 * The dry run: a generated week through the real code, then every Tier 1
 * report checked for anything impossible. And the checker checked — a clean
 * audit means nothing unless a dirty one is caught.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { ensureSeeded } from './seed.ts';
import { ensureDeviceId } from './device.ts';
import { generateSampleWeek } from './sample-week.ts';
import { auditDatabase } from './audit-repo.ts';
import { loadClosedDays } from './report-repo.ts';
import { loadDaySummary } from './close-repo.ts';
import { loadStockSnapshot } from './stock-repo.ts';
import { batchRemaining } from '../domain/stock.ts';
import { auditBooks } from '../domain/audit.ts';

let db: RuduPosDB;
const dbName = `rudu-week-${crypto.randomUUID()}`;
const TODAY = '2026-09-25T05:00:00.000Z';

beforeAll(async () => {
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  await ensureDeviceId(db);
  await generateSampleWeek(db, TODAY, 42);
}, 60_000);

afterAll(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

describe('a generated week', () => {
  it('is five market days of 25–45 sales, closed', async () => {
    const days = await loadClosedDays(db);
    expect(days).toHaveLength(5);
    for (const day of days) {
      const sales = await db.sale.where('business_date').equals(day.businessDate).count();
      expect(sales).toBeGreaterThanOrEqual(25);
      expect(sales).toBeLessThanOrEqual(45);
    }
    expect(await db.cash_session.filter((session) => session.closed_at === null).count()).toBe(0);
  });

  it('has one void, one loyalty cup, toppings, both payments, and waste at every close', async () => {
    expect(await db.sale.filter((sale) => sale.is_voided).count()).toBe(1);
    expect(await db.sale_line_discount.where('reason').equals('LOYALTY_REDEEM').count()).toBe(1);
    expect(await db.sale_line_mod.count()).toBeGreaterThan(20);
    expect(
      await db.sale.filter((sale) => sale.payment_method === 'PROMPTPAY').count(),
    ).toBeGreaterThan(0);
    expect(
      await db.sale_line_discount.where('reason').equals('PROMO_RAINY_DAY').count(),
    ).toBeGreaterThan(0);

    for (const day of await loadClosedDays(db)) {
      expect(day.wasteCost).toBeGreaterThan(0);
    }
  });

  it('sells at the busy hours: most sales between 17:00 and 20:00 Bangkok', async () => {
    const hours = (await db.sale.toArray()).map(
      (sale) => (new Date(sale.created_at).getUTCHours() + 7) % 24,
    );
    const evening = hours.filter((hour) => hour >= 17 && hour < 20).length;
    expect(evening / hours.length).toBeGreaterThan(0.5);
    expect(hours.every((hour) => hour >= 16 && hour < 21)).toBe(true);
  });

  it('CHECK: every report is possible — no finding from the audit', async () => {
    expect(await auditDatabase(db)).toEqual([]);
  });

  it('CHECK: loyalty cups are in COGS and not in revenue', async () => {
    const [loyalty] = await db.sale_line_discount
      .where('reason')
      .equals('LOYALTY_REDEEM')
      .toArray();
    const line = (await db.sale_line.get(loyalty!.sale_line_id))!;
    const sale = (await db.sale.get(line.sale_id))!;
    const session = (await db.cash_session.toArray()).find(
      (entry) =>
        entry.opened_at.slice(0, 10) <= sale.business_date &&
        entry.closed_at! >= sale.created_at &&
        entry.opened_at <= sale.created_at,
    )!;
    const summary = (await loadDaySummary(session.id, db))!;

    expect(line.unit_price * line.qty - loyalty!.amount).toBe(0);
    expect(line.unit_cost).toBeGreaterThan(0);
    // The sale it sits in counts its cost, and its revenue is the rest.
    expect(sale.total_cost).toBeGreaterThanOrEqual(line.unit_cost);
    expect(summary.totals.cogs).toBeGreaterThan(0);
  });

  it('CHECK: nothing ends the week below zero', async () => {
    const snapshot = await loadStockSnapshot(db, TODAY);
    for (const batch of snapshot.batches) {
      expect(
        batchRemaining(batch.id, snapshot.movements),
        batch.component_id,
      ).toBeGreaterThanOrEqual(0);
    }
  });

  it('is the same week for the same seed', async () => {
    const other = new RuduPosDB(`rudu-week-${crypto.randomUUID()}`);
    await other.open();
    await ensureSeeded(other);
    const again = await generateSampleWeek(other, TODAY, 42);
    expect(again.sales).toBe(await db.sale.count());
    other.close();
    await RuduPosDB.delete(other.name);
  }, 60_000);
});

describe('the audit catches what it is there to catch', () => {
  it('flags a loyalty cup counted as revenue, a double waste, a drawer that does not add up and negative stock', async () => {
    const tampered = new RuduPosDB(`rudu-tampered-${crypto.randomUUID()}`);
    await tampered.open();
    await ensureSeeded(tampered);
    await generateSampleWeek(tampered, TODAY, 7);

    // Revenue including a loyalty drink.
    const [loyalty] = await tampered.sale_line_discount
      .where('reason')
      .equals('LOYALTY_REDEEM')
      .toArray();
    await tampered.sale_line_discount.update(loyalty!.id, { amount: 0 });
    // Waste double-counted.
    const [waste] = await tampered.waste_event.toArray();
    await tampered.waste_event.add({ ...waste!, id: 'DUPLICATE' });
    // A drawer that does not reconcile.
    const [day] = await tampered.cash_session.toArray();
    await tampered.cash_session.update(day!.id, { variance: 12_345 });
    // Negative stock.
    const [batch] = await tampered.component_batch.toArray();
    await tampered.stock_movement.add({
      id: 'OVERDRAWN',
      sale_line_id: null,
      component_batch_id: batch!.id,
      qty_delta: -1_000_000,
      reason: 'ADJUSTMENT',
      reverses_movement_id: null,
      created_at: TODAY,
      synced_at: null,
    });

    const checks = new Set((await auditDatabase(tampered)).map((finding) => finding.check));
    expect(checks).toEqual(
      new Set([
        'SALE_ARITHMETIC',
        'LOYALTY_IN_REVENUE',
        'WASTE_DOUBLE_COUNTED',
        'CASH_DOES_NOT_RECONCILE',
        'NEGATIVE_STOCK',
      ]),
    );

    tampered.close();
    await RuduPosDB.delete(tampered.name);
  }, 60_000);

  it('flags a report that disagrees with the rows it summarises', async () => {
    const books = {
      sales: await db.sale.toArray(),
      lines: await db.sale_line.toArray(),
      discounts: await db.sale_line_discount.toArray(),
      batches: await db.component_batch.toArray(),
      movements: await db.stock_movement.toArray(),
      waste: await db.waste_event.toArray(),
      sessions: await db.cash_session.toArray(),
    };
    const [day] = await loadClosedDays(db);
    const summary = (await loadDaySummary(day!.sessionId, db))!;
    const honest = {
      sessionId: day!.sessionId,
      revenue: summary.totals.revenue,
      cogs: summary.totals.cogs,
      units: summary.totals.units,
      wasteCost: summary.wasteCost,
    };

    expect(auditBooks(books, [honest])).toEqual([]);
    // A report that, say, counted the voided sale.
    expect(auditBooks(books, [{ ...honest, revenue: honest.revenue + 4_000 }])).toEqual([
      expect.objectContaining({ check: 'REPORT_DISAGREES' }),
    ]);
  });
});
