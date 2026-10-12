import Dexie, { type Table } from 'dexie';
import type {
  Bom,
  CartLine,
  CartLineMod,
  CashSession,
  Component,
  ComponentBatch,
  Modifier,
  PackagingItem,
  PackagingMovement,
  PackagingSet,
  Product,
  PurchaseItem,
  PurchaseOrder,
  PurchaseOrderLine,
  Sale,
  SaleLine,
  SaleLineDiscount,
  SaleLineMod,
  Setting,
  StockMovement,
  Supplier,
  Variant,
  WasteEvent,
} from './types.ts';
import { legacySalePatches } from '../domain/queue.ts';

export const DB_NAME = 'RuduPosDB';

/**
 * Index rules worth remembering when adding tables:
 * - IndexedDB cannot index a boolean, so `is_active`, `is_voided` and
 *   `is_batch_tracked` are deliberately unindexed. Indexing them would
 *   silently drop every row from the index.
 * - `synced_at` is nullable and null values are excluded from an index, so it
 *   is unindexed too. v1 has no server.
 */
export class RuduPosDB extends Dexie {
  // Catalog — seeded once, then owned by the database.
  product!: Table<Product, string>;
  variant!: Table<Variant, string>;
  component!: Table<Component, string>;
  bom!: Table<Bom, string>;
  packaging_set!: Table<PackagingSet, string>;
  packaging_item!: Table<PackagingItem, string>;
  modifier!: Table<Modifier, string>;

  // Stock
  component_batch!: Table<ComponentBatch, string>;
  stock_movement!: Table<StockMovement, string>;
  waste_event!: Table<WasteEvent, string>;
  packaging_movement!: Table<PackagingMovement, string>;

  // Buying
  supplier!: Table<Supplier, string>;
  purchase_item!: Table<PurchaseItem, string>;
  purchase_order!: Table<PurchaseOrder, string>;
  purchase_order_line!: Table<PurchaseOrderLine, string>;

  // Trade
  sale!: Table<Sale, string>;
  sale_line!: Table<SaleLine, string>;
  sale_line_mod!: Table<SaleLineMod, string>;
  sale_line_discount!: Table<SaleLineDiscount, string>;
  cash_session!: Table<CashSession, string>;

  // The open cart. Persisted per line, cleared at payment.
  cart_line!: Table<CartLine, string>;
  cart_line_mod!: Table<CartLineMod, string>;

  setting!: Table<Setting, string>;

  constructor(name: string = DB_NAME) {
    super(name);

    this.version(1).stores({
      product: 'id, sort_order',
      variant: 'id, product_id, sort_order',
      component: 'id, sort_order',
      bom: 'id, variant_id, component_id, [variant_id+component_id]',
      packaging_set: 'id',
      packaging_item: 'id',
      modifier: 'id, kind, sort_order, *applies_to_variant_ids',

      component_batch:
        'id, component_id, state, [component_id+state], made_at, ready_at, expires_at, parent_batch_id',
      stock_movement: 'id, component_batch_id, sale_line_id, reason, created_at',
      waste_event: 'id, component_batch_id, reason, recorded_at',

      sale: 'id, business_date, created_at, [business_date+created_at]',
      sale_line: 'id, sale_id, variant_id',
      sale_line_mod: 'id, sale_line_id, modifier_id',
      cash_session: 'id, opened_at, closed_at, operator_id',

      setting: 'key',
    });

    this.version(2).stores({
      cart_line: 'id, variant_id, added_at',
      cart_line_mod: 'id, cart_line_id, modifier_id',
    });

    this.version(3).stores({
      sale_line_discount: 'id, sale_line_id, reason',
    });

    // A day's waste is read back by its session.
    this.version(4).stores({
      waste_event: 'id, component_batch_id, reason, recorded_at, cash_session_id',
    });

    // Order numbers, order type and the queue. Sales rung before this get
    // their numbers in the order they were rung, and count as handed over.
    this.version(5)
      .stores({})
      .upgrade(async (tx) => {
        const sales = tx.table<Sale, string>('sale');
        for (const patch of legacySalePatches(await sales.toArray())) {
          await sales.update(patch.id, patch.changes);
        }
      });

    // Packaging counted as stock, and buying from suppliers.
    this.version(6).stores({
      packaging_movement:
        'id, packaging_item_id, sale_line_id, purchase_order_line_id, reason, created_at',
      supplier: 'id',
      purchase_item: 'id, packaging_item_id, default_supplier_id',
      purchase_order: 'id, supplier_id, status, ordered_at, received_at',
      purchase_order_line: 'id, purchase_order_id, purchase_item_id',
    });
  }
}

export const db = new RuduPosDB();
