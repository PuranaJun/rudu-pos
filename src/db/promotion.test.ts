/**
 * The owner's promotions against a real database: saved with their checks,
 * applied at payment under their own name, snapshotted so a rename never
 * rewrites a bill, and — for the switched-on-for-the-day kind — off again
 * every morning.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { seedLegacyCatalog } from './legacy-catalog.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart } from './cart-repo.ts';
import { completeSale, loadReceipt, priceCart } from './sale-repo.ts';
import { closeDay, loadDaySummary } from './close-repo.ts';
import { openSession } from './session-repo.ts';
import { blankPromotion, promotionProblems, savePromotion } from './promotion-repo.ts';
import type { Promotion } from './types.ts';

let db: RuduPosDB;
let dbName: string;

// A Tuesday, 10:00 in Bangkok.
const NOW = '2026-10-13T03:00:00.000Z';

beforeEach(async () => {
  dbName = `rudu-promotion-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await seedLegacyCatalog(db);
  // The 2-cup discount off, so each test sees only the promotion it set up.
  await db.setting.put({ key: 'promo_two_cup_enabled', value: false, synced_at: null });
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

function tuesdayTenOff(overrides: Partial<Promotion> = {}): Promotion {
  return {
    ...blankPromotion(0),
    id: 'PROMO_TUE',
    name_th: 'อังคารลด 10',
    amount: 1_000,
    weekdays: [1],
    ...overrides,
  };
}

async function ring(qty: number, at = NOW): Promise<string> {
  const catalog = await loadCostCatalog(db);
  for (let i = 0; i < qty; i++) await addDrink('VAR_TAMARIND_ICED', {}, db);
  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart, at);
  const { saleId } = await completeSale(
    catalog,
    cart,
    priced,
    {
      method: 'CASH',
      cashReceived: priced.totalNet,
      operatorId: 'เจ้าของ',
      deviceId: 'phone',
      brandingLineTh: '',
      businessDate: '2026-10-13',
    },
    db,
    at,
  );
  return saleId;
}

describe('saving a promotion', () => {
  it('says what is wrong, in words', () => {
    expect(promotionProblems(tuesdayTenOff({ name_th: ' ' }))).toContain('ต้องมีชื่อโปรโมชั่น');
    expect(promotionProblems(tuesdayTenOff({ kind: 'PERCENT_OFF', percent: 120 }))).toContain(
      'ลดกี่ % ต้องอยู่ระหว่าง 1–100',
    );
    expect(
      promotionProblems(tuesdayTenOff({ starts_on: '2026-10-20', ends_on: '2026-10-10' })),
    ).toContain('วันเริ่มต้องไม่หลังวันสิ้นสุด');
    expect(promotionProblems(tuesdayTenOff({ hours_from: '14:00', hours_to: null }))).toContain(
      'ใส่เวลาเริ่มและเวลาจบให้ครบ หรือเว้นว่างทั้งคู่',
    );
    expect(promotionProblems(tuesdayTenOff())).toEqual([]);
  });

  it('refuses one that is wrong', async () => {
    await expect(savePromotion(tuesdayTenOff({ amount: 0 }), db)).rejects.toThrow(
      'ลดกี่บาท ต้องมากกว่า 0',
    );
  });
});

describe('at the till', () => {
  it('comes off by itself, under its own name, and stays that name on the bill', async () => {
    await savePromotion(tuesdayTenOff(), db);
    const saleId = await ring(2);

    expect((await db.sale.get(saleId))?.total_net).toBe(6_000);
    const discounts = await db.sale_line_discount.toArray();
    expect(discounts).toMatchObject([
      { reason: 'PROMO_CUSTOM', promotion_id: 'PROMO_TUE', label: 'อังคารลด 10', amount: 2_000 },
    ]);

    // Renamed next week: last Tuesday's bill still says what it said.
    await savePromotion(tuesdayTenOff({ name_th: 'โปรใหม่' }), db);
    const catalog = await loadCostCatalog(db);
    const found = await loadReceipt(catalog, saleId, '', db);
    expect(found?.receipt.lines[0]?.discounts).toEqual([{ label: 'อังคารลด 10', amount: 2_000 }]);
  });

  it('does nothing on a day it is not for', async () => {
    await savePromotion(tuesdayTenOff({ weekdays: [5] }), db);
    const saleId = await ring(1);
    expect((await db.sale.get(saleId))?.total_net).toBe(4_000);
  });

  it('shows in the day summary by name', async () => {
    await savePromotion(tuesdayTenOff(), db);
    const session = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      '2026-10-13T01:00:00.000Z',
    );
    await ring(1);
    await closeDay(
      { sessionId: session.id, decisions: [], countedCash: 153_000, note: null },
      await loadCostCatalog(db),
      db,
      '2026-10-13T10:00:00.000Z',
    );
    const summary = await loadDaySummary(session.id, db);
    expect(summary?.totals.discountsByReason).toEqual([
      { reason: 'PROMO_CUSTOM', amount: 1_000, label: 'อังคารลด 10' },
    ]);
  });
});

describe('switched on for the day', () => {
  it('is on only after the operator turns it on at open day — and off again the next morning', async () => {
    await savePromotion(
      tuesdayTenOff({ id: 'PROMO_FAIR', name_th: 'งานวัด', activation: 'MANUAL', weekdays: [] }),
      db,
    );
    expect((await db.sale.get(await ring(1)))?.total_net).toBe(4_000);

    const today = await openSession(
      {
        operatorId: 'เจ้าของ',
        openingFloat: 150_000,
        rainyDay: false,
        promotionsOn: ['PROMO_FAIR'],
      },
      db,
      '2026-10-13T01:00:00.000Z',
    );
    expect((await db.promotion.get('PROMO_FAIR'))?.manual_on).toBe(true);
    expect((await db.sale.get(await ring(1)))?.total_net).toBe(3_000);

    await closeDay(
      { sessionId: today.id, decisions: [], countedCash: 0, note: null },
      await loadCostCatalog(db),
      db,
      '2026-10-13T10:00:00.000Z',
    );
    await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      '2026-10-14T01:00:00.000Z',
    );
    expect((await db.promotion.get('PROMO_FAIR'))?.manual_on).toBe(false);
  });
});
