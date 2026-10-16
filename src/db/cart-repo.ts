/**
 * The open cart.
 *
 * Every change lands in IndexedDB as it happens, not at payment: the phone can
 * die, be force-quit, or run out of battery mid-service and the cart is still
 * there when it comes back (CLAUDE.md §1).
 *
 * Nothing here is awaited on the tap path. Callers fire and forget; the screen
 * updates from useLiveQuery when the write lands.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { CartLine, CartLineMod, DiscountReason, OrderType } from './types.ts';
import { newId, nowIso } from '../lib/id.ts';
import { ORDER_TYPE_KEY } from './settings-repo.ts';

export interface CartItem {
  line: CartLine;
  modifierIds: string[];
}

export async function loadCart(db: RuduPosDB = defaultDb): Promise<CartItem[]> {
  const [lines, mods] = await Promise.all([db.cart_line.toArray(), db.cart_line_mod.toArray()]);

  return lines
    .sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id))
    .map((line) => ({
      // A cart written by an older build has no reason column at all.
      line: { ...line, manual_discount_reason: line.manual_discount_reason ?? null },
      modifierIds: mods.filter((mod) => mod.cart_line_id === line.id).map((mod) => mod.modifier_id),
    }));
}

/**
 * Add a cup. Tapping the same drink again increments the plain line of that
 * variant rather than stacking identical rows — the second identical drink is
 * a quantity, not a repeat of the flow (CLAUDE.md §6.1).
 *
 * A line that already carries modifiers is left alone, so tapping the drink
 * after adding salted plum to one cup gives a plain second cup.
 */
export async function addDrink(
  variantId: string,
  options: { soldOutOverride?: boolean } = {},
  db: RuduPosDB = defaultDb,
): Promise<string> {
  return db.transaction('rw', [db.cart_line, db.cart_line_mod], async () => {
    const candidates = await db.cart_line.where('variant_id').equals(variantId).toArray();
    const modded = new Set((await db.cart_line_mod.toArray()).map((mod) => mod.cart_line_id));
    const plain = candidates
      // Never into a given-away line: a free cup must not make the next one free.
      .filter((line) => !modded.has(line.id) && line.manual_discount_reason === null)
      .sort((a, b) => a.added_at.localeCompare(b.added_at))
      .pop();

    if (plain) {
      await db.cart_line.update(plain.id, {
        qty: plain.qty + 1,
        sold_out_override: plain.sold_out_override || (options.soldOutOverride ?? false),
      });
      return plain.id;
    }

    const line: CartLine = {
      id: newId(),
      variant_id: variantId,
      qty: 1,
      sold_out_override: options.soldOutOverride ?? false,
      manual_discount_reason: null,
      added_at: nowIso(),
      synced_at: null,
    };
    await db.cart_line.add(line);
    return line.id;
  });
}

/** Cups made on the drink page, as they go in the basket. */
export interface CupInput {
  variantId: string;
  modifierIds: readonly string[];
  qty: number;
  /** One of the cups given away, and why (CLAUDE.md §4). */
  freeReason: DiscountReason | null;
  /** Rung past หมด, or past what is left: recorded on the line (CLAUDE.md §2.1.6). */
  soldOutOverride: boolean;
}

/**
 * Put cups from the drink page in the basket — or, given `replacesLineId`, in
 * place of a line the operator opened to change.
 *
 * Cups the same as a paid line already there join it: two plain pears are one
 * line of two. A cup that differs in anything — temperature, sweetness, a
 * topping — is its own line, which is how one pear goes less sweet and the
 * next extra sweet in one bill (CLAUDE.md §6.1). A given-away cup is always a
 * line of one and never joins anything, so a free cup cannot make the next one
 * free; of several cups with a reason, one is free and the rest are paid.
 *
 * A changed line keeps its place in the basket unless it now joins another.
 */
