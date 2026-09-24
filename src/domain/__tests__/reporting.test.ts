import { describe, expect, it } from 'vitest';
import { annualRevenue, breakeven, closedDays, dayTotals, revenueBand } from '../reporting.ts';
import type { CashSession, Sale, SaleLine, WasteEvent } from '../../db/types.ts';

function sale(id: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id,
    created_at: '2026-09-23T02:00:00.000Z',
    business_date: '2026-09-23',
    operator_id: 'เจ้าของ',
    total_gross: 4000,
    total_discount: 0,
    total_net: 4000,
    total_cost: 700,
    payment_method: 'CASH',
    cash_received: 4000,
    cash_change: 0,
    is_voided: false,
    void_reason: null,
    device_id: 'test',
    synced_at: null,
    ...overrides,
  };
}

function line(id: string, saleId: string, qty: number): SaleLine {
  return {
    id,
    sale_id: saleId,
    variant_id: 'VAR_TAMARIND_ICED',
    qty,
    unit_price: 4000,
    line_discount: 0,
    discount_reason: null,
    unit_cost: 700,
    synced_at: null,
  };
}

function session(id: string, openedAt: string, closedAt: string | null): CashSession {
  return {
    id,
    opened_at: openedAt,
    closed_at: closedAt,
    operator_id: 'เจ้าของ',
    opening_float: 150_000,
    expected_cash: null,
    counted_cash: null,
    variance: closedAt ? -500 : null,
    note: null,
    synced_at: null,
  };
}

describe('the breakeven marker', () => {
  it('counts cups against ten and gross profit against the fixed cost', () => {
    const totals = dayTotals(
      [sale('S1', { total_net: 40_000, total_cost: 5_000 })],
      [line('L1', 'S1', 10)],
    );

    // ฿350 gross profit against ฿370: ten cups, and still not there.
    expect(breakeven(totals, 37_000, 10)).toEqual({
      cups: 10,
      cupsTarget: 10,
      grossProfit: 35_000,
      afterWaste: 35_000,
      fixedCost: 37_000,
      past: false,
    });
    expect(breakeven(totals, 30_000, 10).past).toBe(true);
  });

  it('takes the waste off once it is known', () => {
    const totals = dayTotals([sale('S1', { total_net: 50_000, total_cost: 5_000 })], []);
    expect(breakeven(totals, 37_000, 10).past).toBe(true);
    expect(breakeven(totals, 37_000, 10, 9_000)).toMatchObject({ afterWaste: 36_000, past: false });
  });
});

describe('the year against the VAT threshold', () => {
  const threshold = 180_000_000;

  it('is quiet well short, warns from three-quarters, and says so once over', () => {
    expect(revenueBand(100_000_000, threshold, 0.75)).toBe('OK');
    expect(revenueBand(135_000_000, threshold, 0.75)).toBe('NEAR');
    expect(revenueBand(180_000_000, threshold, 0.75)).toBe('OVER');
  });

  it('adds up the Bangkok year and nothing else, voids excluded', () => {
    const sales = [
      sale('A', { business_date: '2026-01-01', total_net: 1_000 }),
      sale('B', { business_date: '2026-12-31', total_net: 2_000 }),
      sale('C', { business_date: '2025-12-31', total_net: 4_000 }),
      sale('D', { business_date: '2026-06-01', total_net: 8_000, is_voided: true }),
    ];
    expect(annualRevenue(sales, '2026')).toBe(3_000);
  });
});

describe('the list of closed days', () => {
  it('has one line per closed day, newest first, with its takings, cups and waste', () => {
    const monday = session('MON', '2026-09-21T01:00:00.000Z', '2026-09-21T13:00:00.000Z');
    const tuesday = session('TUE', '2026-09-22T01:00:00.000Z', '2026-09-22T13:00:00.000Z');
    const today = session('WED', '2026-09-23T01:00:00.000Z', null);

    const sales = [
      sale('M1', { business_date: '2026-09-21', created_at: '2026-09-21T02:00:00.000Z' }),
      sale('T1', { business_date: '2026-09-22', created_at: '2026-09-22T02:00:00.000Z' }),
      sale('T2', {
        business_date: '2026-09-22',
        created_at: '2026-09-22T03:00:00.000Z',
        total_net: 5_900,
      }),
      sale('T3', {
        business_date: '2026-09-22',
        created_at: '2026-09-22T04:00:00.000Z',
        is_voided: true,
      }),
    ];
    const lines = [
      line('LM1', 'M1', 1),
      line('LT1', 'T1', 2),
      line('LT2', 'T2', 1),
      line('LT3', 'T3', 5),
    ];
    const waste: WasteEvent[] = [
      {
        id: 'W1',
        component_batch_id: 'B',
        qty_discarded: 300,
        reason: 'END_OF_DAY_PERISHABLE',
        recorded_at: '2026-09-22T13:00:00.000Z',
        note: null,
        cash_session_id: 'TUE',
        cost: 2_100,
        synced_at: null,
      },
    ];

    expect(closedDays([monday, today, tuesday], sales, lines, waste)).toEqual([
      {
        sessionId: 'TUE',
        businessDate: '2026-09-22',
        revenue: 9_900,
        units: 3,
        wasteCost: 2_100,
        variance: -500,
      },
      {
        sessionId: 'MON',
        businessDate: '2026-09-21',
        revenue: 4_000,
        units: 1,
        wasteCost: 0,
        variance: -500,
      },
    ]);
  });
});
