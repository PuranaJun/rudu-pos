/**
 * A full dry run, open to close, with the numbers worked out by hand.
 *
 * Prices: tamarind ฿40, pear ฿59 hot or iced, bottle ฿99, ฿10 off a pair.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart } from './cart-repo.ts';
import { completeSale, priceCart } from './sale-repo.ts';
import { loadStockSnapshot, recordBatch, voidSale } from './stock-repo.ts';
import { openSession, sessionBusinessDate } from './session-repo.ts';
import { closeDay, loadDaySummary, loadExpectedCash } from './close-repo.ts';
import { closingLines, type CloseDecision } from '../domain/close-day.ts';
import { batchRemaining } from '../domain/stock.ts';
import { lineCost } from '../domain/cost.ts';
import type { CostCatalog } from '../domain/cost.ts';
import type { BatchState, CashSession, ComponentBatch } from './types.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

const OPEN = '2026-09-23T01:00:00.000Z'; // 08:00 Bangkok
const CLOSE = '2026-09-23T13:00:00.000Z'; // 20:00 Bangkok
const minutesAfterOpen = (minutes: number) =>
  new Date(Date.parse(OPEN) + minutes * 60_000).toISOString();

beforeEach(async () => {
  dbName = `rudu-close-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

async function stock(
  id: string,
  componentId: string,
  qty: number,
  state: BatchState,
  madeAt: string,
  expiresAt: string,
) {
  const batch: ComponentBatch = {
    id,
    component_id: componentId,
    made_at: madeAt,
    qty_made: qty,
    state,
    ready_at: madeAt,
    expires_at: expiresAt,
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
  await recordBatch(batch, null, db, madeAt);
}

/** The morning: last night's tea and concentrates, this morning's fresh things. */
async function morning() {
  const lastNight = '2026-09-22T12:00:00.000Z';
  const later = '2026-09-25T12:00:00.000Z';
  const tomorrowMorning = '2026-09-24T00:00:00.000Z';

  await stock('TEA_RED', 'COMP_TEA_RED', 5000, 'READY', lastNight, later);
  await stock('TEA_WHITE', 'COMP_TEA_WHITE', 4000, 'READY', lastNight, later);
  await stock('CONC_TAM', 'COMP_CONC_TAMARIND', 3000, 'READY', lastNight, later);
  await stock('CONC_PEAR', 'COMP_CONC_PEAR', 3000, 'READY', lastNight, later);
  await stock('GUM', 'COMP_PEACH_GUM', 350, 'BLANCHED', lastNight, later);
  // Cut and prepared this morning: gone by tomorrow.
  await stock(
    'JELLY_CHRYS',
    'COMP_JELLY_CHRYS',
    1000,
    'CUT',
    '2026-09-23T00:00:00.000Z',
    tomorrowMorning,
  );
  await stock(
    'JELLY_GOJI',
    'COMP_JELLY_WHITE_GOJI',
    1000,
    'CUT',
    '2026-09-23T00:00:00.000Z',
    tomorrowMorning,
  );
  await stock('PEAR', 'COMP_PEAR_FRESH', 420, 'READY', '2026-09-23T00:00:00.000Z', tomorrowMorning);
  await stock(
    'BASIL',
    'COMP_BASIL_SEED',
    250,
    'READY',
    '2026-09-23T00:00:00.000Z',
    tomorrowMorning,
  );
}

async function ring(
  session: CashSession,
  items: Array<[variantId: string, qty: number]>,
  method: 'CASH' | 'PROMPTPAY',
  at: string,
): Promise<string> {
  for (const [variantId, qty] of items) {
    for (let n = 0; n < qty; n += 1) await addDrink(variantId, {}, db);
  }
  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart);
  const result = await completeSale(
    catalog,
    cart,
    priced,
    {
      method,
      cashReceived: method === 'CASH' ? priced.totalNet : null,
      operatorId: session.operator_id,
      deviceId: 'test',
      brandingLineTh: '',
      businessDate: sessionBusinessDate(session),
    },
    db,
    at,
  );
  return result.saleId;
}

/** The defaults, as the operator would confirm them in one tap. */
async function defaults(): Promise<CloseDecision[]> {
  return closingLines(catalog, await loadStockSnapshot(db, CLOSE), CLOSE).map((line) => ({
    batchId: line.batch.id,
    counted: Math.max(0, line.remaining),
    decision: line.decision,
    reason: line.reason,
  }));
}

