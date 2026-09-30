import { useState } from 'react';
import { formatTHB } from '../lib/money.ts';
import type { CostCatalog } from '../domain/cost.ts';
import { unitPrice } from '../domain/cost.ts';
import { modifiersFor, variantsOf } from '../domain/cart.ts';
import type { CartItem } from '../db/cart-repo.ts';
import { DISCOUNT_REASON_TH, MANUAL_DISCOUNT_REASONS } from '../domain/promotions.ts';
import type { DiscountReason } from '../db/types.ts';
import { Button, ChoiceChip } from './Button.tsx';

/** The quantity stepper: square, the secondary look, − and + at full size. */
const STEPPER =
  'size-touch-lg rounded-2xl border-2 border-ink-soft bg-white text-2xl font-bold text-ink';

interface Props {
  catalog: CostCatalog;
  item: CartItem;
  onStep: (delta: number) => void;
  onSetVariant: (variantId: string, allowedModifierIds: string[]) => void;
  onToggleModifier: (modifierId: string) => void;
  onSetDiscountReason: (reason: DiscountReason | null) => void;
}

/**
 * One line of the cart.
 *
 * Temperature is a row on the line, not a blocking modal — pear rings ICED on
 * the first tap and HOT costs one more, which keeps the common sale at two
 * taps (CLAUDE.md §6.1). Paid modifiers hide behind one "ท็อปปิ้ง" button so
 * they cost nothing on the standard path, and so does giving a cup away.
 *
 * Every control says what it does in words. − and + are only ever the
 * quantity; opening a list is a word with an arrow.
 */
export default function CartLineRow({
  catalog,
  item,
  onStep,
  onSetVariant,
  onToggleModifier,
  onSetDiscountReason,
}: Props) {
  const [showModifiers, setShowModifiers] = useState(false);
  const [showReasons, setShowReasons] = useState(false);
  const givenAway = item.line.manual_discount_reason;

  const variant = catalog.variants.get(item.line.variant_id);
  const product = variant ? catalog.products.get(variant.product_id) : undefined;
  if (!variant || !product) return null;

  const siblings = variantsOf(catalog, product.id);
  const offerable = modifiersFor(catalog, variant.id, 'PAID');
  const chosen = new Set(item.modifierIds);
  const price = unitPrice(catalog, variant.id, item.modifierIds);

  // Per-modifier data, never a hardcoded string: the salted plum's choking
  // notice has to be said out loud as well as shown (CLAUDE.md §10).
  const advisories = item.modifierIds
    .map((id) => catalog.modifiers.get(id))
    .filter((modifier) => modifier?.advisory_th)
    .map((modifier) => ({ id: modifier!.id, text: modifier!.advisory_th! }));

  return (
    <li className="border-line border-b py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xl leading-tight font-bold">{product.name_short_th}</p>
          {item.modifierIds.length > 0 ? (
            <p className="text-ink-soft text-base font-bold">
              {item.modifierIds
                .map((id) => catalog.modifiers.get(id)?.name_th)
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>

        <span
          className={`text-xl font-bold tabular-nums ${givenAway ? 'text-ink-soft line-through' : ''}`}
        >
          {formatTHB(price * item.line.qty)}
        </span>

        <div className="flex items-center gap-1">
          <button type="button" aria-label="ลดจำนวน" onClick={() => onStep(-1)} className={STEPPER}>
            −
          </button>
          <span className="w-8 text-center text-2xl font-bold tabular-nums">{item.line.qty}</span>
          <button
            type="button"
            aria-label="เพิ่มจำนวน"
            onClick={() => onStep(1)}
            className={STEPPER}
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {siblings.length > 1
          ? siblings.map((sibling) => (
              <ChoiceChip
                key={sibling.id}
                selected={sibling.id === variant.id}
                size="md"
                onClick={() =>
                  onSetVariant(
                    sibling.id,
                    modifiersFor(catalog, sibling.id).map((modifier) => modifier.id),
                  )
                }
              >
                {sibling.temp === 'HOT' ? 'ร้อน' : 'เย็น'}
              </ChoiceChip>
            ))
          : null}

        {offerable.length > 0 ? (
          <Button
            variant="secondary"
            size="md"
            onClick={() => setShowModifiers((open) => !open)}
            aria-expanded={showModifiers}
            aria-label="เพิ่มท็อปปิ้ง"
          >
            ท็อปปิ้ง <span aria-hidden="true">{showModifiers ? '▴' : '▾'}</span>
          </Button>
        ) : null}

        <Button
          variant="secondary"
          size="md"
          onClick={() => setShowReasons((open) => !open)}
          aria-expanded={showReasons}
        >
          ฟรี <span aria-hidden="true">{showReasons ? '▴' : '▾'}</span>
        </Button>
      </div>

      {showReasons ? (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="ฟรีเพราะ">
          {MANUAL_DISCOUNT_REASONS.map((reason) => (
            <ChoiceChip
              key={reason}
              selected={givenAway === reason}
              size="md"
              onClick={() => onSetDiscountReason(givenAway === reason ? null : reason)}
            >
              {DISCOUNT_REASON_TH[reason]}
            </ChoiceChip>
          ))}
        </div>
      ) : null}

      {showModifiers ? (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="ท็อปปิ้ง">
          {offerable.map((modifier) => (
            <ChoiceChip
              key={modifier.id}
              selected={chosen.has(modifier.id)}
              size="md"
              onClick={() => onToggleModifier(modifier.id)}
            >
              {modifier.name_th} +{formatTHB(modifier.price_delta)}
            </ChoiceChip>
          ))}
        </div>
      ) : null}

      {givenAway ? (
        <p className="mt-2 text-lg font-bold">ฟรี — {DISCOUNT_REASON_TH[givenAway]}</p>
      ) : null}

      {advisories.map((advisory) => (
        <p
          key={advisory.id}
          role="alert"
          className="bg-today border-ink mt-2 rounded-xl border-2 px-3 py-2 text-lg font-bold"
        >
          <span aria-hidden="true">⚠ </span>
          {advisory.text} — บอกลูกค้าด้วย
        </p>
      ))}
    </li>
  );
}
