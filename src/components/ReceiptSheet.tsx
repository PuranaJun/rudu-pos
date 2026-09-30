import { formatTHB } from '../lib/money.ts';
import { formatBangkok } from '../lib/datetime.ts';
import { DISCOUNT_REASON_TH } from '../domain/promotions.ts';
import { ScreenFooter, type BackTo } from './Screen.tsx';
import type { DiscountReason } from '../db/types.ts';
import type { Receipt } from '../db/sale-repo.ts';

interface Props {
  receipt: Receipt;
  back: BackTo;
  /** Set when the bill was voided afterwards: said above everything else. */
  voidReason?: string | null | undefined;
}

/**
 * A receipt, shown only when asked for.
 *
 * Receipts are rarely wanted, so nothing prompts for one — it opens from the
 * completed-sale line and from the day's bills (CLAUDE.md §5).
 *
 * Laid out as the customer reads it, shop name on top, so it is the one
 * screen without the usual title. The way out is where it always is.
 *
 * There is no VAT line and there is no tax arithmetic, because the shop is not
 * VAT registered. The price is simply the price.
 */
export default function ReceiptSheet({ receipt, back, voidReason = null }: Props) {
  return (
    <div
      role="dialog"
      aria-label="ใบเสร็จ"
      className="safe-x fixed inset-0 z-30 flex flex-col bg-white text-ink"
    >
      <div className="safe-top min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {voidReason !== null ? (
          <p
            role="alert"
            className="bg-expired mt-3 rounded-xl px-4 py-3 text-xl font-bold text-white"
          >
            บิลนี้ยกเลิกแล้ว — {voidReason}
          </p>
        ) : null}
        <div className="py-4 text-center">
          <h1 className="text-3xl font-bold">ฤดูชา</h1>
          {receipt.brandingLineTh ? (
            <p className="text-ink-soft text-lg font-bold">{receipt.brandingLineTh}</p>
          ) : null}
          <p className="text-ink-soft mt-1 text-base font-bold">
            {formatBangkok(receipt.createdAt)}
          </p>
        </div>

        <ul className="border-line border-t">
          {receipt.lines.map((line, index) => (
            <li key={index} className="border-line border-b py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xl font-bold">
                  {line.name} × {line.qty}
                </span>
                <span className="text-xl font-bold tabular-nums">{formatTHB(line.net)}</span>
              </div>
              {line.modifiers.length > 0 ? (
                <p className="text-ink-soft text-base font-bold">{line.modifiers.join(' · ')}</p>
              ) : null}
              {line.discounts.map((discount, discountIndex) => (
                <p key={discountIndex} className="flex justify-between text-base font-bold">
                  <span>
                    {DISCOUNT_REASON_TH[discount.label as DiscountReason] ?? discount.label}
                  </span>
                  <span className="tabular-nums">−{formatTHB(discount.amount)}</span>
                </p>
              ))}
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1 text-lg font-bold">
          <div className="flex justify-between">
            <dt>รวม</dt>
            <dd className="tabular-nums">{formatTHB(receipt.totalGross)}</dd>
          </div>
          {receipt.totalDiscount > 0 ? (
            <div className="flex justify-between">
              <dt>ส่วนลด</dt>
              <dd className="tabular-nums">−{formatTHB(receipt.totalDiscount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-2xl font-bold">
            <dt>สุทธิ</dt>
            <dd className="tabular-nums">{formatTHB(receipt.totalNet)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>ชำระโดย</dt>
            <dd>{receipt.paymentMethod === 'CASH' ? 'เงินสด' : 'พร้อมเพย์'}</dd>
          </div>
          {receipt.cashReceived !== null ? (
            <>
              <div className="flex justify-between">
                <dt>รับเงิน</dt>
                <dd className="tabular-nums">{formatTHB(receipt.cashReceived)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>เงินทอน</dt>
                <dd className="tabular-nums">{formatTHB(receipt.cashChange ?? 0)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      <ScreenFooter back={back} />
    </div>
  );
}
