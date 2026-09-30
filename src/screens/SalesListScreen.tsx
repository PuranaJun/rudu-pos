import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import ReceiptSheet from '../components/ReceiptSheet.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { formatTHB } from '../lib/money.ts';
import { bangkokTime } from '../lib/datetime.ts';
import { breakeven, EMPTY_DAY_TOTALS } from '../domain/reporting.ts';
import { useCostCatalog, useSessionTotals, useSettings, useTodaySales } from '../db/hooks.ts';
import { sessionBusinessDate } from '../db/session-repo.ts';
import { voidSale } from '../db/stock-repo.ts';
import { loadReceipt, type Receipt } from '../db/sale-repo.ts';
import type { CashSession } from '../db/types.ts';

/**
 * บิลวันนี้ — the day's bills, newest first.
 *
 * There is no edit here and there never will be. A mistake is voided with a
 * reason and re-rung, which restores every component it deducted and leaves a
 * record of what happened (CLAUDE.md §10). A voided bill stays in the list,
 * struck through, saying why.
 *
 * Any bill's receipt is here too, for the customer who comes back for one —
 * the sell screen only offers it until the next drink is tapped.
 */
export default function SalesListScreen({ session, back }: { session: CashSession; back: BackTo }) {
  const catalog = useCostCatalog();
  const settings = useSettings();
  const sales = useTodaySales(catalog, sessionBusinessDate(session));
  const totals = useSessionTotals(session) ?? EMPTY_DAY_TOTALS;

  const [voiding, setVoiding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ receipt: Receipt; voidReason: string | null } | null>(
    null,
  );

  const even = settings
    ? breakeven(totals, settings.fixedCostPerDay, settings.breakevenCups)
    : null;

  function confirmVoid(saleId: string, reason: string) {
    setVoiding(null);
    setError(null);
    voidSale(saleId, reason).catch((cause: unknown) =>
      setError(`ยกเลิกบิลไม่สำเร็จ: ${String(cause)}`),
    );
  }

  function showReceipt(saleId: string) {
    if (!catalog || !settings) return;
    setError(null);
    loadReceipt(catalog, saleId, settings.brandingLineTh)
      .then((found) => (found ? setReceipt(found) : setError('ไม่พบบิลนี้')))
      .catch((cause: unknown) => setError(`เปิดใบเสร็จไม่สำเร็จ: ${String(cause)}`));
  }

  return (
    <Screen
      title="บิลวันนี้"
      subtitle={
        <>
          {totals.units} แก้ว · {totals.saleCount} บิล
          {totals.voidedCount > 0 ? ` · ยกเลิก ${totals.voidedCount}` : ''}
        </>
      }
      aside={<p className="text-3xl font-bold tabular-nums">{formatTHB(totals.revenue)}</p>}
      below={
        even ? (
          <p className="text-lg font-bold tabular-nums">
            กำไรขั้นต้น {formatTHB(even.grossProfit)} จาก {formatTHB(even.fixedCost)}
            {even.past ? ' · ผ่านจุดคุ้มทุน' : ''}
          </p>
        ) : null
      }
    >
      <ScreenBody>
        {!sales ? null : sales.length === 0 ? (
          <p className="text-ink-soft py-8 text-center text-lg font-bold">ยังไม่มีบิลวันนี้</p>
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
                  <p className="bg-paper-sunk mt-2 rounded-xl px-3 py-2 text-lg font-bold">
                    ยกเลิกแล้ว — {sale.voidReason}
                  </p>
                ) : null}

                {voiding === sale.id ? (
                  <div className="border-expired mt-2 rounded-xl border-2 p-3">
                    <p className="text-xl font-bold">ยกเลิกบิลนี้เพราะอะไร?</p>
                    <p className="text-lg font-bold">แตะเหตุผล — ของจะคืนเข้าสต็อก</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setVoiding(null)}>
                        ไม่ยกเลิกบิล
                      </Button>
                      {(settings?.voidReasons ?? []).map((reason) => (
                        <Button
                          key={reason}
                          variant="danger"
                          size="sm"
                          onClick={() => confirmVoid(sale.id, reason)}
                        >
                          {reason}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => showReceipt(sale.id)}
                      aria-label={`ใบเสร็จ ${bangkokTime(sale.createdAt)}`}
                    >
                      ใบเสร็จ
                    </Button>
                    {sale.isVoided ? null : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setVoiding(sale.id)}
                        aria-label={`ยกเลิกบิล ${bangkokTime(sale.createdAt)}`}
                      >
                        ยกเลิกบิล
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </ScreenBody>

      <ScreenFooter back={back}>
        {error ? (
          <p
            role="alert"
            className="bg-expired mb-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
          >
            {error}
          </p>
        ) : null}
      </ScreenFooter>

      {receipt ? (
        <ReceiptSheet
          receipt={receipt.receipt}
          voidReason={receipt.voidReason}
          back={{ label: 'กลับไปบิลวันนี้', onClick: () => setReceipt(null) }}
        />
      ) : null}
    </Screen>
  );
}
