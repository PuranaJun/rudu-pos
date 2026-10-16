import { formatTHB } from '../lib/money.ts';
import type { CostCatalog } from '../domain/cost.ts';
import { unitPrice } from '../domain/cost.ts';
import { cupChoices } from '../domain/cup.ts';
import type { CartItem } from '../db/cart-repo.ts';
import { DISCOUNT_REASON_TH } from '../domain/promotions.ts';

/** The quantity stepper: square, the secondary look, − and + at full size. */
const STEPPER =
  'size-touch-lg shrink-0 rounded-2xl border-2 border-ink-soft bg-white text-2xl font-bold text-ink disabled:border-paper-sunk disabled:bg-paper-sunk disabled:text-ink-soft';

interface Props {
  catalog: CostCatalog;
  item: CartItem;
  /** Open the drink page on this line, to change how its cups are made. */
  onOpen: () => void;
  onStep: (delta: number) => void;
}

/**
 * One line of the basket: one kind of cup, how many, what it comes to.
 *
 * A row, never a panel of controls. How the cup is made is said in words
 * under its name, and changed on the drink page, which the name opens. The
 * stepper stays on the row: the second identical cup is a quantity, not a
 * second trip through the page (CLAUDE.md §6.1).
 *
 * A given-away cup is a line of one: its + is off, so a tap cannot make a
 * second cup free.
 */
export default function CartLineRow({ catalog, item, onOpen, onStep }: Props) {
  const variant = catalog.variants.get(item.line.variant_id);
  const product = variant ? catalog.products.get(variant.product_id) : undefined;
  if (!variant || !product) return null;

  const givenAway = item.line.manual_discount_reason;
  const price = unitPrice(catalog, variant.id, item.modifierIds);
  const choices = cupChoices(catalog, variant.id, item.modifierIds);
  if (givenAway) choices.push(`ฟรี — ${DISCOUNT_REASON_TH[givenAway]}`);

  // Per-modifier data, never a hardcoded string: the salted plum's choking
  // notice has to be said out loud when the cup is handed over (CLAUDE.md §10).
  const advisories = item.modifierIds
    .map((id) => catalog.modifiers.get(id))
    .filter((modifier) => modifier?.advisory_th)
    .map((modifier) => ({ id: modifier!.id, text: modifier!.advisory_th! }));

  return (
    <li className="border-line border-b py-1 last:border-b-0">
      <div className="flex items-center gap-1">
        {/* The whole left of the row opens the page: a big target, and the
            name keeps the width it needs (never truncated, CLAUDE.md §9). The
            price sits under it rather than squeezing it. */}
        <button
          type="button"
          onClick={onOpen}
          aria-label={`แก้ ${product.name_short_th}${choices.length > 0 ? ` (${choices.join(' · ')})` : ''}`}
          className="min-h-touch-lg mr-1 min-w-0 flex-1 rounded-xl text-left"
        >
          <span className="block text-xl leading-tight font-bold">
            {product.name_short_th} <span aria-hidden="true">›</span>
          </span>
          <span className="block text-base leading-snug font-bold">
            <span
              className={`text-lg tabular-nums ${givenAway ? 'text-ink-soft line-through' : ''}`}
            >
              {formatTHB(price * item.line.qty)}
            </span>
            {/* Each choice whole: the line breaks between them, never inside
                one (ยา / คูลท์ reads as two things). */}
            {choices.map((choice) => (
              <span key={choice} className="text-ink-soft">
                {' '}
                <span className="whitespace-nowrap">· {choice}</span>
              </span>
            ))}
          </span>
        </button>

        <button type="button" aria-label="ลดจำนวน" onClick={() => onStep(-1)} className={STEPPER}>
          −
        </button>
        <span className="w-7 shrink-0 text-center text-2xl font-bold tabular-nums">
          {item.line.qty}
        </span>
        <button
          type="button"
          aria-label="เพิ่มจำนวน"
          disabled={givenAway !== null}
          onClick={() => onStep(1)}
          className={STEPPER}
        >
          +
        </button>
      </div>

      {advisories.map((advisory) => (
        <p
          key={advisory.id}
          role="alert"
          className="bg-today border-ink my-1 rounded-xl border-2 px-3 py-1 text-lg font-bold"
        >
          <span aria-hidden="true">⚠ </span>
          {advisory.text} — บอกลูกค้าด้วย
        </p>
      ))}
    </li>
  );
}
