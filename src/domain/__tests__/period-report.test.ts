import { beforeAll, describe, expect, it } from 'vitest';
import {
  addDays,
  periodReport,
  presetRange,
  wastePct,
  weekdayIndex,
  type PeriodInput,
} from '../period-report.ts';
import { buildCostCatalog, type CostCatalog } from '../cost.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  VARIANTS,
} from '../../data/legacy-seed-v9.ts';
import type {
  CashSession,
  ComponentBatch,
  Sale,
  SaleLine,
  SaleLineMod,
  StockMovement,
  WasteEvent,
} from '../../db/types.ts';

let catalog: CostCatalog;
beforeAll(() => {
  catalog = buildCostCatalog({
    products: PRODUCTS,
    variants: VARIANTS,
    components: COMPONENTS,
    bom: BOM_ROWS,
    packagingSets: PACKAGING_SETS,
    packagingItems: PACKAGING_ITEMS,
    modifiers: MODIFIERS,
  });
});

describe('periods', () => {
  it('knows the last 7 and 30 days, this month and last, across a year end', () => {
    expect(presetRange('LAST_7', '2026-10-12')).toEqual({ from: '2026-10-06', to: '2026-10-12' });
    expect(presetRange('LAST_30', '2026-10-12')).toEqual({ from: '2026-09-13', to: '2026-10-12' });
    expect(presetRange('THIS_MONTH', '2026-10-12')).toEqual({
      from: '2026-10-01',
      to: '2026-10-12',
    });
    expect(presetRange('LAST_MONTH', '2026-01-05')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('puts Monday first', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0); // a Monday
    expect(weekdayIndex('2026-10-17')).toBe(5); // Saturday
    expect(weekdayIndex('2026-10-18')).toBe(6); // Sunday
  });
});

function sale(id: string, date: string, utcTime: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id,
    created_at: `${date}T${utcTime}:00.000Z`,
    business_date: date,
    operator_id: 'เจ้าของ',
    total_gross: 4_000,
    total_discount: 0,
    total_net: 4_000,
    total_cost: 800,
    payment_method: 'CASH',
    cash_received: 4_000,
    cash_change: 0,
    order_no: 1,
    order_type: 'TAKEAWAY',
    handed_over_at: null,
    is_voided: false,
    void_reason: null,
    device_id: 'phone',
    synced_at: null,
    ...overrides,
  };
}

function line(id: string, saleId: string, variantId: string, qty: number, price = 4_000): SaleLine {
  return {
    id,
    sale_id: saleId,
    variant_id: variantId,
    qty,
    unit_price: price,
    line_discount: 0,
    discount_reason: null,
    unit_cost: 800,
    synced_at: null,
  };
}

const batch = (id: string, componentId: string): ComponentBatch => ({
  id,
  component_id: componentId,
  made_at: '2026-10-01T00:00:00.000Z',
  qty_made: 1000,
  state: 'READY',
  ready_at: '2026-10-01T00:00:00.000Z',
  expires_at: '2026-10-30T00:00:00.000Z',
  parent_batch_id: null,
  note: null,
  synced_at: null,
});

const used = (id: string, lineId: string, batchId: string, qty: number): StockMovement => ({
  id,
  sale_line_id: lineId,
  component_batch_id: batchId,
  qty_delta: -qty,
  reason: 'SALE',
  reverses_movement_id: null,
  created_at: '2026-10-10T03:00:00.000Z',
  synced_at: null,
});

