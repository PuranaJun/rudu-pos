import { formatTHB } from '../lib/money.ts';
import type { Satang } from '../lib/money.ts';

interface Props {
  due: Satang;
  /** The owner's quick-tender amounts, from settings. */
  quickTender: readonly Satang[];
  disabled: boolean;
  onCash: (received: Satang) => void;
  onQr: () => void;
}

/** More than this and the buttons stop fitting two rows in thumb reach. */
const MAX_NOTES = 4;

/**
 * Payment, one tap (CLAUDE.md §6.1: "Tap drink → Tap CASH → Done").
 *
 * Cash is not a button that opens a pad: the quick-tender amounts are the
 * cash buttons. พอดี is exact money; a note completes the sale and the change
 * appears in the largest type on the screen. Either way a plain tamarind paid
 * in cash is two taps, and the drawer comes out the same — a sale adds its
 * net whatever note came in.
 *
 * Only notes that cover the bill are offered, so a ฿50 cannot be taken for
 * a ฿59 pear. QR still asks for the operator's confirmation, because the
 * system never claims to have seen a transfer (CLAUDE.md §4).
 */
export default function PayButtons({ due, quickTender, disabled, onCash, onQr }: Props) {
  const notes = [...new Set(quickTender)]
    .filter((amount) => amount > due)
    .sort((a, b) => a - b)
    .slice(0, MAX_NOTES);

  return (
    <div role="group" aria-label="รับเงิน" className="grid grid-cols-3 gap-2">
      <button
        type="button"
        onClick={() => onCash(due)}
        disabled={disabled}
        className="bg-brand-2 min-h-touch-lg w-full rounded-2xl text-2xl font-bold text-white active:brightness-90 disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line"
      >
        พอดี
      </button>

      {notes.map((amount) => (
        <button
          key={amount}
          type="button"
          onClick={() => onCash(amount)}
          disabled={disabled}
          className="border-brand-2 text-ink min-h-touch-lg w-full rounded-2xl border-2 bg-white text-2xl font-bold tabular-nums disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line"
        >
          {formatTHB(amount)}
        </button>
      ))}

      <button
        type="button"
        onClick={onQr}
        disabled={disabled}
        className="bg-ink min-h-touch-lg w-full rounded-2xl text-2xl font-bold text-white active:brightness-90 disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line"
      >
        QR
      </button>
    </div>
  );
}
