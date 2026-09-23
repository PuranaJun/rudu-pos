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
import type { Satang } from '../lib/money.ts';
import { bangkokDate } from '../lib/datetime.ts';
import { DEVICE_ID_KEY } from './device.ts';
import { loadSettings, type PosSettings } from './settings-repo.ts';

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

export interface TodayTotals {
  units: number;
  revenue: Satang;
}

/**
 * Today's takings, keyed on the Asia/Bangkok business date.
 *
 * Voided sales are excluded, and so are zero-price loyalty lines — they count
 * as a unit and land in COGS, but never in revenue (CLAUDE.md §4).
 */
export function useTodayTotals(businessDate = bangkokDate(new Date().toISOString())): TodayTotals {
  const totals = useLiveQuery(async () => {
    const sales = (await db.sale.where('business_date').equals(businessDate).toArray()).filter(
      (sale) => !sale.is_voided,
    );
    if (sales.length === 0) return { units: 0, revenue: 0 };

    const saleIds = new Set(sales.map((sale) => sale.id));
    const lines = (await db.sale_line.toArray()).filter((line) => saleIds.has(line.sale_id));

    return {
      units: lines.reduce((total, line) => total + line.qty, 0),
      revenue: sales.reduce((total, sale) => total + sale.total_net, 0),
    };
  }, [businessDate]);

  return totals ?? { units: 0, revenue: 0 };
}

/** This install's id, provisioned at startup by ensureDeviceId. */
export function useDeviceId(): string | undefined {
  return useLiveQuery(async () => {
    const setting = await db.setting.get(DEVICE_ID_KEY);
    return typeof setting?.value === 'string' ? setting.value : undefined;
  }, []);
}

/** The operator chosen at open day. Until step 7 exists, the first one listed. */
export function useOperator(): string {
  const operator = useLiveQuery(async () => {
    const setting = await db.setting.get('operators');
    return Array.isArray(setting?.value) ? String(setting.value[0] ?? '') : '';
  }, []);

  return operator ?? '';
}