// Two Saturdays and a Tuesday in the range, a sale the week before, and a void.
const SALES = [
  sale('SAT1_A', '2026-10-03', '03:00', { total_net: 8_000, order_type: 'DINE_IN' }),
  sale('SAT1_B', '2026-10-03', '03:30', { payment_method: 'PROMPTPAY', cash_received: null }),
  sale('TUE', '2026-10-06', '09:15'),
  sale('SAT2', '2026-10-10', '03:10', { total_net: 0, total_discount: 4_000 }),
  sale('VOID', '2026-10-10', '04:00', { is_voided: true, void_reason: 'กดผิด' }),
  sale('BEFORE', '2026-09-26', '03:00'),
];
const LINES = [
  line('L1', 'SAT1_A', 'VAR_TAMARIND_ICED', 2),
  line('L2', 'SAT1_B', 'VAR_PEAR_ICED', 1),
  line('L3', 'TUE', 'VAR_TAMARIND_ICED', 1),
  // A loyalty cup: a unit, no revenue.
  { ...line('L4', 'SAT2', 'VAR_TAMARIND_ICED', 1), line_discount: 4_000 },
  line('L5', 'VOID', 'VAR_PEAR_HOT', 5),
  line('L6', 'BEFORE', 'VAR_PEAR_ICED', 9),
];
const MODS: SaleLineMod[] = [
  {
    id: 'M1',
    sale_line_id: 'L1',
    modifier_id: 'MOD_BASIL_SEED',
    price_delta: 1_000,
    cost_delta: 0,
    synced_at: null,
  },
];
const SESSION: CashSession = {
  id: 'S_SAT2',
  opened_at: '2026-10-10T01:00:00.000Z',
  closed_at: '2026-10-10T10:00:00.000Z',
  operator_id: 'เจ้าของ',
  opening_float: 150_000,
  expected_cash: null,
  counted_cash: null,
  variance: null,
  note: null,
  synced_at: null,
};
const WASTE: WasteEvent[] = [
  {
    id: 'W1',
    component_batch_id: 'B_JELLY',
    qty_discarded: 30,
    reason: 'END_OF_DAY_PERISHABLE',
    recorded_at: '2026-10-10T10:00:00.000Z',
    note: null,
    cash_session_id: 'S_SAT2',
    cost: 450,
    synced_at: null,
  },
  {
    id: 'W_OLD',
    component_batch_id: 'B_JELLY',
    qty_discarded: 500,
    reason: 'EXPIRED',
    recorded_at: '2026-09-20T10:00:00.000Z',
    note: null,
    cash_session_id: null,
    cost: 7_500,
    synced_at: null,
  },
];

function input(): PeriodInput {
  return {
    catalog,
    range: { from: '2026-10-01', to: '2026-10-12' },
    sales: SALES,
    lines: LINES,
    mods: MODS,
    discounts: [],
    movements: [
      used('U1', 'L1', 'B_JELLY', 60),
      used('U3', 'L3', 'B_JELLY', 30),
      used('U4', 'L4', 'B_JELLY', 30),
      used('U5', 'L5', 'B_JELLY', 999), // voided: not usage
    ],
    waste: WASTE,
    batches: [batch('B_JELLY', 'COMP_JELLY_CHRYS')],
    sessions: [SESSION],
  };
}

describe('periodReport', () => {
  it('adds up the period, voids and other weeks left out, the free cup a unit worth nothing', () => {
    const report = periodReport(input());
    expect(report.totals).toMatchObject({
      units: 5,
      revenue: 16_000,
      saleCount: 4,
      voidedCount: 1,
    });
    expect(report.tradingDays).toBe(3);
    expect(report.revenuePerDay).toBe(5_333);
    expect(report.cupsPerBill).toBe(1.25);
    expect(report.revenuePerBill).toBe(4_000);
  });

  it('ranks what sold, by variant', () => {
    expect(periodReport(input()).bestSellers.map((b) => [b.variantId, b.units, b.revenue])).toEqual(
      [
        ['VAR_TAMARIND_ICED', 4, 12_000],
        ['VAR_PEAR_ICED', 1, 4_000],
      ],
    );
  });

  it('averages each weekday over the days traded on it', () => {
    const report = periodReport(input());
    expect(report.byWeekday).toHaveLength(7);
    expect(report.byWeekday[5]).toMatchObject({
      label: 'เสาร์',
      days: 2,
      revenue: 12_000,
      perDay: 6_000,
    });
    expect(report.byWeekday[1]).toMatchObject({ label: 'อังคาร', days: 1, perDay: 4_000 });
    expect(report.byWeekday[0]).toMatchObject({ days: 0, perDay: 0 });
  });

  it('counts cups by the Bangkok hour, with the quiet hours in between', () => {
    // 03:xx UTC is 10:xx in Bangkok; 09:15 UTC is 16:15.
    const hours = periodReport(input()).byHour;
    expect(hours[0]).toEqual({ hour: 10, cups: 4 });
    expect(hours.at(-1)).toEqual({ hour: 16, cups: 1 });
    expect(hours).toHaveLength(7);
    expect(hours.find((h) => h.hour === 13)?.cups).toBe(0);
  });

  it('splits dine-in from takeaway and cash from PromptPay', () => {
    const report = periodReport(input());
    expect(report.orderTypes).toEqual({ TAKEAWAY: 3, DINE_IN: 1 });
    expect(report.payments).toEqual({ CASH: 3, PROMPTPAY: 1 });
  });

  it('gives each paid topping’s take-up against the cups it could have gone on', () => {
    const basil = periodReport(input()).attach.find((a) => a.modifierId === 'MOD_BASIL_SEED')!;
    expect(basil).toMatchObject({ attached: 2, eligible: 4 });
  });

  it('puts waste against what left the shelf, by the day it was thrown away', () => {
    const report = periodReport(input());
    expect(report.wasteCost).toBe(450);
    const jelly = report.waste.find((w) => w.componentId === 'COMP_JELLY_CHRYS')!;
    expect(jelly).toMatchObject({ wasted: 30, used: 120 });
    expect(wastePct(jelly)).toBeCloseTo(0.2);
  });
});

