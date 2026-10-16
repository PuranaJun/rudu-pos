/**
 * One cup being made on the drink page, before it goes in the basket.
 *
 * Pure. The page holds a draft while the operator chooses — temperature or
 * which tea, sweetness, toppings, a cup given away — and nothing is written
 * until ใส่ตะกร้า, when it lands in one transaction (cart-repo `putCups`).
 *
 * Cups that are the same in every choice share a cart line, so two plain
 * pears read as ×2. A cup that differs in anything is a line of its own, which
 * is how one pear goes less sweet and the next extra sweet in the same bill
 * (CLAUDE.md §6.1).
 */
import type { DiscountReason, Modifier, Variant } from '../db/types.ts';
import { unitPrice, type CostCatalog } from './cost.ts';
import { defaultVariantOf, modifiersFor, variantsOf } from './cart.ts';

export interface CupDraft {
  variantId: string;
  modifierIds: readonly string[];
  qty: number;
  /**
   * One of these cups is given away, and why. Never more than one: a whole
   * line going to ฿0 at one tap is money lost without anyone noticing
   * (CLAUDE.md §4).
   */
  freeReason: DiscountReason | null;
}

/** The choices the drink page offers for one variant, each list in menu order. */
export interface CupOptions {
  /** Hot or iced, or which tea. A choice only when there are two or more. */
  variants: Variant[];
  /** Pick one. None of them is normal sweetness — the recipe itself. */
  sweetness: Modifier[];
  /** Other free ways of making it (no ice, no solids): on or off. */
  prep: Modifier[];
  /** Paid toppings: on or off. */
  toppings: Modifier[];
}

/** Most cups one tap of the stepper will put in the basket. */
export const MAX_CUPS = 99;

/**
 * A modifier that says how sweet the cup is. Data, not a name: it replaces
 * the amount of the syrup, or of a concentrate that is the sweetness (the
 * longan), so a level the owner adds in settings joins the list by itself.
 */
export function isSweetness(modifier: Modifier): boolean {
  return (
    modifier.kind === 'PREP' &&
    (modifier.overrides_component_role === 'SWEETENER' ||
      modifier.overrides_component_role === 'CONCENTRATE')
  );
}

/** A new cup of a product: its default variant, made the normal way, one of it. */
export function newCup(catalog: CostCatalog, productId: string): CupDraft | null {
  const variant = defaultVariantOf(catalog, productId);
  if (!variant) return null;
  return { variantId: variant.id, modifierIds: [], qty: 1, freeReason: null };
}

/** A cart line, back on the page to be changed. */
export function cupOfLine(
  line: { variant_id: string; qty: number; manual_discount_reason: DiscountReason | null },
  modifierIds: readonly string[],
): CupDraft {
  return {
    variantId: line.variant_id,
    modifierIds: [...modifierIds],
    qty: line.qty,
    freeReason: line.manual_discount_reason,
  };
}

export function cupOptions(catalog: CostCatalog, variantId: string): CupOptions {
  const variant = catalog.variants.get(variantId);
  const prep = modifiersFor(catalog, variantId, 'PREP');
  return {
    variants: variant ? variantsOf(catalog, variant.product_id) : [],
    sweetness: prep.filter(isSweetness),
    prep: prep.filter((modifier) => !isSweetness(modifier)),
    toppings: modifiersFor(catalog, variantId, 'PAID'),
  };
}

/** The sweetness chosen, or null for normal. */
export function sweetnessOf(catalog: CostCatalog, cup: CupDraft): string | null {
  return (
    cup.modifierIds.find((id) => {
      const modifier = catalog.modifiers.get(id);
      return modifier !== undefined && isSweetness(modifier);
    }) ?? null
  );
}

/**
 * Switch to another variant. Choices that still apply are kept. One that does
 * not, but has a twin of the same name on the new variant — หวานน้อย is a
 * different row for each pump count — becomes the twin, so changing the tea
 * does not quietly undo the sweetness. The rest are dropped rather than
 * charged for (peach gum is already in hot pear).
 */
export function chooseVariant(catalog: CostCatalog, cup: CupDraft, variantId: string): CupDraft {
  const allowed = modifiersFor(catalog, variantId);
  const kept = cup.modifierIds.flatMap((id) => {
    if (allowed.some((modifier) => modifier.id === id)) return [id];
    const old = catalog.modifiers.get(id);
    const twin = old
      ? allowed.find((modifier) => modifier.name_th === old.name_th && modifier.kind === old.kind)
      : undefined;
    return twin ? [twin.id] : [];
  });
  return { ...cup, variantId, modifierIds: [...new Set(kept)] };
}

