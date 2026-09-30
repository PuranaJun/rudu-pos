import { formatTHB } from '../lib/money.ts';
import type { Satang } from '../lib/money.ts';
import { buttonClass } from './button.ts';

interface Props {
  due: Satang;
  /** The owner's quick-tender amounts, from settings. */
  quickTender: readonly Satang[];
  disabled: boolean;
  onCash: (received: Satang) => void;
  onQr: () => void;
}

/** The notes row always has this many places, used or not. */
const NOTE_SLOTS = 4;

/**
 * Payment, one tap (CLAUDE.md §6.1: "Tap drink → Tap CASH → Done").
 *
 * Cash is not a button that opens a pad: the quick-tender amounts are the
 * cash buttons. พอดี is exact money; a note completes the sale and the change
 * appears in the largest type on the screen. Either way a plain tamarind paid
 * in cash is two taps, and the drawer comes out the same — a sale adds its
 * net whatever note came in.
 *
 * Nothing moves between sales. พอดี and QR hold the top row, always in the
 * same place, so the thumb learns them; the notes fill a fixed row of four
 * under them. Only notes that cover the bill are offered, so a ฿50 cannot be
 * taken for a ฿59 pear — the places they leave stay empty rather than let
 * the rest slide over. QR still asks for the operator's confirmation,
 * because the system never claims to have seen a transfer (CLAUDE.md §4).
 */
export default function PayButtons({ due, quickTender, disabled, onCash, onQr }: Props) {
  const notes = [...new Set(quickTender)]
    .filter((amount) => amount > due)
    .sort((a, b) => a - b)
    .slice(0, NOTE_SLOTS);
  const empty = NOTE_SLOTS - notes.length;

  return (
    <div role="group" aria-label="รับเงิน" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onCash(due)}
          disabled={disabled}
          className={`${buttonClass('primary', 'lg')} w-full`}
        >
          พอดี
        </button>
        <button
          type="button"
          onClick={onQr}
          disabled={disabled}
          className={`${buttonClass('qr', 'lg')} w-full`}
        >
          QR
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        {notes.map((amount) => (
          <button
            key={amount}
            type="button"
            onClick={() => onCash(amount)}
            disabled={disabled}
            className={`${buttonClass('cash', 'md', { tight: true })} w-full tabular-nums`}
          >
            {formatTHB(amount)}
          </button>
        ))}
        {Array.from({ length: empty }, (_, index) => (
          <span key={`empty-${index}`} aria-hidden="true" className="min-h-touch-lg" />
        ))}
      </div>
    </div>
  );
}
