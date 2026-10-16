import { useState, type ReactNode } from 'react';
import { Screen, ScreenBody } from './Screen.tsx';
import { Button, ChoiceChip } from './Button.tsx';
import { choiceClass } from './button.ts';
import { formatTHB } from '../lib/money.ts';
import { unitPrice, type CostCatalog } from '../domain/cost.ts';
import {
  availableCups,
  modifierAvailable,
  stockLevel,
  type StockSnapshot,
} from '../domain/stock.ts';
import { soldOutToday } from '../domain/sold-out.ts';
import { DISCOUNT_REASON_TH, MANUAL_DISCOUNT_REASONS } from '../domain/promotions.ts';
import {
  chooseSweetness,
  chooseVariant,
  cupOfLine,
  cupOptions,
  cupTotal,
  newCup,
  paidCups,
  setFree,
  stepCup,
  sweetnessOf,
  toggleOption,
  variantHeading,
  variantLabel,
  MAX_CUPS,
  type CupDraft,
} from '../domain/cup.ts';
import { putCups, removeLine, type CartItem } from '../db/cart-repo.ts';

/** The quantity stepper: square, the secondary look, − and + at full size. */
const STEPPER =
  'size-touch-lg rounded-2xl border-2 border-ink-soft bg-white text-2xl font-bold text-ink disabled:border-paper-sunk disabled:bg-paper-sunk disabled:text-ink-soft';

/** A new cup of a product, or a line already in the basket opened to change it. */
export type DrinkPageStart = { productId: string } | { item: CartItem };

interface Props {
  catalog: CostCatalog;
  stock: StockSnapshot;
  businessDate: string;
  start: DrinkPageStart;
  onClose: () => void;
}

/**
 * A drink's own page: every choice for one cup, then ใส่ตะกร้า.
 *
 * Tapping a drink on the menu opens it already set to the usual cup — the
 * default variant (pear iced), normal sweetness, no toppings, one of it — so
 * the plain cup is one more tap, and only a cup made differently needs
 * anything chosen (CLAUDE.md §6.1). Each visit makes one kind of cup: a
 * second pear made another way is another visit, and its own line in the
 * basket. The bill is paid for as a whole, on the sell screen.
 *
 * Nothing is written until ใส่ตะกร้า; then the cups land in one transaction.
 * ยกเลิก leaves without adding anything (or, on a line, changing it).
 *
 * Sold out never blocks: the page says so in yellow, the button turns into
 * ขายต่อ, and the line records the override (CLAUDE.md §2.1.6).
 */
