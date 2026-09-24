/**
 * Completing a sale.
 *
 * Everything lands in one Dexie transaction: the sale, its lines, its
 * modifiers, its discounts, every stock movement, and the emptying of the
 * cart. A phone that dies halfway through leaves no sale with undeducted stock
 * and no deducted stock without a sale.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type {
  DiscountReason,
  PaymentMethod,
  Sale,
  SaleLine,
  SaleLineDiscount,
  SaleLineMod,
} from './types.ts';
import { lineCost, unitPrice, type CostCatalog } from '../domain/cost.ts';
import { applyPromotions, type PricedCart, type PromotionSettings } from '../domain/promotions.ts';
import { deductForSale, type Shortfall } from '../domain/stock.ts';
import { loadStockSnapshot } from './stock-repo.ts';
import { bangkokDate } from '../lib/datetime.ts';
import { newId, nowIso } from '../lib/id.ts';
import type { CartItem } from './cart-repo.ts';

export interface CompletedSale {
  saleId: string;
  /** Components the sale could not source from any batch. Warn, never block. */
  shortfalls: Shortfall[];
  receipt: Receipt;
}

export interface ReceiptLine {
  name: string;
  qty: number;
  unitPrice: number;
  net: number;
  modifiers: string[];
  discounts: { label: string; amount: number }[];
}

export interface Receipt {
  saleId: string;
  createdAt: string;
  brandingLineTh: string;
  lines: ReceiptLine[];
  totalGross: number;
  totalDiscount: number;
  totalNet: number;
  paymentMethod: PaymentMethod;
  cashReceived: number | null;
  cashChange: number | null;
}

export interface PaymentDetails {
  method: PaymentMethod;
  /** Null for PromptPay, which the operator confirms by eye. */
  cashReceived: number | null;
  operatorId: string;
  deviceId: string;
  brandingLineTh: string;
  /**
   * The open session's date. Falls back to the Bangkok calendar date only
   * when there is no session to belong to (CLAUDE.md §8).
   */
  businessDate?: string;
}

/**
 * Price a cart the way the sale will be written, so the sell screen and the
 * tender pad can never show a different number from the one recorded.
 */
export function priceCart(
  catalog: CostCatalog,
  settings: PromotionSettings,
  cart: readonly CartItem[],
): PricedCart {
  return applyPromotions(
    catalog,
    settings,
    cart.map((item) => ({
      lineId: item.line.id,
      variantId: item.line.variant_id,
      qty: item.line.qty,
      unitPrice: unitPrice(catalog, item.line.variant_id, item.modifierIds),
      manualReason: item.line.manual_discount_reason ?? null,
    })),
  );
}

