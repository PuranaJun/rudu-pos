/**
 * Completing a sale.
 *
 * Everything lands in one Dexie transaction: the sale, its lines, its
 * modifiers, every stock movement, and the emptying of the cart. A phone that
 * dies halfway through leaves no sale with undeducted stock and no deducted
 * stock without a sale.
 *
 * Step 5 adds the tender pad, the automatic promotions and the discount
 * reasons on top of this; what is here is the commit itself.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { PaymentMethod, Sale, SaleLine, SaleLineMod } from './types.ts';
import { lineCost, unitPrice, type CostCatalog } from '../domain/cost.ts';
import { deductForSale, type Shortfall } from '../domain/stock.ts';
import { loadStockSnapshot } from './stock-repo.ts';
import { bangkokDate } from '../lib/datetime.ts';
import { newId, nowIso } from '../lib/id.ts';
import type { CartItem } from './cart-repo.ts';

export interface CompletedSale {
  saleId: string;
  /** Components the sale could not source from any batch. Warn, never block. */
  shortfalls: Shortfall[];
}

export interface PaymentDetails {
  method: PaymentMethod;
  /** Null for PromptPay, which the operator confirms by eye. */
  cashReceived: number | null;
  operatorId: string;
  deviceId: string;
}

export async function completeSale(
  catalog: CostCatalog,
  cart: readonly CartItem[],
  payment: PaymentDetails,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<CompletedSale> {
  if (cart.length === 0) throw new Error('nothing in the cart');

  const saleId = newId();

  return db.transaction(
    'rw',
    [
      db.sale,
      db.sale_line,
      db.sale_line_mod,
      db.component_batch,
      db.stock_movement,
      db.cart_line,
      db.cart_line_mod,
    ],
    async () => {
      const lines: SaleLine[] = [];
      const lineMods: SaleLineMod[] = [];

      let gross = 0;
      let cost = 0;

      for (const item of cart) {
        const { variant_id: variantId, qty } = item.line;

        // Snapshot both: a price or a recipe edited next month must never
        // rewrite what this sale cost (CLAUDE.md §2.1.8).
        const price = unitPrice(catalog, variantId, item.modifierIds);
        const unitCost = lineCost(catalog, variantId, item.modifierIds);

        const line: SaleLine = {
          id: newId(),
          sale_id: saleId,
          variant_id: variantId,
          qty,
          unit_price: price,
          line_discount: 0,
          discount_reason: null,
          unit_cost: unitCost,
          synced_at: null,
        };
        lines.push(line);

        for (const modifierId of item.modifierIds) {
          const modifier = catalog.modifiers.get(modifierId);
          if (!modifier) continue;
          lineMods.push({
            id: newId(),
            sale_line_id: line.id,
            modifier_id: modifierId,
            price_delta: modifier.price_delta,
            cost_delta: modifier.cost_delta,
            synced_at: null,
          });
        }

        gross += price * qty;
        cost += unitCost * qty;
      }

      const snapshot = await loadStockSnapshot(db);
      const deduction = deductForSale(
        catalog,
        snapshot,
        lines.map((line, index) => ({
          saleLineId: line.id,
          variantId: line.variant_id,
          qty: line.qty,
          modifierIds: cart[index]?.modifierIds ?? [],
        })),
        now,
      );

      const received = payment.cashReceived;
      const sale: Sale = {
        id: saleId,
        created_at: now,
        business_date: bangkokDate(now),
        operator_id: payment.operatorId,
        total_gross: gross,
        total_discount: 0,
        total_net: gross,
        total_cost: cost,
        payment_method: payment.method,
        cash_received: received,
        cash_change: received === null ? null : received - gross,
        is_voided: false,
        void_reason: null,
        device_id: payment.deviceId,
        synced_at: null,
      };

      await db.sale.add(sale);
      await db.sale_line.bulkAdd(lines);
      if (lineMods.length > 0) await db.sale_line_mod.bulkAdd(lineMods);
      await db.stock_movement.bulkAdd(deduction.movements);

      await db.cart_line_mod.clear();
      await db.cart_line.clear();

      return { saleId, shortfalls: deduction.shortfalls };
    },
  );
}
