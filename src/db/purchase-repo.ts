/**
 * Suppliers, purchase orders and the packaging count (CLAUDE.md §6.5, §6.6).
 *
 * Receiving an order is one transaction: the quantities and prices that
 * arrived, the packaging they add, and the price to suggest next time land
 * together or not at all. Nothing here is on the sell path.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type {
  PackagingMovement,
  PurchaseItem,
  PurchaseOrder,
  PurchaseOrderLine,
  Supplier,
} from './types.ts';
import type { Satang } from '../lib/money.ts';
import { newId, nowIso } from '../lib/id.ts';
import { CatalogError } from './catalog-repo.ts';
import {
  costSuggestions,
  orderTotal,
  receivingMovements,
  type CostSuggestion,
} from '../domain/purchasing.ts';
import { countMovement } from '../domain/packaging.ts';

// ------------------------------------------------------------ suppliers

export async function saveSupplier(supplier: Supplier, db: RuduPosDB = defaultDb): Promise<void> {
  if (supplier.name.trim() === '') throw new CatalogError(['ต้องมีชื่อร้าน']);
  await db.supplier.put({ ...supplier, name: supplier.name.trim() });
}

export async function createSupplier(
  name: string,
  contactNote: string | null,
  db: RuduPosDB = defaultDb,
): Promise<Supplier> {
  const supplier: Supplier = {
    id: newId(),
    name: name.trim(),
    contact_note: contactNote?.trim() || null,
    is_active: true,
    synced_at: null,
  };
  await saveSupplier(supplier, db);
  return supplier;
}

// ------------------------------------------------------------ purchase items

export async function savePurchaseItem(
  item: PurchaseItem,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  const wrong: string[] = [];
  if (item.name_th.trim() === '') wrong.push('ต้องมีชื่อ');
  if (item.unit.trim() === '') wrong.push('ต้องมีหน่วยที่ซื้อ เช่น แพ็ค กก. ลัง');
  if (item.packaging_item_id !== null && !(item.pack_size !== null && item.pack_size > 0)) {
    wrong.push('ของที่นับสต็อกต้องบอกว่า 1 หน่วยมีกี่ชิ้น');
  }
  if (
    item.last_unit_cost !== null &&
    !(Number.isInteger(item.last_unit_cost) && item.last_unit_cost >= 0)
  ) {
    wrong.push('ราคาต้องไม่ติดลบ');
  }
  if (wrong.length > 0) throw new CatalogError(wrong);
  await db.purchase_item.put({ ...item, name_th: item.name_th.trim(), unit: item.unit.trim() });
}

// ------------------------------------------------------------ orders

export interface OrderDraft {
  supplierId: string;
  lines: { purchaseItemId: string; qty: number; unitCost: Satang }[];
  note: string | null;
}

export interface Received {
  lineId: string;
  qty: number;
  unitCost: Satang;
}

function checkLines(lines: readonly { qty: number; unitCost: Satang }[]): void {
  const wrong: string[] = [];
  if (lines.length === 0) wrong.push('ยังไม่มีของในใบสั่ง');
  if (lines.some((line) => !(line.qty >= 0))) wrong.push('จำนวนต้องไม่ติดลบ');
  if (lines.some((line) => !(Number.isInteger(line.unitCost) && line.unitCost >= 0))) {
    wrong.push('ราคาต้องไม่ติดลบ');
  }
  if (wrong.length > 0) throw new CatalogError(wrong);
}

/**
 * A new order. `receiveNow` is the market run: bought and carried home in one
 * go, so it is received the moment it is recorded.
 */