export async function putCups(
  cup: CupInput,
  replacesLineId: string | null = null,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.transaction('rw', [db.cart_line, db.cart_line_mod], async () => {
    let place: Pick<CartLine, 'id' | 'added_at'> | null = null;
    if (replacesLineId) {
      const old = await db.cart_line.get(replacesLineId);
      if (old) place = { id: old.id, added_at: old.added_at };
      await removeLineInTransaction(replacesLineId, db);
    }

    const paid = cup.qty - (cup.freeReason ? 1 : 0);
    if (paid > 0) place = await putLine(cup, paid, null, place, db);
    if (cup.freeReason) await putLine(cup, 1, cup.freeReason, place, db);
  });
}

/** One line of `putCups`. Returns the place if it was not used. */
async function putLine(
  cup: CupInput,
  qty: number,
  reason: DiscountReason | null,
  place: Pick<CartLine, 'id' | 'added_at'> | null,
  db: RuduPosDB,
): Promise<Pick<CartLine, 'id' | 'added_at'> | null> {
  if (reason === null) {
    const twin = await findPaidTwin(cup, db);
    if (twin) {
      await db.cart_line.update(twin.id, {
        qty: twin.qty + qty,
        sold_out_override: twin.sold_out_override || cup.soldOutOverride,
      });
      return place;
    }
  }

  const line: CartLine = {
    id: place?.id ?? newId(),
    variant_id: cup.variantId,
    qty,
    sold_out_override: cup.soldOutOverride,
    manual_discount_reason: reason,
    added_at: place?.added_at ?? nowIso(),
    synced_at: null,
  };
  await db.cart_line.add(line);
  await db.cart_line_mod.bulkAdd(
    [...new Set(cup.modifierIds)].map((modifierId) => ({
      id: newId(),
      cart_line_id: line.id,
      modifier_id: modifierId,
      synced_at: null,
    })),
  );
  return null;
}

/** A paid line of exactly this cup, choice for choice. */
async function findPaidTwin(cup: CupInput, db: RuduPosDB): Promise<CartLine | undefined> {
  const wanted = new Set(cup.modifierIds);
  for (const line of await db.cart_line.where('variant_id').equals(cup.variantId).toArray()) {
    if ((line.manual_discount_reason ?? null) !== null) continue;
    const mods = await db.cart_line_mod.where('cart_line_id').equals(line.id).toArray();
    const ids = new Set(mods.map((mod) => mod.modifier_id));
    if (ids.size === wanted.size && [...ids].every((id) => wanted.has(id))) return line;
  }
  return undefined;
}

/** Step a line up or down. Stepping below one removes it — never a swipe only. */
export async function stepQty(
  lineId: string,
  delta: number,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.transaction('rw', [db.cart_line, db.cart_line_mod], async () => {
    const line = await db.cart_line.get(lineId);
    if (!line) return;
    // A given-away cup stays one cup: + is how a second free one would slip in.
    if (delta > 0 && (line.manual_discount_reason ?? null) !== null) return;

    const qty = line.qty + delta;
    if (qty <= 0) {
      await removeLineInTransaction(lineId, db);
      return;
    }
    await db.cart_line.update(lineId, { qty });
  });
}

export async function removeLine(lineId: string, db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction('rw', [db.cart_line, db.cart_line_mod], async () => {
    await removeLineInTransaction(lineId, db);
  });
}

/**
 * Switch a line between hot and iced. Temperature is a variant selection, not
 * a second menu button, so the line keeps its quantity and its modifiers —
 * except any that no longer apply to the new variant, which are dropped rather
 * than silently charged for (peach gum is already in the hot BOM).
 */
export async function setVariant(
  lineId: string,
  variantId: string,
  allowedModifierIds: readonly string[],
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.transaction('rw', [db.cart_line, db.cart_line_mod], async () => {
    await db.cart_line.update(lineId, { variant_id: variantId });

    const allowed = new Set(allowedModifierIds);
    const stale = (await db.cart_line_mod.where('cart_line_id').equals(lineId).toArray()).filter(
      (mod) => !allowed.has(mod.modifier_id),
    );
    await db.cart_line_mod.bulkDelete(stale.map((mod) => mod.id));
  });
}

