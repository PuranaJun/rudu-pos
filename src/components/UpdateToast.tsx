import { useState } from 'react';
import { useUpdateReady } from '../lib/useUpdateReady.ts';

/**
 * "อัปเดตแล้ว" — a new version is downloaded and waiting.
 *
 * Never reloads on its own, and is not even offered while there is anything
 * in the cart: switching versions reloads the page, and a reload mid-sale
 * throws away a half-entered tender. It waits for an empty cart, then asks.
 */
export default function UpdateToast({ canApply }: { canApply: boolean }) {
  const { ready, apply } = useUpdateReady();
  const [dismissed, setDismissed] = useState(false);

  if (!ready || dismissed || !canApply) return null;

  return (
    <div className="safe-top safe-x pointer-events-none fixed inset-x-0 top-0 z-50 px-3">
      <div
        role="status"
        aria-label="อัปเดต"
        className="bg-ink pointer-events-auto mx-auto flex max-w-md items-center gap-2 rounded-2xl px-4 py-2 text-white shadow-lg"
      >
        <p className="flex-1 text-lg font-bold">อัปเดตแล้ว</p>
        <button
          type="button"
          onClick={apply}
          className="bg-paper text-ink min-h-touch rounded-xl px-4 text-lg font-bold"
        >
          ใช้เวอร์ชันใหม่
        </button>
        <button
          type="button"
          aria-label="ไว้ทีหลัง"
          onClick={() => setDismissed(true)}
          className="min-h-touch min-w-touch rounded-xl text-2xl font-bold"
        >
          ×
        </button>
      </div>
    </div>
  );
}
