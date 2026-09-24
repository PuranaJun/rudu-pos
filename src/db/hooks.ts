/**
 * Live reads for the screens.
 *
 * Everything the sell screen shows comes through useLiveQuery, so a write
 * anywhere — a sale, a batch, a cut — repaints without anything having to
 * remember to refresh. Nothing here polls and nothing here touches the
 * network (CLAUDE.md §1).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { loadCart, type CartItem } from './cart-repo.ts';
import { loadStockSnapshot } from './stock-repo.ts';
import type { CostCatalog } from '../domain/cost.ts';
import type { StockSnapshot } from '../domain/stock.ts';
import { bangkokDate } from '../lib/datetime.ts';
import { DEVICE_ID_KEY } from './device.ts';
import { loadSettings, type PosSettings } from './settings-repo.ts';
import { loadSalesForDate, type SaleSummary } from './sale-repo.ts';
import { dayTotals, type DayTotals, type DaySummary } from '../domain/reporting.ts';
import { loadDaySummary, loadExpectedCash } from './close-repo.ts';
import { lastOperator, loadOpenSession } from './session-repo.ts';
import type { CashSession } from './types.ts';

export function useCostCatalog(): CostCatalog | undefined {
  return useLiveQuery(() => loadCostCatalog(db), []);
}

export function useStockSnapshot(): StockSnapshot | undefined {
  return useLiveQuery(() => loadStockSnapshot(db), []);
}

export function useSettings(): PosSettings | undefined {
  return useLiveQuery(() => loadSettings(db), []);
}

export function useCart(): CartItem[] | undefined {
  return useLiveQuery(() => loadCart(db), []);
}

const NO_SALES: DayTotals = {
  units: 0,
  revenue: 0,
  cogs: 0,
  grossProfit: 0,
  discountsByReason: [],
  totalDiscount: 0,
  saleCount: 0,
  voidedCount: 0,
};

/**
 * Today's numbers, keyed on the Asia/Bangkok business date. Never the UTC
 * date: a 06:00 Bangkok sale is the previous UTC day (CLAUDE.md §8).
 */
export function useTodayTotals(businessDate = bangkokDate(new Date().toISOString())): DayTotals {
  const totals = useLiveQuery(async () => {
    const sales = await db.sale.where('business_date').equals(businessDate).toArray();
    if (sales.length === 0) return NO_SALES;

    const saleIds = new Set(sales.map((sale) => sale.id));
    const lines = (await db.sale_line.toArray()).filter((line) => saleIds.has(line.sale_id));
    const lineIds = new Set(lines.map((line) => line.id));
    const discounts = (await db.sale_line_discount.toArray()).filter((discount) =>
      lineIds.has(discount.sale_line_id),
    );

    return dayTotals(sales, lines, discounts);
  }, [businessDate]);

  return totals ?? NO_SALES;
}

/** The day's sales for the list, newest first, voided ones included. */
export function useTodaySales(
  catalog: CostCatalog | undefined,
  businessDate = bangkokDate(new Date().toISOString()),
): SaleSummary[] | undefined {
  return useLiveQuery(
    async () => (catalog ? loadSalesForDate(catalog, businessDate, db) : []),
    [catalog, businessDate],
  );
}

/** This install's id, provisioned at startup by ensureDeviceId. */
export function useDeviceId(): string | undefined {
  return useLiveQuery(async () => {
    const setting = await db.setting.get(DEVICE_ID_KEY);
    return typeof setting?.value === 'string' ? setting.value : undefined;
  }, []);
}

/**
 * The open cash session: null when the day has not been opened, undefined
 * while IndexedDB is still answering. The app shows open day on null.
 */
export function useOpenSession(): CashSession | null | undefined {
  return useLiveQuery(() => loadOpenSession(db), []);
}

/** Who opened last, to pre-select on the open-day screen. */
export function useLastOperator(): string | null | undefined {
  return useLiveQuery(() => lastOperator(db), []);
}

/** What should be in the drawer, live — moves with every cash sale and void. */
export function useExpectedCash(session: CashSession): number | undefined {
  return useLiveQuery(() => loadExpectedCash(session, db), [session]);
}

/** A day's report by its session: null if there is no such session. */
export function useDaySummary(sessionId: string): DaySummary | null | undefined {
  return useLiveQuery(() => loadDaySummary(sessionId, db), [sessionId]);
}
