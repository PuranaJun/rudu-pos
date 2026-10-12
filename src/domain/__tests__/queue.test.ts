import { describe, expect, it } from 'vitest';
import { handedOverOrders, legacySalePatches, nextOrderNo, waitingOrders } from '../queue.ts';
import type { Sale } from '../../db/types.ts';

function sale(id: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id,
    created_at: '2026-10-12T03:00:00.000Z',
    business_date: '2026-10-12',
    operator_id: 'เจ้าของ',
    total_gross: 4_000,
    total_discount: 0,
    total_net: 4_000,
    total_cost: 700,
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

describe('nextOrderNo', () => {
  it('starts the day at 1', () => {
    expect(nextOrderNo([])).toBe(1);
  });

  it('follows the highest number, voided ones included — a called number is never reused', () => {
    expect(
      nextOrderNo([
        sale('A', { order_no: 1 }),
        sale('B', { order_no: 3, is_voided: true }),
        sale('C', { order_no: 2 }),
      ]),
    ).toBe(4);
  });
});

describe('the queue', () => {
  const sales = [
    sale('LATE', { order_no: 3 }),
    sale('EARLY', { order_no: 1 }),
    sale('GONE', { order_no: 2, handed_over_at: '2026-10-12T03:05:00.000Z' }),
    sale('VOID', { order_no: 4, is_voided: true }),
    sale('GONE_LATER', { order_no: 5, handed_over_at: '2026-10-12T03:09:00.000Z' }),
  ];

  it('waits on paid, live, not handed over orders, oldest number first', () => {
    expect(waitingOrders(sales).map((s) => s.id)).toEqual(['EARLY', 'LATE']);
  });

  it('keeps a voided order out of both lists', () => {
    expect(handedOverOrders(sales).map((s) => s.id)).toEqual(['GONE_LATER', 'GONE']);
  });
});

describe('legacySalePatches', () => {
  const old = (id: string, date: string, time: string) => ({
    id,
    business_date: date,
    created_at: `${date}T${time}:00.000Z`,
  });

  it('numbers old sales per business date in the order they were rung, as handed over takeaway', () => {
    const patches = legacySalePatches([
      old('B', '2026-10-01', '05:00'),
      old('A', '2026-10-01', '03:00'),
      old('C', '2026-10-02', '04:00'),
    ]);
    expect(patches).toEqual([
      {
        id: 'A',
        changes: {
          order_no: 1,
          order_type: 'TAKEAWAY',
          handed_over_at: '2026-10-01T03:00:00.000Z',
        },
      },
      {
        id: 'B',
        changes: {
          order_no: 2,
          order_type: 'TAKEAWAY',
          handed_over_at: '2026-10-01T05:00:00.000Z',
        },
      },
      {
        id: 'C',
        changes: {
          order_no: 1,
          order_type: 'TAKEAWAY',
          handed_over_at: '2026-10-02T04:00:00.000Z',
        },
      },
    ]);
  });

  it('leaves numbered sales alone and numbers old ones after them', () => {
    const patches = legacySalePatches([
      sale('NEW', { business_date: '2026-10-01', order_no: 4 }),
      old('OLD', '2026-10-01', '01:00'),
    ]);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ id: 'OLD', changes: { order_no: 5 } });
  });
});