export default function DrinkPage({ catalog, stock, businessDate, start, onClose }: Props) {
  const editing = 'item' in start ? start.item : null;
  const [cup, setCup] = useState<CupDraft | null>(() =>
    editing
      ? cupOfLine(editing.line, editing.modifierIds)
      : newCup(catalog, (start as { productId: string }).productId),
  );

  const variant = cup ? catalog.variants.get(cup.variantId) : undefined;
  const product = variant ? catalog.products.get(variant.product_id) : undefined;
  if (!cup || !variant || !product) return null;

  const options = cupOptions(catalog, cup.variantId);
  const chosen = new Set(cup.modifierIds);
  const sweetness = sweetnessOf(catalog, cup);

  // Stock for the variant chosen: the plain teas each run on their own base.
  const closedToday = soldOutToday(product, businessDate);
  const { cups, limitingComponentId } = availableCups(catalog, stock, cup.variantId);
  const limiting = limitingComponentId
    ? catalog.components.get(limitingComponentId)?.name_th
    : undefined;
  const level = closedToday ? 'OUT' : stockLevel(cups);
  // Past หมด, or more cups than are left: either way an override, said and recorded.
  const over = closedToday || (Number.isFinite(cups) && cup.qty > cups);

  const variantPrices = new Set(options.variants.map((sibling) => unitPrice(catalog, sibling.id)));
  const total = cupTotal(catalog, cup);
  const advisories = cup.modifierIds
    .map((id) => catalog.modifiers.get(id))
    .filter((modifier) => modifier?.advisory_th)
    .map((modifier) => ({ id: modifier!.id, text: modifier!.advisory_th! }));

  function save() {
    // Not awaited: the write lands in a moment and the basket redraws from it.
    void putCups({ ...cup!, soldOutOverride: over }, editing?.line.id ?? null);
    onClose();
  }

  function remove() {
    if (editing) void removeLine(editing.line.id);
    onClose();
  }

  const verb = over ? 'ขายต่อ' : editing ? 'บันทึก' : 'ใส่ตะกร้า';

  return (
    <Screen
      title={product.name_short_th}
      subtitle={stockLine(level, cups, limiting, closedToday)}
      aside={
        <span className="text-3xl leading-tight font-bold tabular-nums">
          {formatTHB(unitPrice(catalog, cup.variantId))}
        </span>
      }
    >
      <ScreenBody>
        {/* Per-product data, never a hardcoded string (CLAUDE.md §10): the
            caffeine and pregnancy notes are said at the counter. */}
        {product.advisory_th ? (
          <p className="border-ink-soft mt-3 rounded-xl border-2 px-3 py-2 text-lg font-bold">
            <span aria-hidden="true">⚠ </span>
            {product.advisory_th}
          </p>
        ) : null}

        {over ? (
          <p
            role="alert"
            className="bg-today border-ink mt-3 rounded-xl border-2 px-3 py-2 text-lg font-bold"
          >
            <span aria-hidden="true">⚠ </span>
            {closedToday
              ? 'ปิดไว้ในหมดวันนี้ — ขายต่อได้ ระบบจะบันทึกไว้'
              : level === 'OUT'
                ? 'หมดแล้ว — ขายต่อได้ ระบบจะบันทึกไว้'
                : `เหลือ ${cups} แก้ว แต่สั่ง ${cup.qty} — ขายต่อได้ ระบบจะบันทึกไว้`}
          </p>
        ) : null}

        {options.variants.length > 1 ? (
          <Group title={variantHeading(options.variants)} note="เลือก 1">
            {options.variants.map((sibling) => (
              <OptionRow
                key={sibling.id}
                mark="radio"
                selected={sibling.id === cup.variantId}
                onClick={() => setCup(chooseVariant(catalog, cup, sibling.id))}
                aside={variantPrices.size > 1 ? formatTHB(unitPrice(catalog, sibling.id)) : null}
              >
                {variantLabel(sibling, options.variants)}
              </OptionRow>
            ))}
          </Group>
        ) : null}

        {options.sweetness.length > 0 ? (
          <Group title="ความหวาน" note="เลือก 1">
            {/* Normal is the recipe itself, so it is no modifier at all. */}
            <OptionRow
              mark="radio"
              selected={sweetness === null}
              onClick={() => setCup(chooseSweetness(catalog, cup, null))}
            >
              หวานปกติ
            </OptionRow>
            {options.sweetness.map((modifier) => (
              <OptionRow
                key={modifier.id}
                mark="radio"
                selected={sweetness === modifier.id}
                onClick={() => setCup(chooseSweetness(catalog, cup, modifier.id))}
              >
                {modifier.name_th}
              </OptionRow>
            ))}
          </Group>
        ) : null}

        {options.toppings.length > 0 ? (
          <Group title="ท็อปปิ้ง" note="ไม่บังคับ">
            {options.toppings.map((modifier) => (
              <OptionRow
                key={modifier.id}
                mark="check"
                selected={chosen.has(modifier.id)}
                onClick={() => setCup(toggleOption(catalog, cup, modifier.id))}
                aside={`+${formatTHB(modifier.price_delta)}`}
              >
                {modifier.name_th}
                {/* Out of the topping's own stock: said, never refused — the
                    drink itself is still sellable (CLAUDE.md §2.2). */}
                {modifierAvailable(catalog, stock, modifier.id, cup.qty) ? null : (
                  <span className="bg-ink ml-2 rounded-lg px-2 text-lg text-white">หมด</span>
                )}
              </OptionRow>
            ))}
          </Group>
        ) : null}

        {options.prep.length > 0 ? (
          <Group title="วิธีทำ" note="ไม่บังคับ">
            {options.prep.map((modifier) => (
              <OptionRow
                key={modifier.id}
                mark="check"
                selected={chosen.has(modifier.id)}
                onClick={() => setCup(toggleOption(catalog, cup, modifier.id))}
              >
                {modifier.name_th}
              </OptionRow>
            ))}
          </Group>
        ) : null}

        {/* Per-modifier data: the salted plum's choking notice has to be said
            out loud as well as shown (CLAUDE.md §10). */}
        {advisories.map((advisory) => (
          <p
            key={advisory.id}
            role="alert"
            className="bg-today border-ink mt-3 rounded-xl border-2 px-3 py-2 text-lg font-bold"
          >
            <span aria-hidden="true">⚠ </span>
            {advisory.text} — บอกลูกค้าด้วย
          </p>
        ))}

        {/* Only the operator's own reasons: the promotions apply themselves,
            and offering them by hand would let a forgotten one look like a
            deliberate one. */}
        <Group title="แก้วฟรี" note="ไม่บังคับ" wrap>
          {MANUAL_DISCOUNT_REASONS.map((reason) => (
            <ChoiceChip
              key={reason}
              selected={cup.freeReason === reason}
              size="md"
              onClick={() => setCup(setFree(cup, cup.freeReason === reason ? null : reason))}
            >
              {DISCOUNT_REASON_TH[reason]}
            </ChoiceChip>
          ))}
        </Group>
        {cup.freeReason ? (
          <p className="text-lg font-bold">
            ฟรี 1 แก้ว — {DISCOUNT_REASON_TH[cup.freeReason]}
            {paidCups(cup) > 0 ? ` · อีก ${paidCups(cup)} แก้วคิดเงิน` : ''}
          </p>
        ) : null}

        {/* At the end of the page, far from the footer: a wet tap meant for
            บันทึก must never take the cups out. */}
        {editing ? (
          <div className="pt-4">
            <Button variant="secondary" onClick={remove} className="w-full">
              เอาออกจากบิล{editing.line.qty > 1 ? ` (${editing.line.qty} แก้ว)` : ''}
            </Button>
          </div>
        ) : null}
      </ScreenBody>

      {/* Leaving on the left and adding on the right, as on every screen —
          but ยกเลิก rather than a place to go back to, since leaving is what
          not adding the cup is, and the short word leaves ใส่ตะกร้า and its
          price room on one line. */}
      <footer className="safe-bottom border-line border-t px-4 pt-3">
        <div role="group" aria-label="จำนวน" className="mb-3 flex items-center justify-between">
          <span className="text-xl font-bold">จำนวน</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="ลดจำนวน"
              disabled={cup.qty <= 1}
              onClick={() => setCup(stepCup(cup, -1))}
              className={STEPPER}
            >
              −
            </button>
            <span className="w-12 text-center text-3xl font-bold tabular-nums">{cup.qty}</span>
            <button
              type="button"
              aria-label="เพิ่มจำนวน"
              disabled={cup.qty >= MAX_CUPS}
              onClick={() => setCup(stepCup(cup, 1))}
              className={STEPPER}
            >
              +
            </button>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1 py-1">
            ยกเลิก
          </Button>
          <Button
            variant={over ? 'warning' : 'primary'}
            size="lg"
            onClick={save}
            className="flex-[2]"
          >
            {verb} <span className="tabular-nums">{formatTHB(total)}</span>
          </Button>
        </div>
      </footer>
    </Screen>
  );
}

