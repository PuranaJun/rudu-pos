import { formatTHB } from '../lib/money.ts';
import type { Satang } from '../lib/money.ts';

interface Props {
  due: Satang;
  qrImage: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}

/**
 * PromptPay.
 *
 * There is no gateway and no callback. The customer scans a static QR and
 * shows their phone, and the **operator** decides the money arrived. The app
 * never polls, never waits, and never claims to have verified anything
 * (CLAUDE.md §4) — which is why the button says the operator checked, not that
 * the payment succeeded.
 */
export default function PromptPayPanel({ due, qrImage, onConfirm, onCancel, busy }: Props) {
  return (
    <div className="safe-x fixed inset-0 z-20 flex flex-col bg-white text-ink">
      <header className="safe-top border-line flex items-center justify-between border-b px-4 pb-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-touch-lg min-w-touch-lg text-ink-soft pr-3 text-xl font-bold"
        >
          ← กลับ
        </button>
        <p className="text-4xl font-bold tabular-nums">{formatTHB(due)}</p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
        {qrImage ? (
          <img
            src={qrImage}
            alt="PromptPay QR"
            className="max-h-[60vh] w-auto max-w-full rounded-2xl"
          />
        ) : (
          <div className="border-line flex flex-col items-center gap-2 rounded-2xl border-4 border-dashed p-8 text-center">
            <p className="text-3xl font-bold">ใช้ QR ที่พิมพ์ไว้</p>
            <p className="text-ink-soft text-lg font-bold">ยังไม่ได้ใส่รูป QR ในตั้งค่า</p>
          </div>
        )}
      </div>

      <footer className="safe-bottom border-line border-t px-4 pt-3">
        <p className="mb-2 text-center text-lg font-bold">
          ⚠ ระบบไม่ได้ตรวจสอบการโอน — ดูสลิปในมือถือลูกค้าก่อนกด
        </p>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="bg-ink min-h-touch-lg text-paper w-full rounded-2xl py-5 text-3xl font-bold active:brightness-90 disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line"
        >
          ลูกค้าจ่ายแล้ว
        </button>
      </footer>
    </div>
  );
}
