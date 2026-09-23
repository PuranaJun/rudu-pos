import { formatTHB } from '../lib/money.ts';
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
  const soldOut = cups <= 0;
  const large = size === 'large';

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${product.name_short_th} ${formatTHB(price)}`}
      style={{ backgroundColor: soldOut ? 'var(--color-soldout)' : `var(${colorVar})` }}
      className={`relative flex w-full flex-col justify-between rounded-2xl px-4 text-left text-white active:brightness-90 ${
        large ? 'min-h-[7.5rem] flex-1 py-4' : 'min-h-touch-lg py-3'
      }`}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className={`font-bold ${large ? 'text-3xl' : 'text-2xl'} leading-tight`}>
          {product.name_short_th}
        </span>
        <span className={`font-bold ${large ? 'text-2xl' : 'text-xl'} shrink-0 tabular-nums`}>
          {formatTHB(price)}
        </span>
      </span>

      <span className="mt-2 text-base leading-snug font-semibold">
        {soldOut ? (
          <span>หมด{limitingComponentName ? ` — ${limitingComponentName}` : ''}</span>
        ) : Number.isFinite(cups) ? (
          <span>
            เหลือ {cups} แก้ว
            {limitingComponentName ? ` — จำกัดโดย${limitingComponentName}` : ''}
          </span>
        ) : null}
      </span>
    </button>
  );
}
