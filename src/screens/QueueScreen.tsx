import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { ORDER_TYPE_TH } from '../domain/queue.ts';
import { formatSpan, bangkokTime } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import { useCostCatalog, useQueue } from '../db/hooks.ts';
import {
  markAllHandedOver,
  markHandedOver,
  markWaiting,
  type QueueItem,
} from '../db/queue-repo.ts';
import type { CashSession } from '../db/types.ts';

/**
 * คิว — orders paid and still being made, oldest first (CLAUDE.md §6.1a).
 *
 * Marking one handed over is one tap and is never needed for anything: no
 * figure in the books moves either way, and close day clears what is left.
 * The last few handed over stay below, so a wet mis-tap can be put back.
 *
 * The customer board is this queue in numbers big enough to read from the
 * counter, for a tablet turned to face the line. It is the same device; a
 * board on a second screen needs sync and waits for it.
 */
export default function QueueScreen({ session, back }: { session: CashSession; back: BackTo }) {
  const catalog = useCostCatalog();
  const queue = useQueue(catalog, session);
  const [board, setBoard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = Date.parse(nowIso());
  const fail = (cause: unknown) => setError(`บันทึกไม่สำเร็จ: ${String(cause)}`);

  if (board) {
    return <CustomerBoard waiting={queue?.waiting ?? []} onClose={() => setBoard(false)} />;
  }

  const waiting = queue?.waiting ?? [];
  const recent = queue?.recent ?? [];

  return (
    <Screen title="คิว" subtitle={queue ? `รอ ${waiting.length} คิว` : undefined}>
      <ScreenBody>
        {!queue ? null : waiting.length === 0 ? (
          <p className="text-ink-soft py-8 text-center text-lg font-bold">ไม่มีคิวรอ</p>
        ) : (
          <ul>
            {waiting.map((order) => (
              <li key={order.saleId} className="border-line flex items-center gap-3 border-b py-3">
                <span className="w-24 shrink-0 text-4xl font-bold tabular-nums">
                  {order.orderNo}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">{order.items}</span>
                  <span className="text-ink-soft block text-base font-bold">
                    {ORDER_TYPE_TH[order.orderType]} · รอ{' '}
                    {formatSpan(now - Date.parse(order.createdAt))}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  aria-label={`ส่งคิว ${order.orderNo} แล้ว`}
                  onClick={() => markHandedOver(order.saleId).catch(fail)}
                >
                  ส่งแล้ว
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-3 pt-4">
          <Button variant="secondary" onClick={() => setBoard(true)} className="flex-1">
            จอลูกค้า
          </Button>
          {waiting.length > 1 ? (
            <Button
              variant="secondary"
              onClick={() => markAllHandedOver(session).catch(fail)}
              className="flex-1"
            >
              ส่งครบทุกคิว
            </Button>
          ) : null}
        </div>

        {recent.length > 0 ? (
          <section aria-label="ส่งแล้ว" className="pt-6">
            <h2 className="border-line border-b pb-1 text-xl font-bold">ส่งแล้ว</h2>
            <ul>
              {recent.map((order) => (
                <li
                  key={order.saleId}
                  className="border-line flex items-center gap-3 border-b py-2"
                >
                  <span className="w-24 shrink-0 text-2xl font-bold tabular-nums">
                    {order.orderNo}
                  </span>
                  <span className="min-w-0 flex-1 text-lg font-bold">
                    {order.items}
                    <span className="text-ink-soft block text-base">
                      ส่ง {bangkokTime(order.handedOverAt ?? order.createdAt)}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`คิว ${order.orderNo} ยังไม่ได้ส่ง`}
                    onClick={() => markWaiting(order.saleId).catch(fail)}
                  >
                    ยังไม่ได้ส่ง
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
    </Screen>
  );
}

/** The queue as the customers see it: numbers only, as big as the screen allows. */
function CustomerBoard({ waiting, onClose }: { waiting: QueueItem[]; onClose: () => void }) {
  return (
    <Screen title="กำลังทำ" label="จอลูกค้า">
      <ScreenBody className="pt-4">
        {waiting.length === 0 ? (
          <p className="py-12 text-center text-4xl font-bold">ไม่มีคิวรอ</p>
        ) : (
          <ul className="grid grid-cols-3 gap-3">
            {waiting.map((order) => (
              <li
                key={order.saleId}
                className="border-ink flex items-center justify-center rounded-2xl border-4 py-4 text-6xl font-bold tabular-nums"
              >
                {order.orderNo}
              </li>
            ))}
          </ul>
        )}
      </ScreenBody>
      <ScreenFooter back={{ label: 'กลับไปคิว', onClick: onClose }} />
    </Screen>
  );
}
