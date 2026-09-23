/**
 * Voiding, end to end.
 *
 * Seed a day's stock, ring three mixed sales, void one, and check that the
 * components, the revenue and the COGS all agree with a calculation done from
 * scratch — not with a running total the code happened to keep.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart, setLineDiscountReason, toggleModifier } from './cart-repo.ts';
import { completeSale, loadSalesForDate, priceCart } from './sale-repo.ts';
import { loadStockSnapshot, voidSale } from './stock-repo.ts';
import { componentRemaining, productionMovement } from '../domain/stock.ts';
import { lineCost, unitPrice } from '../domain/cost.ts';
import { dayTotals } from '../domain/reporting.ts';
import { bangkokDate } from '../lib/datetime.ts';
import type { CostCatalog } from '../domain/cost.ts';
import type { ComponentBatch } from './types.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

const NOW = '2026-09-23T02:00:00.000Z';
const BUSINESS_DATE = bangkokDate(NOW);

/** A full day at the catalog's default batch sizes. */
const OPENING: Array<[string, number, ComponentBatch['state']]> = [
  ['COMP_TEA_RED', 5000, 'READY'],
  ['COMP_TEA_WHITE', 4000, 'READY'],
  ['COMP_CONC_TAMARIND', 3000, 'READY'],
  ['COMP_CONC_PEAR', 3000, 'READY'],
  ['COMP_JELLY_CHRYS', 1000, 'CUT'],
  ['COMP_JELLY_WHITE_GOJI', 1000, 'CUT'],
  ['COMP_PEAR_FRESH', 420, 'READY'],
  ['COMP_PEACH_GUM', 350, 'BLANCHED'],
  ['COMP_BASIL_SEED', 250, 'READY'],
];

