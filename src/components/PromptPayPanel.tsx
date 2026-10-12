import { useMemo } from 'react';
import { renderSVG } from 'uqr';
import { formatTHB } from '../lib/money.ts';
import type { Satang } from '../lib/money.ts';
import { maskPromptPayId, parsePromptPayId, promptPayPayload } from '../domain/promptpay.ts';
import { Screen, ScreenBody, ScreenFooter } from './Screen.tsx';

interface Props {
  due: Satang;
  /** The shop's PromptPay ID. With it, the QR carries this bill's amount. */
  promptPayId: string | null;
  /** The printed QR, photographed: used only when there is no ID. */
  qrImage: string | null;
  onConfirm: () => void;
  /** Back to the sell screen, cart intact. */
  onCancel: () => void;
  busy: boolean;
}

/**
 * PromptPay.
 *
 * With the shop's PromptPay ID set, the QR is drawn here, offline, with the
 * bill's amount in it: the customer's banking app opens with the right number
 * and nothing to type. Without one, it falls back to the printed QR.
 *
 * Either way there is no gateway and no callback. The customer shows their
 * phone, and the **operator** decides the money arrived. The app never polls,
 * never waits, and never claims to have verified anything (CLAUDE.md §4) —
 * which is why the button says the operator checked, not that the payment
 * succeeded.
 */
export default function PromptPayPanel({
  due,
  promptPayId,
  qrImage,
  onConfirm,
  onCancel,
  busy,
}: Props) {
  const id = promptPayId ? parsePromptPayId(promptPayId) : null;
  const generated = useMemo(
    () =>
      id
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
            // M: still scans with a smear of condensation on the screen.
            // Border 4: the quiet zone the standard asks for.
            renderSVG(promptPayPayload(id, due), { ecc: 'M', border: 4 }),
          )}`
        : null,
    // The id object is rebuilt each render; the digits are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id?.digits, due],
  );

  return (
    <Screen
      title="จ่ายด้วย QR"
      aside={<p className="text-4xl font-bold tabular-nums">{formatTHB(due)}</p>}
    >
      <ScreenBody className="flex flex-col items-center justify-center gap-2 pt-4">
        {generated && id ? (
          <>
            <img
              src={generated}
              alt={`QR พร้อมเพย์ ${formatTHB(due)}`}
              className="max-h-[55vh] w-auto max-w-full bg-white"
              style={{ imageRendering: 'pixelated' }}
            />
            <p className="text-xl font-bold">ใส่ยอด {formatTHB(due)} ให้แล้ว</p>
            <p className="text-ink-soft text-lg font-bold tabular-nums">
              พร้อมเพย์ {maskPromptPayId(id)}
            </p>
          </>
        ) : qrImage ? (
          <img
            src={qrImage}
            alt="PromptPay QR"
            className="max-h-[60vh] w-auto max-w-full rounded-2xl"
          />
        ) : (
          <div className="border-ink-soft flex flex-col items-center gap-2 rounded-2xl border-4 border-dashed p-8 text-center">
            <p className="text-3xl font-bold">ใช้ QR ที่พิมพ์ไว้</p>
            <p className="text-ink-soft text-lg font-bold">ยังไม่ได้ใส่พร้อมเพย์ในตั้งค่า</p>
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
