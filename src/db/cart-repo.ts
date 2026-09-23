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
import type { CartLine, CartLineMod } from './types.ts';
import { newId, nowIso } from '../lib/id.ts';

export interface CartItem {
  line: CartLine;
  modifierIds: string[];
}

export async function loadCart(db: RuduPosDB = defaultDb): Promise<CartItem[]> {
  const [lines, mods] = await Promise.all([db.cart_line.toArray(), db.cart_line_mod.toArray()]);

  return lines
    .sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id))
    .map((line) => ({
      line,
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
      .filter((line) => !modded.has(line.id))
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
      added_at: nowIso(),
      synced_at: null,
    };
    await db.cart_line.add(line);
    return line.id;
  });
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

export async function toggleModifier(
  lineId: string,
  modifierId: string,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.transaction('rw', db.cart_line_mod, async () => {
    const existing = await db.cart_line_mod
      .where('cart_line_id')
      .equals(lineId)
      .filter((mod) => mod.modifier_id === modifierId)
      .toArray();

    if (existing.length > 0) {
      await db.cart_line_mod.bulkDelete(existing.map((mod) => mod.id));
      return;
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
