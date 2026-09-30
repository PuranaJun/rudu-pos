import { formatTHB } from '../lib/money.ts';
import type { Satang } from '../lib/money.ts';
import { Screen, ScreenBody, ScreenFooter } from './Screen.tsx';

interface Props {
  due: Satang;
  qrImage: string | null;
  onConfirm: () => void;
  /** Back to the sell screen, cart intact. */
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
    <Screen
      title="จ่ายด้วย QR"
      aside={<p className="text-4xl font-bold tabular-nums">{formatTHB(due)}</p>}
    >
      <ScreenBody className="flex flex-col items-center justify-center gap-4 pt-4">
        {qrImage ? (
          <img
            src={qrImage}
            alt="PromptPay QR"
            className="max-h-[60vh] w-auto max-w-full rounded-2xl"
          />
        ) : (
          <div className="border-ink-soft flex flex-col items-center gap-2 rounded-2xl border-4 border-dashed p-8 text-center">
            <p className="text-3xl font-bold">ใช้ QR ที่พิมพ์ไว้</p>
            <p className="text-ink-soft text-lg font-bold">ยังไม่ได้ใส่รูป QR ในตั้งค่า</p>
          </div>
        )}
      </ScreenBody>

      <ScreenFooter
        back={{ label: 'กลับไปขาย', onClick: onCancel }}
        primary={{ label: 'ลูกค้าจ่ายแล้ว', onClick: onConfirm, disabled: busy }}
      >
        <p className="bg-today mb-3 rounded-xl px-3 py-2 text-center text-lg font-bold">
          ⚠ ระบบไม่ได้ตรวจสอบการโอน — ดูสลิปในมือถือลูกค้าก่อนกด
        </p>
      </ScreenFooter>
    </Screen>
  );
}
