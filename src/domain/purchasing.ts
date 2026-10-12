/**
 * Buying from suppliers (CLAUDE.md §6.5).
 *
 * Pure. A purchase order records what was bought and what it cost. Receiving
 * it adds packaging to stock — a pack of 50 cups is 50 cups — and may offer a
 * new cost per piece. It never touches component stock: a kilo of tamarind is
 * not a cup of anything until a batch is made from it (§6.3, §11).
 */
import type { Satang } from '../lib/money.ts';
import { bangkokDate, formatBangkok } from '../lib/datetime.ts';
import type {
  PackagingItem,
  PackagingMovement,
  PurchaseItem,
  PurchaseOrder,
  PurchaseOrderLine,
  Supplier,
} from '../db/types.ts';
import { movement } from './packaging.ts';

/** The quantity that counts: what arrived once received, what was asked for before. */
export function lineQty(line: PurchaseOrderLine): number {
  return line.qty_received ?? line.qty_ordered;
}

/** Each line's quantity × price, summed. Satang throughout. */
export function orderTotal(lines: readonly PurchaseOrderLine[]): Satang {
  return lines.reduce((total, line) => total + Math.round(lineQty(line) * line.unit_cost), 0);
}

/**
 * The packaging that arrived. Only lines whose purchase item is a pack of a
 * packaging item add stock; tea leaves and pears add none.
 */
export function receivingMovements(
  lines: readonly PurchaseOrderLine[],
  items: ReadonlyMap<string, PurchaseItem>,
  now: string,
): PackagingMovement[] {
  const movements: PackagingMovement[] = [];
  for (const line of lines) {
    const item = items.get(line.purchase_item_id);
    if (!item?.packaging_item_id || !item.pack_size) continue;
    const pieces = (line.qty_received ?? 0) * item.pack_size;
    if (pieces === 0) continue;
    movements.push(
      movement(item.packaging_item_id, pieces, 'PURCHASE', now, {
        purchase_order_line_id: line.id,
      }),
    );
  }
  return movements;
}

export interface CostSuggestion {
  packagingItemId: string;
  name: string;
  current: Satang;
  /** The price paid per pack, divided by the pack. */
  suggested: Satang;
}

/**
 * Packaging whose price per piece changed with this delivery. Offered, never
 * applied by itself — and applied forward only: every sale already made keeps
 * the cost it was sold at (CLAUDE.md §2.1.8).
 */
export function costSuggestions(
  lines: readonly PurchaseOrderLine[],
  items: ReadonlyMap<string, PurchaseItem>,
  packaging: ReadonlyMap<string, PackagingItem>,
): CostSuggestion[] {
  const suggestions = new Map<string, CostSuggestion>();
  for (const line of lines) {
    const item = items.get(line.purchase_item_id);
    if (!item?.packaging_item_id || !item.pack_size || !line.qty_received) continue;
    const target = packaging.get(item.packaging_item_id);
    if (!target) continue;
    const suggested = Math.round(line.unit_cost / item.pack_size);
    if (suggested === target.unit_cost) continue;
    suggestions.set(target.id, {
      packagingItemId: target.id,
      name: target.name_th,
      current: target.unit_cost,
      suggested,
    });
  }
  return [...suggestions.values()];
}

/** The order as a LINE message to the supplier: what, how much, nothing else. */
export function orderMessage(
  shopName: string,
  order: PurchaseOrder,
  lines: readonly PurchaseOrderLine[],
  items: ReadonlyMap<string, PurchaseItem>,
  supplier: Supplier | undefined,
): string {
  const rows = lines.map((line) => {
    const item = items.get(line.purchase_item_id);
    return `- ${item?.name_th ?? line.purchase_item_id} ${formatQty(line.qty_ordered)} ${item?.unit ?? ''}`.trimEnd();
  });
  return [
    `สั่งของ ${shopName}`,
    supplier ? `ถึง ${supplier.name}` : null,
    formatBangkok(order.ordered_at),
    '',
    ...rows,
  ]
    .filter((row) => row !== null)
    .join('\n');
}

export interface MonthSpend {
  /** `2026-10`, the Bangkok month. */
  month: string;
  total: Satang;
  bySupplier: { supplierId: string; name: string; total: Satang }[];
  byItem: { purchaseItemId: string; name: string; total: Satang }[];
}

/**
 * What was paid in a month, by the day it arrived. Orders still waiting and
 * cancelled ones are not spending.
 */
export function monthSpend(
  month: string,
  orders: readonly PurchaseOrder[],
  lines: readonly PurchaseOrderLine[],
  suppliers: ReadonlyMap<string, Supplier>,
  items: ReadonlyMap<string, PurchaseItem>,
): MonthSpend {
  const inMonth = orders.filter(
    (order) =>
      order.status === 'RECEIVED' &&
      order.received_at !== null &&
      bangkokDate(order.received_at).startsWith(`${month}-`),
  );
  const ids = new Set(inMonth.map((order) => order.id));

  const bySupplier = new Map<string, Satang>();
  for (const order of inMonth) {
    bySupplier.set(order.supplier_id, (bySupplier.get(order.supplier_id) ?? 0) + order.total_cost);
  }
  const byItem = new Map<string, Satang>();
  for (const line of lines) {
    if (!ids.has(line.purchase_order_id)) continue;
    const cost = Math.round(lineQty(line) * line.unit_cost);
    byItem.set(line.purchase_item_id, (byItem.get(line.purchase_item_id) ?? 0) + cost);
  }

  const most = <T extends { total: Satang }>(a: T, b: T) => b.total - a.total;
  return {
    month,
    total: inMonth.reduce((total, order) => total + order.total_cost, 0),
    bySupplier: [...bySupplier]
      .map(([supplierId, total]) => ({
        supplierId,
        name: suppliers.get(supplierId)?.name ?? supplierId,
        total,
      }))
      .sort(most),
    byItem: [...byItem]
      .map(([purchaseItemId, total]) => ({
        purchaseItemId,
        name: items.get(purchaseItemId)?.name_th ?? purchaseItemId,
        total,
      }))
      .sort(most),
  };
}

/** The month before `2026-01` is `2025-12`. */
export function previousMonth(month: string): string {
  const [year, mm] = month.split('-').map(Number) as [number, number];
  return mm === 1 ? `${year - 1}-12` : `${year}-${String(mm - 1).padStart(2, '0')}`;
}

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