describe('a full day', () => {
  it('CHECK: open → five mixed sales → close; revenue, COGS, waste and cash add up', async () => {
    await morning();
    const session = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      OPEN,
    );

    // 1. Two tamarind, cash: 80 − 10 for the pair = 70
    await ring(session, [['VAR_TAMARIND_ICED', 2]], 'CASH', minutesAfterOpen(10));
    // 2. Iced pear, cash: 59
    await ring(session, [['VAR_PEAR_ICED', 1]], 'CASH', minutesAfterOpen(20));
    // 3. Hot pear, PromptPay: 59 — not in the drawer
    await ring(session, [['VAR_PEAR_HOT', 1]], 'PROMPTPAY', minutesAfterOpen(30));
    // 4. Tamarind and iced pear, cash: 99 − 10 for the pair = 89
    await ring(
      session,
      [
        ['VAR_TAMARIND_ICED', 1],
        ['VAR_PEAR_ICED', 1],
      ],
      'CASH',
      minutesAfterOpen(40),
    );
    // 5. A bottle, cash: 99 (bottles never make a pair)
    await ring(session, [['VAR_BOTTLE_TAMARIND', 1]], 'CASH', minutesAfterOpen(50));

    // Revenue 70 + 59 + 59 + 89 + 99 = 376; cash 376 − 59 = 317; drawer 1,500 + 317.
    expect(await loadExpectedCash(session, db)).toBe(181_700);

    // The operator confirms the defaults, except that the fresh pear looks
    // like 300 g rather than the 357 g the ledger says (420 − 3 × 21).
    const decisions = (await defaults()).map((decision) =>
      decision.batchId === 'PEAR' ? { ...decision, counted: 300 } : decision,
    );

    await closeDay(
      { sessionId: session.id, decisions, countedCash: 180_000, note: null },
      catalog,
      db,
      CLOSE,
    );

    const summary = (await loadDaySummary(session.id, db))!;

    expect(summary.totals.units).toBe(7);
    expect(summary.totals.revenue).toBe(37_600);
    expect(summary.totals.cogs).toBe(
      3 * lineCost(catalog, 'VAR_TAMARIND_ICED') +
        2 * lineCost(catalog, 'VAR_PEAR_ICED') +
        lineCost(catalog, 'VAR_PEAR_HOT') +
        lineCost(catalog, 'VAR_BOTTLE_TAMARIND'),
    );
    expect(summary.totals.grossProfit).toBe(summary.totals.revenue - summary.totals.cogs);
    expect(summary.totals.discountsByReason).toEqual([{ reason: 'PROMO_TWO_CUP', amount: 2_000 }]);
    expect(summary.unitsByVariant).toEqual([
      { variantId: 'VAR_TAMARIND_ICED', name: 'มะขามแดง', units: 3 },
      { variantId: 'VAR_PEAR_ICED', name: 'สาลี่ขาว (เย็น)', units: 2 },
      { variantId: 'VAR_PEAR_HOT', name: 'สาลี่ขาว (ร้อน)', units: 1 },
      { variantId: 'VAR_BOTTLE_TAMARIND', name: 'ขวดมะขาม 1L', units: 1 },
    ]);

    // Waste, by hand, at cost per unit:
    //   fresh pear   300 g × 0.07      = 21.00
    //   goji jelly   940 g × 0.0226667 = 21.31  (1000 − 2 iced pears × 30)
    //   chrys jelly  910 g × 0.0136667 = 12.44  (1000 − 3 tamarind × 30)
    //   basil seed   250 g × 0.0214286 =  5.36
    expect(summary.waste.map((line) => [line.componentId, line.qty, line.cost])).toEqual([
      ['COMP_JELLY_WHITE_GOJI', 940, 2_131],
      ['COMP_PEAR_FRESH', 300, 2_100],
      ['COMP_JELLY_CHRYS', 910, 1_244],
      ['COMP_BASIL_SEED', 250, 536],
    ]);
    expect(summary.wasteCost).toBe(6_011);
    expect(summary.afterWaste).toBe(summary.totals.grossProfit - 6_011);

    // Seven cups is short of ten, and the money agrees.
    expect(summary.breakeven).toMatchObject({ cups: 7, cupsTarget: 10, past: false });

    // 1,800 counted against 1,817 expected: 17 short, recorded, not refused.
    expect(summary.cash).toEqual({
      openingFloat: 150_000,
      expected: 181_700,
      counted: 180_000,
      variance: -1_700,
    });
  });
});

