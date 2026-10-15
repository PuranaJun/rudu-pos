/**
 * Fixes from the QA and QC pass of 15 Oct 2026, each pinned so it stays fixed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { seedLegacyCatalog } from './legacy-catalog.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart, setLineDiscountReason, setOrderType } from './cart-repo.ts';
import { CartChangedError, completeSale, priceCart } from './sale-repo.ts';
import { voidSale } from './stock-repo.ts';
import {
  CatalogError,
  removeBomRow,
  removeComponent,
  removeProduct,
  restoreProduct,
  saveProduct,
  saveVariant,
} from './catalog-repo.ts';
import { savePromotion, blankPromotion } from './promotion-repo.ts';
import { batchRemaining, productionMovement } from '../domain/stock.ts';
import type { ComponentBatch } from './types.ts';

let db: RuduPosDB;
let dbName: string;
const NOW = '2026-10-15T03:00:00.000Z';

beforeEach(async () => {
  dbName = `rudu-qa-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await seedLegacyCatalog(db);
  const batch: ComponentBatch = {
    id: 'B_TAMARIND',
    component_id: 'COMP_CONC_TAMARIND',
    made_at: '2026-10-14T00:00:00.000Z',
    qty_made: 3000,
    state: 'READY',
    ready_at: '2026-10-14T00:00:00.000Z',
    expires_at: '2026-10-18T00:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
  await db.component_batch.add(batch);
  await db.stock_movement.add(productionMovement(batch, batch.made_at));
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

async function pay(options: { pricedOrderType?: 'TAKEAWAY' | 'DINE_IN' } = {}) {
  const catalog = await loadCostCatalog(db);
  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart);
  return completeSale(
    catalog,
    cart,
    priced,
    {
      method: 'CASH',
      cashReceived: priced.totalNet,
      operatorId: 'น้อง',
      deviceId: 'test',
      brandingLineTh: '',
      ...options,
    },
    db,
    NOW,
  );
}

describe('a free cup is one cup', () => {
  it('splits one cup off a line of three, and charges for the other two', async () => {
    let lineId = '';
    for (let n = 0; n < 3; n += 1) lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await setLineDiscountReason(lineId, 'LOYALTY_REDEEM', db);

    const cart = await loadCart(db);
    expect(cart.map((item) => [item.line.qty, item.line.manual_discount_reason])).toEqual([
      [2, null],
      [1, 'LOYALTY_REDEEM'],
    ]);
    const priced = priceCart(await loadCostCatalog(db), await loadSettings(db), cart);
    // ฿40 × 2 paid, less the two-cup discount; the free cup is ฿0.
    expect(priced.totalNet).toBe(8_000 - 1_000);
  });

  it('never adds the next cup into the free line', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await setLineDiscountReason(lineId, 'LOYALTY_REDEEM', db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    const cart = await loadCart(db);
    expect(cart.map((item) => [item.line.qty, item.line.manual_discount_reason])).toEqual([
      [1, 'LOYALTY_REDEEM'],
      [1, null],
    ]);
  });
});

describe('a sold-out override', () => {
  it('is recorded on the sale line', async () => {
    await addDrink('VAR_TAMARIND_ICED', { soldOutOverride: true }, db);
    const { saleId } = await pay();
    const [line] = await db.sale_line.where('sale_id').equals(saleId).toArray();
    expect(line?.sold_out_override).toBe(true);
  });
});

describe('order type', () => {
  it('refuses a sale priced with one order type and labelled with another', async () => {
    await setOrderType('DINE_IN', db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    await expect(pay({ pricedOrderType: 'TAKEAWAY' })).rejects.toBeInstanceOf(CartChangedError);
    expect(await db.sale.count()).toBe(0);

    const { saleId } = await pay({ pricedOrderType: 'DINE_IN' });
    expect((await db.sale.get(saleId))?.order_type).toBe('DINE_IN');
  });
});

describe('a spilled drink', () => {
  it('is voided as waste: stock stays used, a SPILLAGE event is recorded', async () => {
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    const { saleId } = await pay();
    const before = batchRemaining('B_TAMARIND', await db.stock_movement.toArray());
    const cupsBefore = await db.packaging_movement.count();

    await voidSale(saleId, 'ทำหก', db, NOW, true);

    expect(batchRemaining('B_TAMARIND', await db.stock_movement.toArray())).toBe(before);
    const waste = await db.waste_event.toArray();
    expect(waste).toHaveLength(1);
    expect(waste[0]).toMatchObject({ reason: 'SPILLAGE', component_batch_id: 'B_TAMARIND' });
    expect(waste[0]!.qty_discarded).toBeGreaterThan(0);
    // The cup and lid were used: nothing goes back on the shelf.
    expect(await db.packaging_movement.count()).toBe(cupsBefore);
    expect((await db.sale.get(saleId))?.is_voided).toBe(true);
  });

  it('a void for another reason still puts the stock back', async () => {
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    const { saleId } = await pay();
    await voidSale(saleId, 'กดผิด', db, NOW);
    expect(batchRemaining('B_TAMARIND', await db.stock_movement.toArray())).toBe(3000);
    expect(await db.waste_event.count()).toBe(0);
  });
});

describe('restoring a drink', () => {
  it('is refused while its recipe needs a removed component', async () => {
    await removeProduct('DRINK_TAMARIND', db, NOW);
    await removeProduct('BOTTLE_TAMARIND_1L', db, NOW);
    await removeComponent('COMP_CONC_TAMARIND', db, NOW);
    await expect(restoreProduct('DRINK_TAMARIND', db)).rejects.toThrow(/หัวเชื้อมะขาม/);
    expect((await db.product.get('DRINK_TAMARIND'))?.removed_at).toBe(NOW);

    // Once the line is out of the recipe, it can come back.
    for (const row of await db.bom.where('component_id').equals('COMP_CONC_TAMARIND').toArray()) {
      if (row.variant_id === 'VAR_TAMARIND_ICED') await removeBomRow(row.id, db, NOW);
    }
    await restoreProduct('DRINK_TAMARIND', db);
    expect((await db.product.get('DRINK_TAMARIND'))?.removed_at).toBeNull();
  });
});

describe('prices are whole baht', () => {
  it('refuses satang on a drink, a variant and a promotion', async () => {
    const product = (await db.product.get('DRINK_TAMARIND'))!;
    await expect(saveProduct({ ...product, base_price: 3_950 }, db)).rejects.toBeInstanceOf(
      CatalogError,
    );
    const variant = (await db.variant.get('VAR_PEAR_HOT'))!;
    await expect(saveVariant({ ...variant, price_override: 5_450 }, db)).rejects.toBeInstanceOf(
      CatalogError,
    );
    await expect(
      savePromotion(
        { ...blankPromotion(0), name_th: 'ทดลอง', kind: 'FIXED_PRICE', amount: 4_550 },
        db,
      ),
    ).rejects.toThrow(/บาทเต็ม/);
  });
});