export async function completeSale(
  catalog: CostCatalog,
  cart: readonly CartItem[],
  priced: PricedCart,
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
      db.sale_line_discount,
      db.component_batch,
      db.stock_movement,
      db.cart_line,
      db.cart_line_mod,
    ],
    async () => {
      const lines: SaleLine[] = [];
      const lineMods: SaleLineMod[] = [];
      const lineDiscounts: SaleLineDiscount[] = [];
      const receiptLines: ReceiptLine[] = [];

      let cost = 0;

      for (const item of cart) {
        const { variant_id: variantId, qty } = item.line;
        const pricedLine = priced.lines.find((line) => line.lineId === item.line.id);
        if (!pricedLine) throw new Error(`cart line ${item.line.id} was not priced`);

        // Both snapshotted: a price or a recipe edited next month must never
        // rewrite what this sale charged or cost (CLAUDE.md §2.1.8).
        const unitCost = lineCost(catalog, variantId, item.modifierIds);
        const discount = pricedLine.gross - pricedLine.net;

        const line: SaleLine = {
          id: newId(),
          sale_id: saleId,
          variant_id: variantId,
          qty,
          unit_price: pricedLine.unitPrice,
          line_discount: discount,
          // One reason fits the column; more than one lives in the child rows.
          discount_reason:
            pricedLine.discounts.length === 1
              ? (pricedLine.discounts[0]!.reason as DiscountReason)
              : null,
          unit_cost: unitCost,
          synced_at: null,
        };
        lines.push(line);

        for (const applied of pricedLine.discounts) {
          lineDiscounts.push({
            id: newId(),
            sale_line_id: line.id,
            reason: applied.reason,
            amount: applied.amount,
            synced_at: null,
          });
        }

        const modifierNames: string[] = [];
        for (const modifierId of item.modifierIds) {
          const modifier = catalog.modifiers.get(modifierId);
          if (!modifier) continue;
          modifierNames.push(modifier.name_th);
          lineMods.push({
            id: newId(),
            sale_line_id: line.id,
            modifier_id: modifierId,
            price_delta: modifier.price_delta,
            cost_delta: modifier.cost_delta,
            synced_at: null,
          });
        }

        // A given-away cup still lands in COGS, which is the point of tracking
        // it at all (CLAUDE.md §4).
        cost += unitCost * qty;

        const variant = catalog.variants.get(variantId);
        const product = variant ? catalog.products.get(variant.product_id) : undefined;
        receiptLines.push({
          name: product?.name_short_th ?? variantId,
          qty,
          unitPrice: pricedLine.unitPrice,
          net: pricedLine.net,
          modifiers: modifierNames,
          discounts: pricedLine.discounts.map((applied) => ({
            label: applied.reason,
            amount: applied.amount,
          })),
        });
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
        business_date: payment.businessDate ?? bangkokDate(now),
        operator_id: payment.operatorId,
        total_gross: priced.totalGross,
        total_discount: priced.totalDiscount,
        total_net: priced.totalNet,
        total_cost: cost,
        payment_method: payment.method,
        cash_received: received,
        cash_change: received === null ? null : received - priced.totalNet,
        is_voided: false,
        void_reason: null,
        device_id: payment.deviceId,
        synced_at: null,
      };

      await db.sale.add(sale);
      await db.sale_line.bulkAdd(lines);
      if (lineMods.length > 0) await db.sale_line_mod.bulkAdd(lineMods);
      if (lineDiscounts.length > 0) await db.sale_line_discount.bulkAdd(lineDiscounts);
      await db.stock_movement.bulkAdd(deduction.movements);

      await db.cart_line_mod.clear();
      await db.cart_line.clear();

      return {
        saleId,
        shortfalls: deduction.shortfalls,
        receipt: {
          saleId,
          createdAt: now,
          brandingLineTh: payment.brandingLineTh,
          lines: receiptLines,
          totalGross: priced.totalGross,
          totalDiscount: priced.totalDiscount,
          totalNet: priced.totalNet,
          paymentMethod: payment.method,
          cashReceived: sale.cash_received,
          cashChange: sale.cash_change,
        },
      };
    },
  );
}

export interface SaleSummary {
  id: string;
  createdAt: string;
  /** "มะขามแดง × 2 · สาลี่ขาว" — short names only, never the full ones. */
  items: string;
  totalNet: number;
  paymentMethod: PaymentMethod;
  isVoided: boolean;
  voidReason: string | null;
}

/**
 * The day's sales, newest first, voided ones included.
 *
 * A voided sale stays in the list struck through with its reason. It is never
 * deleted and never edited — that is the whole point of voiding rather than
 * correcting (CLAUDE.md §10).
 */
export async function loadSalesForDate(
  catalog: CostCatalog,
  businessDate: string,
  db: RuduPosDB = defaultDb,
): Promise<SaleSummary[]> {
  const sales = await db.sale.where('business_date').equals(businessDate).toArray();
  if (sales.length === 0) return [];

  const saleIds = new Set(sales.map((sale) => sale.id));
  const lines = (await db.sale_line.toArray()).filter((line) => saleIds.has(line.sale_id));

  return sales
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((sale) => ({
      id: sale.id,
      createdAt: sale.created_at,
      items: lines
        .filter((line) => line.sale_id === sale.id)
        .map((line) => {
          const variant = catalog.variants.get(line.variant_id);
          const product = variant ? catalog.products.get(variant.product_id) : undefined;
          const name = product?.name_short_th ?? line.variant_id;
          return line.qty > 1 ? `${name} × ${line.qty}` : name;
        })
        .join(' · '),
      totalNet: sale.total_net,
      paymentMethod: sale.payment_method,
      isVoided: sale.is_voided,
      voidReason: sale.void_reason,
    }));
}