/** Sweetness is one choice: picking a level replaces the last. Null is normal. */
export function chooseSweetness(
  catalog: CostCatalog,
  cup: CupDraft,
  modifierId: string | null,
): CupDraft {
  const others = cup.modifierIds.filter((id) => {
    const modifier = catalog.modifiers.get(id);
    return !(modifier && isSweetness(modifier));
  });
  return { ...cup, modifierIds: modifierId ? [...others, modifierId] : others };
}

/**
 * A topping or a way of making it, on or off. Two that both set the amount of
 * the same thing cannot both be on one cup, so choosing one takes the other
 * off — the rule the cart has always had (cart-repo `toggleModifier`).
 */
export function toggleOption(catalog: CostCatalog, cup: CupDraft, modifierId: string): CupDraft {
  if (cup.modifierIds.includes(modifierId)) {
    return { ...cup, modifierIds: cup.modifierIds.filter((id) => id !== modifierId) };
  }
  const role = catalog.modifiers.get(modifierId)?.overrides_component_role ?? null;
  const kept =
    role === null
      ? cup.modifierIds
      : cup.modifierIds.filter(
          (id) => catalog.modifiers.get(id)?.overrides_component_role !== role,
        );
  return { ...cup, modifierIds: [...kept, modifierId] };
}

/** One cup given away for this reason, or (null) all of them paid for. */
export function setFree(cup: CupDraft, reason: DiscountReason | null): CupDraft {
  return { ...cup, freeReason: reason };
}

/** The stepper. Never below one: leaving the page is how a cup is not added. */
export function stepCup(cup: CupDraft, delta: number): CupDraft {
  return { ...cup, qty: Math.min(MAX_CUPS, Math.max(1, cup.qty + delta)) };
}

/** Cups that are paid for: all of them, less the one given away. */
export function paidCups(cup: CupDraft): number {
  return cup.qty - (cup.freeReason ? 1 : 0);
}

/** What the cups add to the bill before promotions, which the basket applies. */
export function cupTotal(catalog: CostCatalog, cup: CupDraft): number {
  return unitPrice(catalog, cup.variantId, cup.modifierIds) * paidCups(cup);
}

/** The same cup, choice for choice. Order of the choices does not matter. */
export function sameCup(
  a: { variantId: string; modifierIds: readonly string[] },
  b: { variantId: string; modifierIds: readonly string[] },
): boolean {
  if (a.variantId !== b.variantId || a.modifierIds.length !== b.modifierIds.length) return false;
  const ids = new Set(a.modifierIds);
  return b.modifierIds.every((id) => ids.has(id));
}

/**
 * What a variant is called beside its siblings. Hot and iced are told apart
 * by temperature; the plain teas are all iced, so they are told apart by name.
 */
export function variantLabel(variant: Variant, siblings: readonly Variant[]): string {
  const temps = siblings.map((sibling) => sibling.temp);
  const byTemp = !temps.includes(null) && new Set(temps).size === siblings.length;
  if (!byTemp) return variant.name_th;
  return variant.temp === 'HOT' ? 'ร้อน' : 'เย็น';
}

/** The heading over the variants: temperature when that is what differs. */
export function variantHeading(siblings: readonly Variant[]): string {
  const temps = siblings.map((sibling) => sibling.temp);
  const byTemp = !temps.includes(null) && new Set(temps).size === siblings.length;
  return byTemp ? 'ร้อน / เย็น' : 'แบบ';
}

/**
 * The choices on a cup, in words, for the basket line: the variant when the
 * drink has more than one, then sweetness, then the rest in menu order.
 */
export function cupChoices(
  catalog: CostCatalog,
  variantId: string,
  modifierIds: readonly string[],
): string[] {
  const variant = catalog.variants.get(variantId);
  const siblings = variant ? variantsOf(catalog, variant.product_id) : [];
  const chosen = modifierIds
    .map((id) => catalog.modifiers.get(id))
    .filter((modifier): modifier is Modifier => modifier !== undefined)
    .sort((a, b) => Number(isSweetness(b)) - Number(isSweetness(a)) || a.sort_order - b.sort_order)
    .map((modifier) => modifier.name_th);
  return variant && siblings.length > 1 ? [variantLabel(variant, siblings), ...chosen] : chosen;
}