export async function createOrder(
  draft: OrderDraft,
  receiveNow: boolean,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<{ order: PurchaseOrder; suggestions: CostSuggestion[] }> {
  const lines = draft.lines.filter((line) => line.qty > 0);
  checkLines(lines);
  if (!draft.supplierId) throw new CatalogError(['เลือกร้านที่ซื้อ']);

  const orderId = newId();
  const rows: PurchaseOrderLine[] = lines.map((line) => ({
    id: newId(),
    purchase_order_id: orderId,
    purchase_item_id: line.purchaseItemId,
    qty_ordered: line.qty,
    qty_received: null,
    unit_cost: line.unitCost,
    synced_at: null,
  }));
  const order: PurchaseOrder = {
    id: orderId,
    supplier_id: draft.supplierId,
    ordered_at: now,
    received_at: null,
    status: 'ORDERED',
    total_cost: orderTotal(rows),
    note: draft.note?.trim() || null,
    synced_at: null,
  };

  return db.transaction(
    'rw',
    [
      db.purchase_order,
      db.purchase_order_line,
      db.purchase_item,
      db.packaging_item,
      db.packaging_movement,
    ],
    async () => {
      await db.purchase_order.add(order);
      await db.purchase_order_line.bulkAdd(rows);
      // The quoted price is the best guess for next time, until one is paid.
      await rememberPrices(rows, db);
      if (!receiveNow) return { order, suggestions: [] };
      return receiveInTransaction(
        orderId,
        rows.map((row) => ({ lineId: row.id, qty: row.qty_ordered, unitCost: row.unit_cost })),
        db,
        now,
      );
    },
  );
}

/** What arrived and what it cost, which is often not what was ordered. */
export async function receiveOrder(
  orderId: string,
  received: readonly Received[],
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<{ order: PurchaseOrder; suggestions: CostSuggestion[] }> {
  checkLines(received);
  return db.transaction(
    'rw',
    [
      db.purchase_order,
      db.purchase_order_line,
      db.purchase_item,
      db.packaging_item,
      db.packaging_movement,
    ],
    () => receiveInTransaction(orderId, received, db, now),
  );
}

async function receiveInTransaction(
  orderId: string,
  received: readonly Received[],
  db: RuduPosDB,
  now: string,
): Promise<{ order: PurchaseOrder; suggestions: CostSuggestion[] }> {
  const order = await db.purchase_order.get(orderId);
  if (!order) throw new Error(`order ${orderId} not found`);
  // Twice received would put the same cups on the shelf twice.
  if (order.status !== 'ORDERED') throw new CatalogError(['ใบสั่งนี้รับของหรือยกเลิกไปแล้ว']);

  const byLine = new Map(received.map((entry) => [entry.lineId, entry]));
  const lines = (
    await db.purchase_order_line.where('purchase_order_id').equals(orderId).toArray()
  ).map((line): PurchaseOrderLine => {
    const entry = byLine.get(line.id);
    return {
      ...line,
      qty_received: entry ? entry.qty : 0,
      unit_cost: entry ? entry.unitCost : line.unit_cost,
    };
  });

  const items = new Map((await db.purchase_item.toArray()).map((item) => [item.id, item]));
  const packaging = new Map((await db.packaging_item.toArray()).map((item) => [item.id, item]));

  await db.purchase_order_line.bulkPut(lines);
  await db.packaging_movement.bulkAdd(receivingMovements(lines, items, now));
  await rememberPrices(
    lines.filter((line) => (line.qty_received ?? 0) > 0),
    db,
  );

  const done: PurchaseOrder = {
    ...order,
    status: 'RECEIVED',
    received_at: now,
    total_cost: orderTotal(lines),
  };
  await db.purchase_order.put(done);

  return { order: done, suggestions: costSuggestions(lines, items, packaging) };
}

async function rememberPrices(lines: readonly PurchaseOrderLine[], db: RuduPosDB): Promise<void> {
  for (const line of lines) {
    await db.purchase_item.update(line.purchase_item_id, { last_unit_cost: line.unit_cost });
  }
}

/** An order that is not coming. Kept, never deleted, so the record says so. */
export async function cancelOrder(orderId: string, db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction('rw', db.purchase_order, async () => {
    const order = await db.purchase_order.get(orderId);
    if (!order) throw new Error(`order ${orderId} not found`);
    if (order.status !== 'ORDERED') throw new CatalogError(['ใบสั่งนี้รับของหรือยกเลิกไปแล้ว']);
    await db.purchase_order.update(orderId, { status: 'CANCELLED' });
  });
}

/**
 * Take a suggested cost per piece. From the next sale on: every sale already
 * made keeps the cost it was sold at (CLAUDE.md §2.1.8).
 */
export async function applyPackagingCost(
  packagingItemId: string,
  unitCost: Satang,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.packaging_item.update(packagingItemId, { unit_cost: unitCost });
}

// ------------------------------------------------------------ the count

/** What is on the shelf, recorded as the difference from what the ledger says. */
export async function countPackaging(
  packagingItemId: string,
  counted: number,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<PackagingMovement> {
  if (!(Number.isFinite(counted) && counted >= 0)) throw new CatalogError(['จำนวนต้องไม่ติดลบ']);
  return db.transaction('rw', db.packaging_movement, async () => {
    const movements = await db.packaging_movement
      .where('packaging_item_id')
      .equals(packagingItemId)
      .toArray();
    const row = countMovement(packagingItemId, counted, movements, now);
    await db.packaging_movement.add(row);
    return row;
  });
}

// ------------------------------------------------------------ reading

export interface Purchasing {
  suppliers: Supplier[];
  items: PurchaseItem[];
  orders: PurchaseOrder[];
  lines: PurchaseOrderLine[];
  packagingMovements: PackagingMovement[];
}

export async function loadPurchasing(db: RuduPosDB = defaultDb): Promise<Purchasing> {
  const [suppliers, items, orders, lines, packagingMovements] = await Promise.all([
    db.supplier.toArray(),
    db.purchase_item.toArray(),
    db.purchase_order.orderBy('ordered_at').reverse().toArray(),
    db.purchase_order_line.toArray(),
    db.packaging_movement.toArray(),
  ]);
  return {
    suppliers: suppliers.sort((a, b) => a.name.localeCompare(b.name, 'th')),
    items: items.sort((a, b) => a.name_th.localeCompare(b.name_th, 'th')),
    orders,
    lines,
    packagingMovements,
  };
}
