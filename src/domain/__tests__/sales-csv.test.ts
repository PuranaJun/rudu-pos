import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RuduPosDB } from '../../db/database.ts';
import { loadCostCatalog } from '../../db/catalog.ts';
import { ensureSeeded } from '../../db/seed.ts';
import type { CostCatalog } from '../cost.ts';
import type { Sale, SaleLine } from '../../db/types.ts';
import { revenuePeriods, salesCsv, salesCsvFilename } from '../sales-csv.ts';

let db: RuduPosDB;
let catalog: CostCatalog;
const dbName = `rudu-csv-${crypto.randomUUID()}`;

beforeAll(async () => {
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterAll(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

function sale(id: string, date: string, time: string, overrides: Partial<Sale> = {}): Sale {
  return {
    id,
    created_at: `${date}T${time}:00.000Z`,
    business_date: date,
    operator_id: 'เจ้าของ',
    total_gross: 8_000,
    total_discount: 1_000,
    total_net: 7_000,
    total_cost: 1_400,
    payment_method: 'CASH',
    cash_received: 7_000,
    cash_change: 0,
    is_voided: false,
    void_reason: null,
    device_id: 'phone',
    synced_at: null,
    ...overrides,
  };
}

function line(saleId: string, variantId: string, qty: number): SaleLine {
  return {
    id: `${saleId}_${variantId}`,
    sale_id: saleId,
    variant_id: variantId,
    qty,
    unit_price: 4_000,
    line_discount: 0,
    discount_reason: null,
    unit_cost: 700,
    synced_at: null,
  };
}

const SALES = [
  sale('S2', '2026-08-01', '03:00', {
    payment_method: 'PROMPTPAY',
    total_net: 5_900,
    total_gross: 5_900,
    total_discount: 0,
  }),
  sale('S1', '2026-03-01', '02:00'),
  sale('S3', '2026-09-01', '04:00', {
    is_voided: true,
    void_reason: 'กดผิด, แล้ว "ลูกค้า" เปลี่ยนใจ',
  }),
  sale('S0', '2025-12-31', '05:00'),
];
const LINES = [
  line('S1', 'VAR_TAMARIND_ICED', 2),
  line('S2', 'VAR_PEAR_HOT', 1),
  line('S3', 'VAR_PEAR_ICED', 1),
  line('S0', 'VAR_TAMARIND_ICED', 1),
];

describe('the sales CSV', () => {
  const csv = () => salesCsv(catalog, SALES, LINES, '2026');
  const rows = () => csv().replace('﻿', '').trimEnd().split('\r\n');

  it('starts with a byte-order mark, so a spreadsheet reads the Thai as Thai', () => {
    expect(csv().startsWith('﻿')).toBe(true);
  });

  it('has one row per sale of that year, oldest first, voids included', () => {
    const body = rows().slice(1);
    expect(body).toHaveLength(3);
    expect(body.map((row) => row.split(',')[2])).toEqual(['S1', 'S2', 'S3']);
  });

  it('reads like a ledger: date, Bangkok time, items, method, amounts in plain baht', () => {
    // 02:00 UTC is 09:00 in Bangkok.
    expect(rows()[1]).toBe('2026-03-01,09:00,S1,มะขามแดง × 2,เงินสด,80.00,10.00,70.00,ปกติ,,70.00');
    expect(rows()[2]).toContain('สาลี่ขาว (ร้อน),พร้อมเพย์,59.00,0.00,59.00');
  });

  it('counts a void as nothing, and quotes a reason that would break the row', () => {
    expect(rows()[3]).toBe(
      '2026-09-01,11:00,S3,สาลี่ขาว (เย็น),เงินสด,80.00,10.00,70.00,ยกเลิก,"กดผิด, แล้ว ""ลูกค้า"" เปลี่ยนใจ",0.00',
    );
  });

  it('sums, in its last column, to the revenue the phone reports', () => {
    const counted = rows()
      .slice(1)
      .map((row) => Number(row.split(',').at(-1)))
      .reduce((total, value) => total + value, 0);
    expect(Math.round(counted * 100)).toBe(revenuePeriods(SALES, '2026').year);
  });

  it('is named for its year', () => {
    expect(salesCsvFilename('2026')).toBe('rudu-sales-2026.csv');
  });
});

describe('the figures a filing asks for', () => {
  it('gives January–June and the whole year, voids excluded, other years ignored', () => {
    expect(revenuePeriods(SALES, '2026')).toEqual({ firstHalf: 7_000, year: 12_900 });
  });
});
