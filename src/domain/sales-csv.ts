/**
 * The year's sales as a spreadsheet, for the personal income tax filing
 * (ภ.ง.ด.94 at mid-year, ภ.ง.ด.90 at year end).
 *
 * The POS's whole job here is a defensible revenue total (CLAUDE.md §5): no
 * tax is worked out, no expense is claimed, nothing is sent anywhere. One
 * row per sale, voided ones included so the record reconciles with the
 * phone, and a column that is the sale's revenue — zero for a void — so a
 * plain SUM of it is the year's figure.
 */
import { bangkokTime } from '../lib/datetime.ts';
import type { Satang } from '../lib/money.ts';
import type { Sale, SaleLine } from '../db/types.ts';
import type { CostCatalog } from './cost.ts';

const HEADER = [
  'วันที่',
  'เวลา',
  'เลขที่บิล',
  'รายการ',
  'ชำระโดย',
  'ยอดก่อนลด',
  'ส่วนลด',
  'ยอดสุทธิ',
  'สถานะ',
  'เหตุผลยกเลิก',
  'นับเป็นรายได้',
];

export interface RevenuePeriods {
  /** January to June: what ภ.ง.ด.94 covers. */
  firstHalf: Satang;
  /** The whole year: ภ.ง.ด.90. */
  year: Satang;
}

/** The two figures a filing asks for. Voided sales never happened. */
export function revenuePeriods(sales: readonly Sale[], year: string): RevenuePeriods {
  const live = sales.filter((sale) => !sale.is_voided && sale.business_date.startsWith(`${year}-`));
  const midYear = `${year}-07-01`;
  return {
    firstHalf: live
      .filter((sale) => sale.business_date < midYear)
      .reduce((total, sale) => total + sale.total_net, 0),
    year: live.reduce((total, sale) => total + sale.total_net, 0),
  };
}

/**
 * The CSV text, byte-order mark included so Numbers and Excel read the Thai
 * as Thai. Oldest sale first, the order a ledger is read in.
 */
export function salesCsv(
  catalog: CostCatalog,
  sales: readonly Sale[],
  lines: readonly SaleLine[],
  year: string,
): string {
  const linesBySale = new Map<string, SaleLine[]>();
  for (const line of lines) {
    const list = linesBySale.get(line.sale_id);
    if (list) list.push(line);
    else linesBySale.set(line.sale_id, [line]);
  }

  const rows = sales
    .filter((sale) => sale.business_date.startsWith(`${year}-`))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((sale) => [
      sale.business_date,
      bangkokTime(sale.created_at),
      sale.id,
      (linesBySale.get(sale.id) ?? [])
        .map((line) => {
          const variant = catalog.variants.get(line.variant_id);
          const name = variant?.name_th ?? line.variant_id;
          return line.qty > 1 ? `${name} × ${line.qty}` : name;
        })
        .join(' · '),
      sale.payment_method === 'CASH' ? 'เงินสด' : 'พร้อมเพย์',
      baht(sale.total_gross),
      baht(sale.total_discount),
      baht(sale.total_net),
      sale.is_voided ? 'ยกเลิก' : 'ปกติ',
      sale.void_reason ?? '',
      baht(sale.is_voided ? 0 : sale.total_net),
    ]);

  return '﻿' + [HEADER, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function salesCsvFilename(year: string): string {
  return `rudu-sales-${year}.csv`;
}

/** Plain decimal baht, no symbol and no separators, so a spreadsheet sums it. */
function baht(satang: Satang): string {
  return (satang / 100).toFixed(2);
}

/** Quote a cell when it holds anything that would break a row. */
function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
