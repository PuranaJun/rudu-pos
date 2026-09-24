import { useState } from 'react';
import { formatTHB } from '../lib/money.ts';
import type { Satang } from '../lib/money.ts';

interface Props {
  due: Satang;
  quickTender: readonly Satang[];
  onConfirm: (received: Satang) => void;
  onCancel: () => void;
  busy: boolean;
}

/**
 * The cash pad.
 *
 * "พอดี" completes the sale on the spot — exact money is the common case and
 * there is no change to read, which keeps a plain cash sale at three taps
 * (CLAUDE.md §0). Any other denomination shows the change first, in the
 * largest type on the screen, because it is read at arm's length with the
 * customer watching. That change figure *is* the confirm button: one tap.
 */
export default function CashTenderPad({ due, quickTender, onConfirm, onCancel, busy }: Props) {
  const [received, setReceived] = useState<Satang | null>(null);

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

      <div className="grid flex-1 grid-cols-3 content-start gap-2 p-3">
        {quickTender.map((amount) => {
          const tooLittle = amount < due;
          return (
            <button
              key={amount}
              type="button"
              disabled={tooLittle}
              onClick={() => setReceived(amount)}
              aria-pressed={received === amount}
              className={`min-h-touch-lg w-full rounded-2xl py-4 text-2xl font-bold tabular-nums disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line disabled:line-through ${
                received === amount ? 'bg-ink text-paper' : 'border-line text-ink border-2'
              }`}
            >
              {formatTHB(amount)}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => onConfirm(due)}
          disabled={busy}
          className="bg-brand-2 min-h-touch-lg col-span-3 rounded-2xl py-5 text-3xl font-bold text-white active:brightness-90 disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line"
        >
          พอดี
        </button>
      </div>

      <footer className="safe-bottom border-line border-t px-3 pt-3">
        {received === null ? (
          <p className="text-ink-soft py-4 text-center text-xl font-bold">
            รับเงินมาเท่าไหร่ หรือกด “พอดี”
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onConfirm(received)}
            disabled={busy}
            className="bg-brand min-h-touch-lg w-full rounded-2xl px-4 py-5 text-white active:brightness-90 disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line"
          >
            <span className="block text-xl font-bold">ทอน</span>
            <span className="block text-6xl leading-none font-bold tabular-nums">
              {formatTHB(received - due)}
            </span>
          </button>
        )}
      </footer>
    </div>
  );
}
