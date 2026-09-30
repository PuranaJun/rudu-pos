import { useState } from 'react';
import { useUpdateReady } from '../lib/useUpdateReady.ts';
import { Button } from './Button.tsx';

/**
 * "อัปเดตแล้ว" — a new version is downloaded and waiting.
 *
 * Never reloads on its own, and is not even offered while there is anything
 * in the cart: switching versions reloads the page, and a reload mid-sale
 * throws away a half-entered tender. It waits for an empty cart, then asks.
 *
 * In the flow of the page, never floating over it: a notice laid on top of a
 * screen covers that screen's buttons. It is shown on the hub and on the
 * open-day screen — never on the sell screen, where pushing the drinks down
 * right after a sale would move them from under the next tap.
 */
export default function UpdateBanner({ canApply }: { canApply: boolean }) {
  const { ready, apply } = useUpdateReady();
  const [dismissed, setDismissed] = useState(false);

  if (!ready || dismissed || !canApply) return null;

  return (
    <div
      role="status"
      aria-label="อัปเดต"
      className="border-ink mt-3 rounded-xl border-2 bg-white px-4 py-3"
    >
      <p className="text-xl font-bold">อัปเดตแล้ว — มีเวอร์ชันใหม่</p>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setDismissed(true)} className="flex-1">
          ไว้ทีหลัง
        </Button>
        <Button variant="primary" size="sm" onClick={apply} className="flex-[1.6]">
          ใช้เวอร์ชันใหม่
        </Button>
      </div>
    </div>
  );
}
