/**
 * The queue: the session's paid orders not yet handed over (CLAUDE.md §6.1a).
 *
 * Every write here is one field on one sale, and none of them changes money,
 * stock or any report. An order left unmarked is cleared at close day.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { CashSession, OrderType, Sale } from './types.ts';
import type { CostCatalog } from '../domain/cost.ts';
import { handedOverOrders, waitingOrders } from '../domain/queue.ts';
import { sessionSales } from './close-repo.ts';
import { describeItems } from './sale-repo.ts';
import { nowIso } from '../lib/id.ts';

export interface QueueItem {
  saleId: string;
  orderNo: number;
  orderType: OrderType;
  /** Short names, as on the bills list. */
  items: string;
  createdAt: string;
  handedOverAt: string | null;
}

export interface Queue {
  waiting: QueueItem[];
  /** The last few handed over, newest first, so a mis-tap can be taken back. */
  recent: QueueItem[];
}

const RECENT = 5;

export async function loadQueue(
  catalog: CostCatalog,
  session: CashSession,
  db: RuduPosDB = defaultDb,
): Promise<Queue> {
  const sales = await sessionSales(session, db);
  const waiting = waitingOrders(sales);
  const recent = handedOverOrders(sales).slice(0, RECENT);

  const ids = [...waiting, ...recent].map((sale) => sale.id);
  const lines = ids.length > 0 ? await db.sale_line.where('sale_id').anyOf(ids).toArray() : [];

  const item = (sale: Sale): QueueItem => ({
    saleId: sale.id,
    orderNo: sale.order_no,
    orderType: sale.order_type,
    items: describeItems(
      catalog,
      lines.filter((line) => line.sale_id === sale.id),
    ),
    createdAt: sale.created_at,
    handedOverAt: sale.handed_over_at,
  });

  return { waiting: waiting.map(item), recent: recent.map(item) };
}

export async function markHandedOver(
  saleId: string,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  await db.sale.update(saleId, { handed_over_at: now });
}

/** Back into the queue: the tap was on the wrong number. */
export async function markWaiting(saleId: string, db: RuduPosDB = defaultDb): Promise<void> {
  await db.sale.update(saleId, { handed_over_at: null });
}

/** Clear the queue in one tap, after a rush nobody had time to mark. */
export async function markAllHandedOver(
  session: CashSession,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  await db.transaction('rw', db.sale, async () => {
    for (const sale of waitingOrders(await sessionSales(session, db))) {
      await db.sale.update(sale.id, { handed_over_at: now });
    }
  });
}
