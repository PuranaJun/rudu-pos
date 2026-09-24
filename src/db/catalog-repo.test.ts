import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart } from './cart-repo.ts';
import { completeSale, priceCart } from './sale-repo.ts';
import { openSession, sessionBusinessDate } from './session-repo.ts';
import { closeDay, loadDaySummary } from './close-repo.ts';
import {
  CatalogError,
  addBomRow,
  createVariant,
  saveBomRow,
  saveComponent,
  saveProduct,
  saveVariant,
} from './catalog-repo.ts';
import { lineCost } from '../domain/cost.ts';
import type { CashSession } from './types.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-catalog-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

async function ringTamarind(session: CashSession, at: string): Promise<string> {
  const catalog = await loadCostCatalog(db);
  await addDrink('VAR_TAMARIND_ICED', {}, db);
  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart);
  const { saleId } = await completeSale(
    catalog,
    cart,
    priced,
    {
      method: 'CASH',
      cashReceived: priced.totalNet,
      operatorId: 'เจ้าของ',
      deviceId: 'test',
      brandingLineTh: '',
      businessDate: sessionBusinessDate(session),
    },
    db,
    at,
  );
  return saleId;
}

describe('changes are effective forward only', () => {
  it('a sale rung before a price and cost change keeps its price, cost and gross profit', async () => {
    const monday = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      '2026-09-21T01:00:00.000Z',
    );
    const before = await ringTamarind(monday, '2026-09-21T02:00:00.000Z');
    await closeDay(
      { sessionId: monday.id, decisions: [], countedCash: 154_000, note: null },
      await loadCostCatalog(db),
      db,
      '2026-09-21T13:00:00.000Z',
    );

    const oldCost = lineCost(await loadCostCatalog(db), 'VAR_TAMARIND_ICED');
    const mondayReport = await loadDaySummary(monday.id, db);

    // After the taste test: tamarind goes to ฿45 and the red tea costs double.
    const tamarind = (await db.product.get('DRINK_TAMARIND'))!;
    await saveProduct({ ...tamarind, base_price: 4_500 }, db);
    const tea = (await db.component.get('COMP_TEA_RED'))!;
    await saveComponent({ ...tea, cost_per_unit: tea.cost_per_unit * 2 }, db);

    // Monday reads exactly as it did.
    expect(await loadDaySummary(monday.id, db)).toEqual(mondayReport);
    const line = (await db.sale_line.where('sale_id').equals(before).toArray())[0]!;
    expect(line).toMatchObject({ unit_price: 4_000, unit_cost: oldCost });
    expect(mondayReport!.totals).toMatchObject({
      revenue: 4_000,
      cogs: oldCost,
      grossProfit: 4_000 - oldCost,
    });

    // Tuesday's cup is priced and costed on the new figures.
    const tuesday = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
      db,
      '2026-09-22T01:00:00.000Z',
    );
    const after = await ringTamarind(tuesday, '2026-09-22T02:00:00.000Z');
    const newCost = lineCost(await loadCostCatalog(db), 'VAR_TAMARIND_ICED');
    expect(newCost).toBeGreaterThan(oldCost);
    expect((await db.sale_line.where('sale_id').equals(after).toArray())[0]).toMatchObject({
      unit_price: 4_500,
      unit_cost: newCost,
    });
  });
});

describe('the rules on an edit', () => {
  it('refuses what would break the arithmetic, and says why in Thai', async () => {
    const tamarind = (await db.product.get('DRINK_TAMARIND'))!;
    await expect(saveProduct({ ...tamarind, name_short_th: ' ' }, db)).rejects.toBeInstanceOf(
      CatalogError,
    );

    const jelly = (await db.component.get('COMP_JELLY_CHRYS'))!;
    await expect(saveComponent({ ...jelly, cut_shelf_life_hours: null }, db)).rejects.toThrow(
      'เยลลี่ต้องมีอายุหลังตัด',
    );
    await expect(saveComponent({ ...jelly, cost_per_unit: -1 }, db)).rejects.toThrow(
      'ต้นทุนต้องไม่ติดลบ',
    );
  });

  it('keeps one row per component in a recipe, so nothing is deducted twice', async () => {
    await expect(addBomRow('VAR_TAMARIND_ICED', 'COMP_TEA_RED', 100, db)).rejects.toThrow(
      'ส่วนประกอบนี้อยู่ในสูตรแล้ว',
    );

    const row = (await db.bom.get('BOM_VAR_TAMARIND_ICED_COMP_TEA_RED'))!;
    await saveBomRow({ ...row, qty_per_cup: 140 }, db);
    expect((await db.bom.get(row.id))?.qty_per_cup).toBe(140);
    await expect(saveBomRow({ ...row, qty_per_cup: 0 }, db)).rejects.toThrow(
      'ปริมาณต่อแก้วต้องมากกว่า 0',
    );
  });

  it('keeps exactly one default variant per product', async () => {
    const hot = (await db.variant.get('VAR_PEAR_HOT'))!;
    await saveVariant({ ...hot, is_default: true }, db);

    expect((await db.variant.get('VAR_PEAR_HOT'))?.is_default).toBe(true);
    expect((await db.variant.get('VAR_PEAR_ICED'))?.is_default).toBe(false);

    const extra = await createVariant('DRINK_PEAR', db);
    expect(extra.is_default).toBe(false);
    expect(extra.packaging_set_id).toBe('PKG_HOT');
  });
});
