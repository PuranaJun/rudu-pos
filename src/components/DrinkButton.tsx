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
  /** Said under หมด instead of the missing component: why it is out. */
  outNote?: string | null;
  /**
   * `large` while the menu is a few drinks; `compact` once it is long enough
   * that large buttons would push the cart and the pay buttons off a phone;
   * `small` for the bottle row.
   */
  size?: 'large' | 'compact' | 'small';
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
  outNote = null,
  size = 'large',
  onTap,
}: Props) {
  const level = stockLevel(cups);
  const soldOut = level === 'OUT';
  const large = size === 'large';
  const compact = size === 'compact';

  if (compact) {
    return (
      <CompactDrinkButton
        product={product}
        price={price}
        cups={cups}
        limitingComponentName={limitingComponentName}
        colorVar={colorVar}
        outNote={outNote}
        onTap={onTap}
      />
    );
  }

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
      } ${large ? 'tablet:min-h-[13rem] tablet:px-6 min-h-[7.5rem] flex-1 py-4' : 'min-h-touch-lg py-3'}`}
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
          {level === 'OUT' && outNote ? (
            <span className="tablet:text-lg text-base">{outNote}</span>
          ) : null}
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

/**
 * The long menu's button: the name on one line, the price and the cups left
 * on the next — two lines, so fifteen drinks fit a phone with little
 * scrolling. What binds is named only once it matters, when the drink is low
 * or out; the drink page always names it (CLAUDE.md §2.2). Everything else
 * is as the large button: same colours, same sold-out look, still tappable.
 */
function CompactDrinkButton({
  product,
  price,
  cups,
  limitingComponentName,
  colorVar,
  outNote,
  onTap,
}: Omit<Required<Props>, 'size' | 'limitingComponentName' | 'outNote'> & {
  limitingComponentName: string | null;
  outNote: string | null;
}) {
  const level = stockLevel(cups);
  const soldOut = level === 'OUT';
  const note =
    level === 'OUT'
      ? (outNote ?? (limitingComponentName ? `ขาด${limitingComponentName}` : null))
      : level === 'LOW' && limitingComponentName
        ? `จำกัดโดย${limitingComponentName}`
        : null;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={`${product.name_short_th} ${formatTHB(price)}${soldOut ? ' — หมด' : ''}`}
      style={soldOut ? undefined : { backgroundColor: `var(${colorVar})` }}
      className={`tablet:min-h-[9rem] tablet:px-5 min-h-touch-lg flex w-full flex-1 flex-col justify-center rounded-2xl px-3 py-2 text-left ${
        soldOut
          ? 'bg-paper-sunk border-ink text-ink border-4 border-dashed'
          : 'press-light text-white'
      }`}
    >
      <span className="tablet:text-3xl text-2xl leading-tight font-bold">
        {product.name_short_th}
      </span>
      <span className="flex w-full flex-wrap items-baseline justify-between gap-x-2 font-bold">
        <span className="tablet:text-2xl text-xl tabular-nums">{formatTHB(price)}</span>
        {level === 'UNLIMITED' ? null : level === 'OUT' ? (
          <span className="bg-ink rounded-lg px-2 text-lg text-white">หมด</span>
        ) : level === 'LOW' ? (
          <span className="bg-today text-ink rounded-lg px-2 text-lg tabular-nums">
            เหลือ {cups}
          </span>
        ) : (
          <span className="text-lg tabular-nums">เหลือ {cups}</span>
        )}
      </span>
      {note ? (
        <span className="tablet:text-lg text-base leading-snug font-bold">{note}</span>
      ) : null}
    </button>
  );
}