/** How many cups are left of the variant chosen, and what runs out first (CLAUDE.md §2.2). */
function stockLine(
  level: ReturnType<typeof stockLevel>,
  cups: number,
  limiting: string | undefined,
  closedToday: boolean,
): string | null {
  if (closedToday) return 'ปิดไว้วันนี้';
  if (level === 'UNLIMITED') return null;
  if (level === 'OUT') return limiting ? `หมด — ขาด${limiting}` : 'หมด';
  return `เหลือ ${cups} แก้ว${limiting ? ` — จำกัดโดย${limiting}` : ''}`;
}

/** A heading with how many may be picked, over its choices. */
function Group({
  title,
  note,
  wrap = false,
  children,
}: {
  title: string;
  note: string;
  /** Chips side by side, for short labels; otherwise one full-width row each. */
  wrap?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="border-line border-b py-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-2xl font-bold">{title}</h2>
        <span className="border-ink-soft shrink-0 rounded-full border-2 px-3 text-base font-bold">
          {note}
        </span>
      </div>
      <div
        role="group"
        aria-label={title}
        className={wrap ? 'flex flex-wrap gap-2' : 'flex flex-col gap-2'}
      >
        {children}
      </div>
    </section>
  );
}

/**
 * One choice, a full-width row: a round mark for pick-one, a square one for
 * on-or-off. Chosen is the ink fill every choice in the app uses, which reads
 * in direct sun where a small dot would not.
 */
function OptionRow({
  mark,
  selected,
  onClick,
  aside,
  children,
}: {
  mark: 'radio' | 'check';
  selected: boolean;
  onClick: () => void;
  aside?: string | null;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`${choiceClass(selected, 'neutral', 'md')} flex w-full items-center gap-3 text-left`}
    >
      <span
        aria-hidden="true"
        className={`flex size-7 shrink-0 items-center justify-center border-2 border-current ${
          mark === 'radio' ? 'rounded-full' : 'rounded-md'
        }`}
      >
        {selected ? (
          mark === 'radio' ? (
            <span className="size-3.5 rounded-full bg-current" />
          ) : (
            <span className="text-lg leading-none">✓</span>
          )
        ) : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {aside ? <span className="shrink-0 tabular-nums">{aside}</span> : null}
    </button>
  );
}
