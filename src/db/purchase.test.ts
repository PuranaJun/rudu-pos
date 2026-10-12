/**
 * Packaging stock and purchase orders, against a real database: a sale takes
 * cups off the shelf, a void puts them back, a delivery adds them, and a count
 * settles the difference — all through the ledger, never a counter.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart, toggleModifier } from './cart-repo.ts';
import { completeSale, priceCart } from './sale-repo.ts';
import { voidSale } from './stock-repo.ts';
import {
  applyPackagingCost,
  cancelOrder,
  countPackaging,
  createOrder,
  createSupplier,
  receiveOrder,
  savePurchaseItem,
} from './purchase-repo.ts';
import { packagingRemaining, packagingStock } from '../domain/packaging.ts';
import { lineCost, type CostCatalog } from '../domain/cost.ts';
import { SEED_VERSION_KEY } from '../data/seed.ts';
import type { PurchaseItem } from './types.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

const NOW = '2026-10-12T03:00:00.000Z';
const CUP = 'PKGI_CUP_PLASTIC_16OZ';

beforeEach(async () => {
  dbName = `rudu-purchase-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

const cups = async () => packagingRemaining(CUP, await db.packaging_movement.toArray());

async function ring(qty: number, modifierIds: string[] = []): Promise<string> {
  for (let i = 0; i < qty; i++) {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    if (i === 0) for (const id of modifierIds) await toggleModifier(lineId, id, db);
  }
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
      deviceId: 'phone',
      brandingLineTh: '',
      businessDate: '2026-10-12',
    },
    db,
    NOW,
  );
  return saleId;
}

async function cupsByThePack(supplierId: string): Promise<PurchaseItem> {
  const item: PurchaseItem = {
    id: 'PI_CUPS',
    name_th: 'แก้ว 16oz',
    unit: 'แพ็ค',
    pack_size: 50,
    packaging_item_id: CUP,
    default_supplier_id: supplierId,
    last_unit_cost: 5_900,
    is_active: true,
    synced_at: null,
  };
  await savePurchaseItem(item, db);
  return item;
}

describe('packaging on the shelf', () => {
  it('a sale takes cups and a void puts them back; ice is never counted', async () => {
    await countPackaging(CUP, 100, db, NOW);
    const saleId = await ring(3);
    expect(await cups()).toBe(97);
    expect(
      (await db.packaging_movement.toArray()).some((m) => m.packaging_item_id === 'PKGI_ICE'),
    ).toBe(false);

    await voidSale(saleId, 'ลูกค้าเปลี่ยนใจ', db, NOW);
    expect(await cups()).toBe(100);
  });

  it('a count is the difference, recorded, never an overwrite', async () => {
    await ring(2);
    await countPackaging(CUP, 50, db, NOW);
    const rows = await db.packaging_movement.where('reason').equals('COUNT').toArray();
    expect(rows.map((row) => row.qty_delta)).toEqual([52]);
    expect(await cups()).toBe(50);
  });
});

describe('purchase orders', () => {
  it('ordered, then received with what actually came: packs become cups on the shelf', async () => {
    const supplier = await createSupplier('ร้านป้าแดง', 'LINE @padang', db);
    await cupsByThePack(supplier.id);
    await countPackaging(CUP, 20, db, NOW);

    const { order } = await createOrder(
      {
        supplierId: supplier.id,
        lines: [{ purchaseItemId: 'PI_CUPS', qty: 10, unitCost: 5_900 }],
        note: null,
      },
      false,
      db,
      NOW,
    );
    expect(order).toMatchObject({ status: 'ORDERED', total_cost: 59_000 });
    expect(await cups()).toBe(20);

    const lineId = (await db.purchase_order_line.toArray())[0]!.id;
    const { order: received, suggestions } = await receiveOrder(
      order.id,
      [{ lineId, qty: 8, unitCost: 6_250 }],
      db,
      NOW,
    );
    expect(received).toMatchObject({ status: 'RECEIVED', total_cost: 50_000, received_at: NOW });
    expect(await cups()).toBe(420);
    expect((await db.purchase_item.get('PI_CUPS'))?.last_unit_cost).toBe(6_250);
    expect(suggestions).toEqual([
      { packagingItemId: CUP, name: 'แก้วพลาสติก 16 oz', current: 118, suggested: 125 },
    ]);
  });

  it('refuses to receive the same order twice', async () => {
    const supplier = await createSupplier('ร้านป้าแดง', null, db);
    await cupsByThePack(supplier.id);
    const { order } = await createOrder(
      {
        supplierId: supplier.id,
        lines: [{ purchaseItemId: 'PI_CUPS', qty: 1, unitCost: 5_900 }],
        note: null,
      },
      true,
      db,
      NOW,
    );
    expect(order.status).toBe('RECEIVED');
    const lineId = (await db.purchase_order_line.toArray())[0]!.id;
    await expect(
      receiveOrder(order.id, [{ lineId, qty: 1, unitCost: 5_900 }], db, NOW),
    ).rejects.toThrow('รับของหรือยกเลิกไปแล้ว');
    expect(await cups()).toBe(50);
  });

  it('a cancelled order stays on record and adds nothing', async () => {
    const supplier = await createSupplier('ร้านป้าแดง', null, db);
    await cupsByThePack(supplier.id);
    const { order } = await createOrder(
      {
        supplierId: supplier.id,
        lines: [{ purchaseItemId: 'PI_CUPS', qty: 3, unitCost: 5_900 }],
        note: null,
      },
      false,
      db,
      NOW,
    );
    await cancelOrder(order.id, db);
    expect((await db.purchase_order.get(order.id))?.status).toBe('CANCELLED');
    expect(await cups()).toBe(0);
  });

  it('a new cost per cup applies from the next sale, never to one already made', async () => {
    const before = await ring(1);
    const oldCost = (await db.sale_line.where('sale_id').equals(before).first())!.unit_cost;

    await applyPackagingCost(CUP, 125, db);
    catalog = await loadCostCatalog(db);
    const after = await ring(1);

    expect((await db.sale_line.where('sale_id').equals(before).first())!.unit_cost).toBe(oldCost);
    expect((await db.sale_line.where('sale_id').equals(after).first())!.unit_cost).toBe(
      lineCost(catalog, 'VAR_TAMARIND_ICED'),
    );
    expect(lineCost(catalog, 'VAR_TAMARIND_ICED') - oldCost).toBe(7);
  });

  it('refuses a packaging purchase item that does not say how many are in it', async () => {
    const supplier = await createSupplier('ร้านป้าแดง', null, db);
    const item = await cupsByThePack(supplier.id);
    await expect(savePurchaseItem({ ...item, pack_size: null }, db)).rejects.toThrow('กี่ชิ้น');
  });
});

describe('a phone seeded before packaging was counted', () => {
  it('counts its packaging from the upgrade on, but not ice', async () => {
    for (const item of await db.packaging_item.toArray()) {
      await db.packaging_item.put({
        id: item.id,
        name_th: item.name_th,
        unit_cost: item.unit_cost,
        synced_at: null,
      } as never);
    }
    await db.setting.put({ key: SEED_VERSION_KEY, value: 8, synced_at: null });

    await ensureSeeded(db);
    expect(await db.packaging_item.get(CUP)).toMatchObject({
      is_stock_tracked: true,
      reorder_at: null,
    });
    expect((await db.packaging_item.get('PKGI_ICE'))?.is_stock_tracked).toBe(false);
    expect(packagingStock(await loadCostCatalog(db), []).length).toBeGreaterThan(0);
  });
});