beforeEach(async () => {
  dbName = `rudu-void-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);

  const batches = OPENING.map(([componentId, qty, state]) => ({
    id: `B_${componentId}`,
    component_id: componentId,
    made_at: '2026-09-22T00:00:00.000Z',
    qty_made: qty,
    state,
    ready_at: '2026-09-22T00:00:00.000Z',
    expires_at: '2026-09-26T00:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  })) satisfies ComponentBatch[];

  await db.component_batch.bulkAdd(batches);
  await db.stock_movement.bulkAdd(batches.map((batch) => productionMovement(batch, batch.made_at)));
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

/** Ring a cart and pay for it, the way the screen does. */
async function ring(
  items: Array<{
    variantId: string;
    qty: number;
    modifierIds?: string[];
    freeReason?: 'LOYALTY_REDEEM';
  }>,
  method: 'CASH' | 'PROMPTPAY' = 'CASH',
): Promise<string> {
  for (const item of items) {
    let lineId = '';
    for (let n = 0; n < item.qty; n += 1) lineId = await addDrink(item.variantId, {}, db);
    for (const modifierId of item.modifierIds ?? []) await toggleModifier(lineId, modifierId, db);
    if (item.freeReason) await setLineDiscountReason(lineId, item.freeReason, db);
  }

  const cart = await loadCart(db);
  const settings = await loadSettings(db);
  const priced = priceCart(catalog, settings, cart);

  const result = await completeSale(
    catalog,
    cart,
    priced,
    {
      method,
      cashReceived: method === 'CASH' ? priced.totalNet : null,
      operatorId: 'เจ้าของ',
      deviceId: 'test',
      brandingLineTh: '',
    },
    db,
    NOW,
  );
  return result.saleId;
}

async function totals() {
  const sales = await db.sale.where('business_date').equals(BUSINESS_DATE).toArray();
  const lines = await db.sale_line.toArray();
  const discounts = await db.sale_line_discount.toArray();
  return dayTotals(sales, lines, discounts);
}

async function remaining(componentId: string): Promise<number> {
  return componentRemaining(await loadStockSnapshot(db), componentId);
}

describe('three sales, one voided', () => {
  it('puts every component back exactly, and takes it out of revenue and COGS', async () => {
    const opening = Object.fromEntries(
      await Promise.all(OPENING.map(async ([id]) => [id, await remaining(id)] as const)),
    );

    // Three mixed sales: a pair of tamarind, a hot pear paid by QR, and an
    // iced pear with peach gum alongside a bottle.
    const saleA = await ring([{ variantId: 'VAR_TAMARIND_ICED', qty: 2 }]);
    const saleB = await ring([{ variantId: 'VAR_PEAR_HOT', qty: 1 }], 'PROMPTPAY');
    const saleC = await ring([
      { variantId: 'VAR_PEAR_ICED', qty: 1, modifierIds: ['MOD_PEACH_GUM'] },
      { variantId: 'VAR_BOTTLE_TAMARIND', qty: 1 },
    ]);

    const beforeVoid = await totals();
    expect(beforeVoid.saleCount).toBe(3);
    expect(beforeVoid.units).toBe(5);

    // What sale B was worth, computed independently of anything recorded.
    const pearHotPrice = unitPrice(catalog, 'VAR_PEAR_HOT');
    const pearHotCost = lineCost(catalog, 'VAR_PEAR_HOT');

    await voidSale(saleB, 'ลูกค้าเปลี่ยนใจ', db, NOW);

    const afterVoid = await totals();

    // Revenue and COGS both drop by exactly that sale.
    expect(afterVoid.revenue).toBe(beforeVoid.revenue - pearHotPrice);
    expect(afterVoid.cogs).toBe(beforeVoid.cogs - pearHotCost);
    expect(afterVoid.grossProfit).toBe(afterVoid.revenue - afterVoid.cogs);
    expect(afterVoid.saleCount).toBe(2);
    expect(afterVoid.voidedCount).toBe(1);
    expect(afterVoid.units).toBe(4);

    // Every component sale B touched is back where the other two left it.
    expect(await remaining('COMP_TEA_WHITE')).toBe(
      opening['COMP_TEA_WHITE']! - 100, // only sale C's iced pear
    );
    expect(await remaining('COMP_CONC_PEAR')).toBe(opening['COMP_CONC_PEAR']! - 50);
    expect(await remaining('COMP_PEAR_FRESH')).toBe(opening['COMP_PEAR_FRESH']! - 21);
    expect(await remaining('COMP_PEACH_GUM')).toBe(opening['COMP_PEACH_GUM']! - 20);

    // And the sales the void did not touch are untouched.
    expect(await remaining('COMP_TEA_RED')).toBe(opening['COMP_TEA_RED']! - 250 - 417);
    expect(await remaining('COMP_JELLY_CHRYS')).toBe(opening['COMP_JELLY_CHRYS']! - 60);

    expect(saleA).not.toBe(saleC);
  });

  it('never deletes or edits the sale row', async () => {
    const saleId = await ring([{ variantId: 'VAR_TAMARIND_ICED', qty: 1 }]);
    const before = await db.sale.get(saleId);

    await voidSale(saleId, 'กดผิด', db, NOW);

    const after = await db.sale.get(saleId);
    expect(after).toBeDefined();
    // Only the void flag and its reason changed. The money is history.
    expect(after).toMatchObject({
      total_gross: before!.total_gross,
      total_net: before!.total_net,
      total_cost: before!.total_cost,
      created_at: before!.created_at,
      is_voided: true,
      void_reason: 'กดผิด',
    });
    expect(await db.sale_line.where('sale_id').equals(saleId).count()).toBe(1);
  });

  it('shows the voided sale struck through in the list, with its reason', async () => {
    const saleId = await ring([{ variantId: 'VAR_TAMARIND_ICED', qty: 2 }]);
    await ring([{ variantId: 'VAR_PEAR_ICED', qty: 1 }]);

    await voidSale(saleId, 'ทำหก', db, NOW);

    const list = await loadSalesForDate(catalog, BUSINESS_DATE, db);
    expect(list).toHaveLength(2);

    const voided = list.find((sale) => sale.id === saleId)!;
    expect(voided.isVoided).toBe(true);
    expect(voided.voidReason).toBe('ทำหก');
    expect(voided.items).toBe('มะขามแดง × 2');
  });

  it('restores a given-away cup too, COGS and all', async () => {
    const opening = await remaining('COMP_TEA_RED');
    const saleId = await ring([
      { variantId: 'VAR_TAMARIND_ICED', qty: 1, freeReason: 'LOYALTY_REDEEM' },
    ]);

    const free = await totals();
    // Worth nothing, cost something, counted as a cup.
    expect(free.revenue).toBe(0);
    expect(free.cogs).toBeGreaterThan(0);
    expect(free.units).toBe(1);
    expect(await remaining('COMP_TEA_RED')).toBe(opening - 125);

    await voidSale(saleId, 'กดผิด', db, NOW);

    const after = await totals();
    expect(after.cogs).toBe(0);
    expect(after.units).toBe(0);
    expect(await remaining('COMP_TEA_RED')).toBe(opening);
  });

  it('takes the discounts off the day with the sale', async () => {
    const saleId = await ring([{ variantId: 'VAR_TAMARIND_ICED', qty: 2 }]);
    expect((await totals()).discountsByReason).toEqual([{ reason: 'PROMO_TWO_CUP', amount: 1000 }]);

    await voidSale(saleId, 'กดผิด', db, NOW);

    expect((await totals()).discountsByReason).toEqual([]);
    expect((await totals()).totalDiscount).toBe(0);
  });

  it('refuses a second void rather than crediting the stock twice', async () => {
    const saleId = await ring([{ variantId: 'VAR_TAMARIND_ICED', qty: 1 }]);
    const opening = await remaining('COMP_TEA_RED');

    await voidSale(saleId, 'กดผิด', db, NOW);
    await expect(voidSale(saleId, 'again', db, NOW)).rejects.toThrow(/already voided/);

    expect(await remaining('COMP_TEA_RED')).toBe(opening + 125);
  });
});