/**
 * Put a modifier on a line, or take it off.
 *
 * Two modifiers that both set the amount of the same thing cannot both be on
 * one cup — "less sweet" and "no added sugar" each say how much syrup goes in
 * — so choosing one takes the other off, the way a radio button would.
 */
export async function toggleModifier(
  lineId: string,
  modifierId: string,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.transaction('rw', [db.cart_line_mod, db.modifier], async () => {
    const onLine = await db.cart_line_mod.where('cart_line_id').equals(lineId).toArray();
    const existing = onLine.filter((mod) => mod.modifier_id === modifierId);

    if (existing.length > 0) {
      await db.cart_line_mod.bulkDelete(existing.map((mod) => mod.id));
      return;
    }

    const role = (await db.modifier.get(modifierId))?.overrides_component_role ?? null;
    if (role !== null) {
      const others = await db.modifier.bulkGet(onLine.map((mod) => mod.modifier_id));
      const clashing = onLine.filter(
        (_mod, index) => others[index]?.overrides_component_role === role,
      );
      await db.cart_line_mod.bulkDelete(clashing.map((mod) => mod.id));
    }

    const mod: CartLineMod = {
      id: newId(),
      cart_line_id: lineId,
      modifier_id: modifierId,
      synced_at: null,
    };
    await db.cart_line_mod.add(mod);
  });
}

/**
 * Give a line away, or take the giveaway back.
 *
 * The reason is the argument: there is no way through this function to zero a
 * line without saying why, because a discount with no reason makes shrinkage
 * and generosity look identical in the day's report (CLAUDE.md §4).
 */
/**
 * Give one cup away — a stamp card's free drink, a staff drink, goodwill — or
 * (null) charge for it again.
 *
 * One cup, never the whole line: on a line of three, the free drink is split
 * off as its own line of one, with the same options, and the other two are
 * still paid for. A whole line going to ฿0 at one tap is money lost without
 * anyone noticing.
 */
export async function setLineDiscountReason(
  lineId: string,
  reason: DiscountReason | null,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.transaction('rw', [db.cart_line, db.cart_line_mod], async () => {
    const line = await db.cart_line.get(lineId);
    if (!line) return;
    if (reason === null || line.qty <= 1) {
      await db.cart_line.update(lineId, { manual_discount_reason: reason });
      return;
    }
    const free: CartLine = {
      ...line,
      id: newId(),
      qty: 1,
      manual_discount_reason: reason,
      added_at: nowIso(),
      synced_at: null,
    };
    await db.cart_line.update(lineId, { qty: line.qty - 1 });
    await db.cart_line.add(free);
    const mods = await db.cart_line_mod.where('cart_line_id').equals(lineId).toArray();
    await db.cart_line_mod.bulkAdd(
      mods.map((mod) => ({ ...mod, id: newId(), cart_line_id: free.id, synced_at: null })),
    );
  });
}

/**
 * Takeaway or dine-in. A setting rather than a cart column: it stays where
 * the operator left it for the next sale, so a run of dine-in customers is
 * one tap, not one per bill — and the standard sale never touches it.
 */
export async function setOrderType(type: OrderType, db: RuduPosDB = defaultDb): Promise<void> {
  await db.setting.put({ key: ORDER_TYPE_KEY, value: type, synced_at: null });
}

export async function clearCart(db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction('rw', [db.cart_line, db.cart_line_mod], async () => {
    await db.cart_line_mod.clear();
    await db.cart_line.clear();
  });
}

async function removeLineInTransaction(lineId: string, db: RuduPosDB): Promise<void> {
  const mods = await db.cart_line_mod.where('cart_line_id').equals(lineId).toArray();
  await db.cart_line_mod.bulkDelete(mods.map((mod) => mod.id));
  await db.cart_line.delete(lineId);
}
