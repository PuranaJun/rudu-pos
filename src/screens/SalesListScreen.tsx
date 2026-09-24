import { useState } from 'react';
import { formatTHB } from '../lib/money.ts';
import { bangkokTime } from '../lib/datetime.ts';
import type { SaleSummary } from '../db/sale-repo.ts';
import type { Breakeven, DayTotals } from '../domain/reporting.ts';

interface Props {
  sales: SaleSummary[];
  totals: DayTotals;
  breakeven?: Breakeven;
  voidReasons: readonly string[];
  onVoid: (saleId: string, reason: string) => void;
  onClose: () => void;
  /** Close day lives here, beside the day's sales — off the sell screen, one tap away. */
  onCloseDay?: () => void;
  /** Past days' summaries and the year's takings. */
  onReports?: () => void;
  onSettings?: () => void;
}

/**
 * The day's sales, newest first.
 *
 * There is no edit here and there never will be. A mistake is voided with a
 * reason and re-rung, which restores every component it deducted and leaves a
 * record of what happened (CLAUDE.md §10). A voided sale stays in the list,
 * struck through, saying why.
 */
export default function SalesListScreen({
  sales,
  totals,
  breakeven,
  voidReasons,
  onVoid,
  onClose,
  onCloseDay,
  onReports,
  onSettings,
}: Props) {
  const [voiding, setVoiding] = useState<string | null>(null);

  return (
    <div
      role="dialog"
      aria-label="รายการขายวันนี้"
      className="safe-x text-ink fixed inset-0 z-20 flex flex-col bg-white"
    >
      <header className="safe-top border-line border-b px-4 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-bold">รายการขายวันนี้</p>
          <p className="text-3xl font-bold tabular-nums">{formatTHB(totals.revenue)}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-ink-soft text-base font-bold">
            {totals.units} แก้ว · {totals.saleCount} บิล
            {totals.voidedCount > 0 ? ` · ยกเลิก ${totals.voidedCount}` : ''}
          </p>
          <div className="flex gap-2">
            {onReports ? (
              <button
                type="button"
                onClick={onReports}
                className="border-line min-h-touch rounded-xl border-2 px-3 text-lg font-bold"
              >
                ย้อนหลัง
              </button>
            ) : null}
            {onSettings ? (
              <button
                type="button"
                onClick={onSettings}
                className="border-line min-h-touch rounded-xl border-2 px-3 text-lg font-bold"
              >
                ตั้งค่า
              </button>
            ) : null}
          </div>
        </div>
        {breakeven ? (
          <p className="text-lg font-bold tabular-nums">
            กำไรขั้นต้น {formatTHB(breakeven.grossProfit)} จาก {formatTHB(breakeven.fixedCost)}
            {breakeven.past ? ' · ผ่านจุดคุ้มทุน' : ''}
          </p>
        ) : null}
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4">
        {sales.length === 0 ? (
          <p className="text-ink-soft py-8 text-center text-lg font-bold">ยังไม่มีการขายวันนี้</p>
        ) : (
          <ul>
            {sales.map((sale) => (
              <li key={sale.id} className="border-line border-b py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tabular-nums">
                    {bangkokTime(sale.createdAt)}
                  </span>
                  <span
                    className={`text-xl font-bold tabular-nums ${
                      sale.isVoided ? 'text-ink-soft line-through' : ''
                    }`}
                  >
                    {formatTHB(sale.totalNet)}
                  </span>
                </div>

                <p className={`text-lg font-bold ${sale.isVoided ? 'line-through' : ''}`}>
                  {sale.items}
                </p>
                <p className="text-ink-soft text-base font-bold">
                  {sale.paymentMethod === 'CASH' ? 'เงินสด' : 'พร้อมเพย์'}
                </p>

                {sale.isVoided ? (
                  <p className="mt-1 text-lg font-bold">ยกเลิกแล้ว — {sale.voidReason}</p>
                ) : voiding === sale.id ? (
                  <div className="mt-2">
                    <p className="text-lg font-bold">ยกเลิกเพราะอะไร?</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {voidReasons.map((reason) => (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => {
                            setVoiding(null);
                            onVoid(sale.id, reason);
                          }}
                          className="bg-brand text-paper min-h-touch rounded-xl px-4 text-lg font-bold"
                        >
                          {reason}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => setVoiding(null)}
                        className="border-line min-h-touch rounded-xl border-2 px-4 text-lg font-bold"
                      >
                        ไม่ยกเลิก
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setVoiding(sale.id)}
                    aria-label={`ยกเลิกบิล ${bangkokTime(sale.createdAt)}`}
                    className="border-line min-h-touch mt-2 rounded-xl border-2 px-4 text-lg font-bold"
                  >
                    ยกเลิกบิล
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      <footer className="safe-bottom border-line flex gap-2 border-t px-4 pt-3">
        {onCloseDay ? (
          <button
            type="button"
            onClick={onCloseDay}
            className="border-line min-h-touch-lg rounded-2xl border-2 px-5 text-xl font-bold"
          >
            ปิดร้าน
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="bg-ink text-paper min-h-touch-lg flex-1 rounded-2xl py-4 text-2xl font-bold"
        >
          กลับไปขาย
        </button>
      </footer>
    </div>
  );
}
