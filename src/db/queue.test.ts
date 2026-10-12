/**
 * Order numbers, order type and the queue, against a real database.
 *
 * The numbers are assigned inside the sale's own transaction; the queue is a
 * single field that no figure depends on, and close day clears it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart, setOrderType } from './cart-repo.ts';
import { completeSale, priceCart, type PaymentDetails } from './sale-repo.ts';
import { openSession } from './session-repo.ts';
import { closeDay, loadDaySummary } from './close-repo.ts';
import { voidSale } from './stock-repo.ts';
import { loadQueue, markAllHandedOver, markHandedOver, markWaiting } from './queue-repo.ts';
import { exportBackup, restoreBackup } from './backup.ts';
import type { CostCatalog } from '../domain/cost.ts';
import type { CashSession } from './types.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;
let session: CashSession;

const OPEN = '2026-10-12T01:00:00.000Z';
const DATE = '2026-10-12';

beforeEach(async () => {
  dbName = `rudu-queue-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
  session = await openSession(
    { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
    db,
    OPEN,
  );
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

/** One iced tamarind, paid in cash, the way the screen rings it. */
async function ring(
  at: string,
  details: Partial<PaymentDetails> = {},
): Promise<{ saleId: string; orderNo: number }> {
  await addDrink('VAR_TAMARIND_ICED', {}, db);
  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart);
  const { saleId, receipt } = await completeSale(
    catalog,
    cart,
    priced,
    {
      method: 'CASH',
      cashReceived: priced.totalNet,
      operatorId: 'เจ้าของ',
      deviceId: 'phone',
      brandingLineTh: '',
      businessDate: DATE,
      ...details,
    },
    db,
    at,
  );
  return { saleId, orderNo: receipt.orderNo };
}

describe('order numbers', () => {
  it('count up from 1 through the day and start again the next', async () => {
    expect((await ring('2026-10-12T02:00:00.000Z')).orderNo).toBe(1);
    expect((await ring('2026-10-12T02:01:00.000Z')).orderNo).toBe(2);
    expect((await ring('2026-10-13T02:00:00.000Z', { businessDate: '2026-10-13' })).orderNo).toBe(
      1,
    );
  });

  it('are never reused after a void', async () => {
    await ring('2026-10-12T02:00:00.000Z');
    const second = await ring('2026-10-12T02:01:00.000Z');
    await voidSale(second.saleId, 'ลูกค้าเปลี่ยนใจ', db);
    expect((await ring('2026-10-12T02:02:00.000Z')).orderNo).toBe(3);
  });
});

describe('order type', () => {
  it('is takeaway until changed, then stays changed for the next sale', async () => {
    const first = await ring('2026-10-12T02:00:00.000Z');
    await setOrderType('DINE_IN', db);
    const second = await ring('2026-10-12T02:01:00.000Z');
    const third = await ring('2026-10-12T02:02:00.000Z');

    expect((await db.sale.get(first.saleId))?.order_type).toBe('TAKEAWAY');
    expect((await db.sale.get(second.saleId))?.order_type).toBe('DINE_IN');
    expect((await db.sale.get(third.saleId))?.order_type).toBe('DINE_IN');
  });

  it('is counted in the day summary, voids left out', async () => {
    await ring('2026-10-12T02:00:00.000Z');
    await setOrderType('DINE_IN', db);
    await ring('2026-10-12T02:01:00.000Z');
    const voided = await ring('2026-10-12T02:02:00.000Z');
    await voidSale(voided.saleId, 'กดผิด', db);

    const summary = await loadDaySummary(session.id, db);
    expect(summary?.ordersByType).toEqual({ TAKEAWAY: 1, DINE_IN: 1 });
  });
});

describe('the queue', () => {
  it('holds every paid order until it is marked, and lets a mis-tap be taken back', async () => {
    const one = await ring('2026-10-12T02:00:00.000Z');
    const two = await ring('2026-10-12T02:01:00.000Z');

    let queue = await loadQueue(catalog, session, db);
    expect(queue.waiting.map((order) => order.orderNo)).toEqual([1, 2]);
    expect(queue.waiting[0]?.items).toBe('มะขามแดง');

    await markHandedOver(two.saleId, db, '2026-10-12T02:03:00.000Z');
    queue = await loadQueue(catalog, session, db);
    expect(queue.waiting.map((order) => order.orderNo)).toEqual([1]);
    expect(queue.recent.map((order) => order.orderNo)).toEqual([2]);

    await markWaiting(two.saleId, db);
    queue = await loadQueue(catalog, session, db);
    expect(queue.waiting.map((order) => order.orderNo)).toEqual([1, 2]);

    await markAllHandedOver(session, db, '2026-10-12T02:04:00.000Z');
    queue = await loadQueue(catalog, session, db);
    expect(queue.waiting).toEqual([]);
    expect((await db.sale.get(one.saleId))?.handed_over_at).toBe('2026-10-12T02:04:00.000Z');
  });

  it('drops a voided order', async () => {
    const one = await ring('2026-10-12T02:00:00.000Z');
    await voidSale(one.saleId, 'กดผิด', db);
    expect((await loadQueue(catalog, session, db)).waiting).toEqual([]);
  });

  it('is cleared at close day without asking, and nothing in the books moves', async () => {
    const one = await ring('2026-10-12T02:00:00.000Z');
    const before = await loadDaySummary(session.id, db);

    await closeDay(
      { sessionId: session.id, decisions: [], countedCash: 154_000, note: null },
      catalog,
      db,
      '2026-10-12T10:00:00.000Z',
    );

    expect((await db.sale.get(one.saleId))?.handed_over_at).toBe('2026-10-12T10:00:00.000Z');
    const after = await loadDaySummary(session.id, db);
    expect(after?.totals).toEqual(before?.totals);
  });
});

describe('sales from before order numbers', () => {
  it('are numbered by the database upgrade, in the order they were rung', async () => {
    const name = `rudu-queue-legacy-${crypto.randomUUID()}`;
    const old = new Dexie(name);
    old.version(4).stores({ sale: 'id, business_date, created_at, [business_date+created_at]' });
    await old.table('sale').bulkAdd([
      { id: 'LATE', business_date: DATE, created_at: '2026-10-12T05:00:00.000Z' },
      { id: 'EARLY', business_date: DATE, created_at: '2026-10-12T03:00:00.000Z' },
    ]);
    old.close();

    const upgraded = new RuduPosDB(name);
    await upgraded.open();
    expect(await upgraded.sale.get('EARLY')).toMatchObject({
      order_no: 1,
      order_type: 'TAKEAWAY',
      handed_over_at: '2026-10-12T03:00:00.000Z',
    });
    expect((await upgraded.sale.get('LATE'))?.order_no).toBe(2);
    upgraded.close();
    await RuduPosDB.delete(name);
  });

  it('are numbered when an older backup is restored', async () => {
    const one = await ring('2026-10-12T02:00:00.000Z');
    const backup = await exportBackup(db);
    // As an older build wrote it.
    for (const row of backup.tables['sale'] as Record<string, unknown>[]) {
      delete row['order_no'];
      delete row['order_type'];
      delete row['handed_over_at'];
    }

    await restoreBackup(backup, db);
    expect(await db.sale.get(one.saleId)).toMatchObject({
      order_no: 1,
      order_type: 'TAKEAWAY',
      handed_over_at: '2026-10-12T02:00:00.000Z',
    });
  });
});
