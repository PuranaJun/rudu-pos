import { formatTHB } from '../lib/money.ts';
import { stockLevel } from '../domain/stock.ts';
import type { Product } from '../db/types.ts';

interface Props {
  product: Product;
  price: number;
  /** Infinity when nothing batch-tracked limits the drink. */
  cups: number;
  /** The component that ran out first, already resolved to its Thai name. */
  limitingComponentName: string | null;
  /** A CSS custom property name from the menu palette. */
  colorVar: string;
  size?: 'large' | 'small';
  onTap: () => void;
}

/**
 * A menu button.
 *
 * Renders `name_short_th` and nothing else — the full name is for the printed
 * board. It is never truncated: a truncated button is a misread button at
 * speed, and if it does not fit the short name is wrong and belongs in
 * settings (CLAUDE.md §9).
 *
 * Three looks, told apart by lightness and shape rather than by hue alone —
 * hue is the first thing direct sun washes out:
 * - plenty left: the drink's own colour, the cups in white;
 * - running low: the cups on a yellow block;
 * - sold out: pale, with a dashed edge and a black "หมด" block — greyed out,
 *   literally (CLAUDE.md §2.2).
 *
 * A sold-out drink stays tappable. The operator can stretch a batch, and the
 * app's job is to warn and record, not to refuse (CLAUDE.md §2.1.6).
 */
export default function DrinkButton({
  product,
  price,
  cups,
  limitingComponentName,
  colorVar,
  size = 'large',
  onTap,
}: Props) {
  const level = stockLevel(cups);
  const soldOut = level === 'OUT';
  const large = size === 'large';

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${product.name_short_th} ${formatTHB(price)}${soldOut ? ' — หมด' : ''}`}
      style={soldOut ? undefined : { backgroundColor: `var(${colorVar})` }}
      className={`relative flex w-full flex-col justify-between rounded-2xl px-4 text-left ${
        soldOut
          ? 'bg-paper-sunk border-ink text-ink border-4 border-dashed'
          : 'press-light text-white'
      } ${
        large
          ? 'tablet:min-h-[13rem] tablet:px-6 min-h-[7.5rem] flex-1 py-4'
          : 'min-h-touch-lg py-3'
      }`}
    >
      {/* Large buttons stack the name over the price, so a name never breaks
          in the middle to make room for it (มะขาม / แดง reads as two things). */}
      <span className={large ? 'flex flex-col' : 'flex w-full items-start justify-between gap-2'}>
        <span
          className={`font-bold ${large ? 'tablet:text-5xl text-[1.75rem]' : 'tablet:text-3xl text-2xl'} leading-tight`}
        >
          {product.name_short_th}
        </span>
        <span
          className={`font-bold ${large ? 'tablet:text-4xl text-2xl' : 'tablet:text-2xl text-xl'} shrink-0 tabular-nums`}
        >
          {formatTHB(price)}
        </span>
      </span>

      {level === 'UNLIMITED' ? null : (
        <span className="tablet:text-xl mt-2 flex flex-col items-start text-lg leading-snug font-bold">
          {level === 'OUT' ? (
            <span className="bg-ink rounded-lg px-2 text-white">หมด</span>
          ) : level === 'LOW' ? (
            <span className="bg-today text-ink rounded-lg px-2">เหลือ {cups} แก้ว</span>
          ) : (
            <span>เหลือ {cups} แก้ว</span>
          )}
          {/* What binds, named (CLAUDE.md §2.2): it decides what to make next. */}
          {limitingComponentName ? (
            <span className="tablet:text-lg text-base">
              {level === 'OUT' ? `ขาด${limitingComponentName}` : `จำกัดโดย${limitingComponentName}`}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
}
