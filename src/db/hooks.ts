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
import { STORAGE_NOTE_KEY } from './storage-note.ts';
import { loadSettings, type PosSettings } from './settings-repo.ts';
import { loadSalesForDate, type SaleSummary } from './sale-repo.ts';
import type { ClosedDay, DayTotals, DaySummary } from '../domain/reporting.ts';
import { loadAnnualRevenue, loadClosedDays, loadSessionTotals } from './report-repo.ts';
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

/**
 * The open session's cups, revenue and gross profit, live: every sale and
 * every void repaints it. Never keyed on the UTC date (CLAUDE.md §8).
 */
export function useSessionTotals(session: CashSession): DayTotals | undefined {
  return useLiveQuery(() => loadSessionTotals(session, db), [session]);
}

/** A Bangkok calendar year's takings, live. */
export function useAnnualRevenue(year: string): number | undefined {
  return useLiveQuery(() => loadAnnualRevenue(year, db), [year]);
}

/** Every closed day, newest first, for the reports list. */
export function useClosedDays(): ClosedDay[] | undefined {
  return useLiveQuery(() => loadClosedDays(db), []);
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

/** True while the "storage is not guaranteed" note is waiting to be read. */
export function useStorageNote(): boolean {
  const value = useLiveQuery(async () => (await db.setting.get(STORAGE_NOTE_KEY))?.value, []);
  return value === 'PENDING';
}