describe('count gap', () => {
  const adjust = (id: string, qty: number, at: string): StockMovement => ({
    id,
    sale_line_id: null,
    component_batch_id: 'B_JELLY',
    qty_delta: qty,
    reason: 'ADJUSTMENT',
    reverses_movement_id: null,
    created_at: at,
    synced_at: null,
  });

  it('sums what the counts corrected, in range, against what sales used', () => {
    const report = periodReport({
      ...input(),
      adjustments: [
        adjust('A1', -24, '2026-10-10T11:00:00.000Z'), // counted 24 g short at close
        adjust('A2', 6, '2026-10-11T01:00:00.000Z'), // 6 g over at open
        adjust('A3', -500, '2026-09-20T11:00:00.000Z'), // another month
      ],
    });
    expect(report.countGap).toEqual([
      {
        componentId: 'COMP_JELLY_CHRYS',
        name: expect.any(String),
        unit: 'G',
        gap: -18,
        used: 120,
        cost: Math.round(-18 * 0.0136667 * 100),
      },
    ]);
  });

  it('is empty when the counts matched the recipes', () => {
    expect(periodReport(input()).countGap).toEqual([]);
    expect(
      periodReport({
        ...input(),
        adjustments: [
          adjust('A1', -5, '2026-10-10T11:00:00.000Z'),
          adjust('A2', 5, '2026-10-11T01:00:00.000Z'),
        ],
      }).countGap,
    ).toEqual([]);
  });
});

describe('void log', () => {
  it('lists every voided bill in range, with who, why and when', () => {
    const report = periodReport({
      ...input(),
      sales: [
        ...SALES.filter((s) => s.id !== 'VOID'),
        sale('VOID', '2026-10-10', '04:00', {
          is_voided: true,
          void_reason: 'กดผิด',
          voided_at: '2026-10-10T05:30:00.000Z',
        }),
        sale('VOID_OLD', '2026-09-20', '04:00', { is_voided: true, void_reason: 'นอกช่วง' }),
        sale('VOID_B', '2026-10-11', '04:00', {
          is_voided: true,
          void_reason: 'ลูกค้าเปลี่ยนใจ',
          operator_id: 'น้อง',
          total_net: 5_900,
        }),
      ],
    });
    expect(report.voids.map((v) => [v.saleId, v.reason, v.voidedAt, v.operator])).toEqual([
      ['VOID', 'กดผิด', '2026-10-10T05:30:00.000Z', 'เจ้าของ'],
      ['VOID_B', 'ลูกค้าเปลี่ยนใจ', null, 'น้อง'],
    ]);
    expect(report.voidsByOperator).toEqual([
      { operator: 'น้อง', count: 1, amount: 5_900 },
      { operator: 'เจ้าของ', count: 1, amount: 4_000 },
    ]);
  });
});
