import { describe, expect, it } from 'vitest';
import {
  costSuggestions,
  monthSpend,
  orderMessage,
  orderTotal,
  previousMonth,
  receivingMovements,
} from '../purchasing.ts';
import type {
  PackagingItem,
  PurchaseItem,
  PurchaseOrder,
  PurchaseOrderLine,
  Supplier,
} from '../../db/types.ts';

const NOW = '2026-10-12T03:00:00.000Z';

const CUPS: PurchaseItem = {
  id: 'PI_CUPS',
  name_th: 'แก้ว 16oz',
  unit: 'แพ็ค',
  pack_size: 50,
  packaging_item_id: 'PKGI_CUP',
  default_supplier_id: 'SUP_A',
  last_unit_cost: 5_900,
  is_active: true,
  synced_at: null,
};
const TAMARIND: PurchaseItem = {
  ...CUPS,
  id: 'PI_TAMARIND',
  name_th: 'มะขามเปียก',
  unit: 'กก.',
  pack_size: null,
  packaging_item_id: null,
};
const ITEMS = new Map([CUPS, TAMARIND].map((item) => [item.id, item]));

const CUP_ITEM: PackagingItem = {
  id: 'PKGI_CUP',
  name_th: 'แก้วพลาสติก 16 oz',
  unit_cost: 118,
  is_stock_tracked: true,
  reorder_at: null,
  synced_at: null,
};

function line(id: string, itemId: string, ordered: number, received: number | null, cost: number) {
  return {
    id,
    purchase_order_id: 'PO1',
    purchase_item_id: itemId,
    qty_ordered: ordered,
    qty_received: received,
    unit_cost: cost,
    synced_at: null,
  } satisfies PurchaseOrderLine;
}

describe('orderTotal', () => {
  it('uses what arrived once received, what was asked for before', () => {
    expect(orderTotal([line('a', 'PI_CUPS', 10, null, 5_900)])).toBe(59_000);
    expect(
      orderTotal([line('a', 'PI_CUPS', 10, 8, 6_000), line('b', 'PI_TAMARIND', 2, 2.5, 8_000)]),
    ).toBe(68_000);
  });
});

describe('receivingMovements', () => {
  it('turns packs of packaging into pieces on the shelf, and adds nothing for tamarind', () => {
    const moves = receivingMovements(
      [line('a', 'PI_CUPS', 10, 8, 6_000), line('b', 'PI_TAMARIND', 2, 2, 8_000)],
      ITEMS,
      NOW,
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      packaging_item_id: 'PKGI_CUP',
      qty_delta: 400,
      reason: 'PURCHASE',
      purchase_order_line_id: 'a',
    });
  });
});

describe('costSuggestions', () => {
  it('offers the price per piece when it changed', () => {
    const suggestions = costSuggestions(
      [line('a', 'PI_CUPS', 10, 10, 6_250)],
      ITEMS,
      new Map([[CUP_ITEM.id, CUP_ITEM]]),
    );
    expect(suggestions).toEqual([
      { packagingItemId: 'PKGI_CUP', name: 'แก้วพลาสติก 16 oz', current: 118, suggested: 125 },
    ]);
  });

  it('says nothing when the price per piece is the same', () => {
    expect(
      costSuggestions(
        [line('a', 'PI_CUPS', 10, 10, 5_900)],
        ITEMS,
        new Map([[CUP_ITEM.id, CUP_ITEM]]),
      ),
    ).toEqual([]);
  });
});

describe('orderMessage', () => {
  it('reads as a message to the supplier', () => {
    const order: PurchaseOrder = {
      id: 'PO1',
      supplier_id: 'SUP_A',
      ordered_at: NOW,
      received_at: null,
      status: 'ORDERED',
      total_cost: 0,
      note: null,
      synced_at: null,
    };
    const supplier: Supplier = {
      id: 'SUP_A',
      name: 'ร้านป้าแดง',
      contact_note: null,
      is_active: true,
      synced_at: null,
    };
    const text = orderMessage(
      'ฤดูชา',
      order,
      [line('a', 'PI_CUPS', 10, null, 5_900), line('b', 'PI_TAMARIND', 2.5, null, 8_000)],
      ITEMS,
      supplier,
    );
    expect(text.split('\n')).toEqual([
      'สั่งของ ฤดูชา',
      'ถึง ร้านป้าแดง',
      '12 ต.ค. 2569 10:00',
      '',
      '- แก้ว 16oz 10 แพ็ค',
      '- มะขามเปียก 2.5 กก.',
    ]);
  });
});

describe('monthSpend', () => {
  const order = (
    id: string,
    status: PurchaseOrder['status'],
    receivedAt: string | null,
    total: number,
  ) =>
    ({
      id,
      supplier_id: 'SUP_A',
      ordered_at: NOW,
      received_at: receivedAt,
      status,
      total_cost: total,
      note: null,
      synced_at: null,
    }) satisfies PurchaseOrder;

  it('counts what arrived that Bangkok month, not what is waiting or cancelled', () => {
    const spend = monthSpend(
      '2026-10',
      [
        order('PO1', 'RECEIVED', '2026-10-05T03:00:00.000Z', 59_000),
        // 20:00 UTC on 30 Sep is 1 Oct in Bangkok.
        order('PO2', 'RECEIVED', '2026-09-30T20:00:00.000Z', 16_000),
        order('PO3', 'ORDERED', null, 99_000),
        order('PO4', 'CANCELLED', null, 99_000),
        order('PO5', 'RECEIVED', '2026-09-15T03:00:00.000Z', 1_000),
      ],
      [
        { ...line('a', 'PI_CUPS', 10, 10, 5_900), purchase_order_id: 'PO1' },
        { ...line('b', 'PI_TAMARIND', 2, 2, 8_000), purchase_order_id: 'PO2' },
      ],
      new Map([
        [
          'SUP_A',
          { id: 'SUP_A', name: 'ร้านป้าแดง', contact_note: null, is_active: true, synced_at: null },
        ],
      ]),
      ITEMS,
    );
    expect(spend.total).toBe(75_000);
    expect(spend.bySupplier).toEqual([{ supplierId: 'SUP_A', name: 'ร้านป้าแดง', total: 75_000 }]);
    expect(spend.byItem.map((entry) => [entry.name, entry.total])).toEqual([
      ['แก้ว 16oz', 59_000],
      ['มะขามเปียก', 16_000],
    ]);
  });

  it('knows the month before', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
  });
});