describe('the stock at close', () => {
  async function openAndSell(): Promise<CashSession> {
    await morning();
    const session = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      OPEN,
    );
    await ring(session, [['VAR_PEAR_ICED', 3]], 'CASH', minutesAfterOpen(10));
    return session;
  }

  it('defaults same-day things to discard and everything in date to carry over', async () => {
    await openAndSell();
    const lines = closingLines(catalog, await loadStockSnapshot(db, CLOSE), CLOSE);
    const byBatch = Object.fromEntries(
      lines.map((line) => [line.batch.id, [line.decision, line.reason]]),
    );

    expect(byBatch).toMatchObject({
      JELLY_CHRYS: ['DISCARD', 'END_OF_DAY_PERISHABLE'],
      JELLY_GOJI: ['DISCARD', 'END_OF_DAY_PERISHABLE'],
      PEAR: ['DISCARD', 'END_OF_DAY_PERISHABLE'],
      BASIL: ['DISCARD', 'END_OF_DAY_PERISHABLE'],
      TEA_RED: ['CARRY', 'QUALITY'],
      TEA_WHITE: ['CARRY', 'QUALITY'],
      CONC_TAM: ['CARRY', 'QUALITY'],
      GUM: ['CARRY', 'QUALITY'],
    });
  });

  it('discards expired stock as EXPIRED, whatever its shelf life', async () => {
    await openAndSell();
    await db.component_batch.update('TEA_RED', { expires_at: '2026-09-23T12:00:00.000Z' });

    const line = closingLines(catalog, await loadStockSnapshot(db, CLOSE), CLOSE).find(
      (entry) => entry.batch.id === 'TEA_RED',
    );
    expect(line).toMatchObject({ decision: 'DISCARD', reason: 'EXPIRED' });
  });

  it('keeps a miscount and a discard as separate facts in the ledger', async () => {
    const session = await openAndSell();
    const decisions = (await defaults()).map((decision) =>
      decision.batchId === 'PEAR' ? { ...decision, counted: 300 } : decision,
    );

    await closeDay(
      { sessionId: session.id, decisions, countedCash: 0, note: null },
      catalog,
      db,
      CLOSE,
    );

    const pear = await db.stock_movement
      .where('component_batch_id')
      .equals('PEAR')
      .sortBy('created_at');
    // 420 made, 63 sold, 57 unaccounted for, 300 thrown out. The last two
    // share the close's timestamp, so their order is not the point.
    expect(pear).toHaveLength(4);
    expect(pear.map((row) => [row.reason, row.qty_delta])).toEqual(
      expect.arrayContaining([
        ['PRODUCTION', 420],
        ['SALE', -63],
        ['ADJUSTMENT', -57],
        ['WASTE', -300],
      ]),
    );
    expect(await db.waste_event.where('component_batch_id').equals('PEAR').toArray()).toEqual([
      expect.objectContaining({
        qty_discarded: 300,
        reason: 'END_OF_DAY_PERISHABLE',
        cash_session_id: session.id,
        cost: 2_100,
      }),
    ]);
  });

  it('marks discarded batches DISCARDED and leaves carried ones alone', async () => {
    const session = await openAndSell();
    await closeDay(
      { sessionId: session.id, decisions: await defaults(), countedCash: 0, note: null },
      catalog,
      db,
      CLOSE,
    );

    expect((await db.component_batch.get('PEAR'))?.state).toBe('DISCARDED');
    expect((await db.component_batch.get('TEA_WHITE'))?.state).toBe('READY');
    const snapshot = await loadStockSnapshot(db, CLOSE);
    expect(batchRemaining('PEAR', snapshot.movements)).toBe(0);
    // Three iced pears at 100 ml; the rest is tomorrow's.
    expect(batchRemaining('TEA_WHITE', snapshot.movements)).toBe(3700);
  });

  it('prices waste when it is thrown, not when it is read back', async () => {
    const session = await openAndSell();
    await closeDay(
      { sessionId: session.id, decisions: await defaults(), countedCash: 0, note: null },
      catalog,
      db,
      CLOSE,
    );
    const before = (await loadDaySummary(session.id, db))!.wasteCost;

    await db.component.update('COMP_PEAR_FRESH', { cost_per_unit: 1 });

    expect((await loadDaySummary(session.id, db))!.wasteCost).toBe(before);
  });
});

describe('the drawer', () => {
  it('leaves a voided cash sale out of what should be there', async () => {
    await morning();
    const session = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      OPEN,
    );
    await ring(session, [['VAR_TAMARIND_ICED', 1]], 'CASH', minutesAfterOpen(10));
    const mistake = await ring(session, [['VAR_PEAR_ICED', 1]], 'CASH', minutesAfterOpen(20));
    await voidSale(mistake, 'กดผิด', db, minutesAfterOpen(21));

    expect(await loadExpectedCash(session, db)).toBe(150_000 + 4_000);
  });

  it('records a large variance rather than refusing it, and will not close twice', async () => {
    await morning();
    const session = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      OPEN,
    );

    const closed = await closeDay(
      { sessionId: session.id, decisions: [], countedCash: 100_000, note: 'ทอนผิด' },
      catalog,
      db,
      CLOSE,
    );
    expect(closed).toMatchObject({ closed_at: CLOSE, variance: -50_000, note: 'ทอนผิด' });

    await expect(
      closeDay({ sessionId: session.id, decisions: [], countedCash: 0, note: null }, catalog, db),
    ).rejects.toThrow(/already closed/);
  });
});
