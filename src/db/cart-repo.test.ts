import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { seedLegacyCatalog } from './legacy-catalog.ts';
import {
  addDrink,
  clearCart,
  loadCart,
  putCups,
  removeLine,
  setVariant,
  stepQty,
  toggleModifier,
  type CupInput,
} from './cart-repo.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-cart-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await seedLegacyCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

describe('adding drinks', () => {
  it('rings one cup on the first tap', async () => {
    await addDrink('VAR_TAMARIND_ICED', {}, db);

    const cart = await loadCart(db);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.line).toMatchObject({ variant_id: 'VAR_TAMARIND_ICED', qty: 1 });
  });

  it('increments rather than stacking a second identical row', async () => {
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);

    const cart = await loadCart(db);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.line.qty).toBe(3);
  });

  it('leaves a line that has modifiers alone and starts a plain one', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await toggleModifier(lineId, 'MOD_SALTED_PLUM', db);

    await addDrink('VAR_TAMARIND_ICED', {}, db);

    const cart = await loadCart(db);
    expect(cart).toHaveLength(2);
    expect(cart.find((item) => item.modifierIds.length > 0)?.line.qty).toBe(1);
    expect(cart.find((item) => item.modifierIds.length === 0)?.line.qty).toBe(1);
  });

  it('records a sold-out override on the line', async () => {
    await addDrink('VAR_PEAR_ICED', { soldOutOverride: true }, db);
    expect((await loadCart(db))[0]?.line.sold_out_override).toBe(true);
  });
});

describe('the stepper', () => {
  it('steps up and down', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await stepQty(lineId, 1, db);
    await stepQty(lineId, 1, db);
    await stepQty(lineId, -1, db);

    expect((await loadCart(db))[0]?.line.qty).toBe(2);
  });

  it('removes the line when it steps below one, without a swipe', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await toggleModifier(lineId, 'MOD_BASIL_SEED', db);

    await stepQty(lineId, -1, db);

    expect(await loadCart(db)).toHaveLength(0);
    // The modifier row went with it rather than orphaning.
    expect(await db.cart_line_mod.count()).toBe(0);
  });

  it('removes a line outright', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await removeLine(lineId, db);
    expect(await loadCart(db)).toHaveLength(0);
  });
});

describe('temperature', () => {
  it('switches the variant and keeps the quantity', async () => {
    const lineId = await addDrink('VAR_PEAR_ICED', {}, db);
    await stepQty(lineId, 1, db);

    await setVariant(lineId, 'VAR_PEAR_HOT', ['PREP_LESS_SWEET'], db);

    const cart = await loadCart(db);
    expect(cart[0]?.line).toMatchObject({ variant_id: 'VAR_PEAR_HOT', qty: 2 });
  });

  it('drops peach gum when the line goes hot — it is already in that BOM', async () => {
    const lineId = await addDrink('VAR_PEAR_ICED', {}, db);
    await toggleModifier(lineId, 'MOD_PEACH_GUM', db);
    expect((await loadCart(db))[0]?.modifierIds).toEqual(['MOD_PEACH_GUM']);

    // The allowed list is whatever applies to the new variant.
    await setVariant(lineId, 'VAR_PEAR_HOT', ['PREP_LESS_SWEET', 'PREP_NO_SOLIDS'], db);

    expect((await loadCart(db))[0]?.modifierIds).toEqual([]);
  });
});

describe('modifiers', () => {
  it('toggles on and off', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);

    await toggleModifier(lineId, 'MOD_BASIL_SEED', db);
    expect((await loadCart(db))[0]?.modifierIds).toEqual(['MOD_BASIL_SEED']);

    await toggleModifier(lineId, 'MOD_BASIL_SEED', db);
    expect((await loadCart(db))[0]?.modifierIds).toEqual([]);
  });

  it('allows combinations', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await toggleModifier(lineId, 'MOD_BASIL_SEED', db);
    await toggleModifier(lineId, 'MOD_SALTED_PLUM', db);

    expect((await loadCart(db))[0]?.modifierIds.sort()).toEqual([
      'MOD_BASIL_SEED',
      'MOD_SALTED_PLUM',
    ]);
  });
});

describe('crash safety', () => {
  it('survives the app being closed and reopened mid-cart', async () => {
    const lineId = await addDrink('VAR_PEAR_ICED', {}, db);
    await toggleModifier(lineId, 'MOD_PEACH_GUM', db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    const before = await loadCart(db);

    // Force-quit: the connection goes away entirely.
    db.close();
    db = new RuduPosDB(dbName);
    await db.open();

    expect(await loadCart(db)).toEqual(before);
  });

  it('clears on demand', async () => {
    const lineId = await addDrink('VAR_TAMARIND_ICED', {}, db);
    await toggleModifier(lineId, 'MOD_BASIL_SEED', db);

    await clearCart(db);

    expect(await loadCart(db)).toHaveLength(0);
    expect(await db.cart_line_mod.count()).toBe(0);
  });
});

describe('cups from the drink page', () => {
  const cup = (over: Partial<CupInput> = {}): CupInput => ({
    variantId: 'VAR_TAMARIND_ICED',
    modifierIds: [],
    qty: 1,
    freeReason: null,
    soldOutOverride: false,
    ...over,
  });

  it('puts the cups in as one line, with their choices', async () => {
    await putCups(cup({ qty: 2, modifierIds: ['MOD_SALTED_PLUM', 'PREP_LESS_SWEET'] }), null, db);

    const cart = await loadCart(db);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.line).toMatchObject({ qty: 2, manual_discount_reason: null });
    expect([...cart[0]!.modifierIds].sort()).toEqual(['MOD_SALTED_PLUM', 'PREP_LESS_SWEET']);
  });

  it('joins the same cup already in the basket, in any order of its choices', async () => {
    await putCups(cup({ modifierIds: ['MOD_SALTED_PLUM', 'PREP_LESS_SWEET'] }), null, db);
    await putCups(cup({ modifierIds: ['PREP_LESS_SWEET', 'MOD_SALTED_PLUM'] }), null, db);

    const cart = await loadCart(db);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.line.qty).toBe(2);
  });

  it('keeps a cup made another way on a line of its own', async () => {
    await putCups(cup({ modifierIds: ['PREP_LESS_SWEET'] }), null, db);
    await putCups(cup(), null, db);
    await putCups(cup({ variantId: 'VAR_PEAR_ICED', modifierIds: ['PREP_LESS_SWEET'] }), null, db);

    const cart = await loadCart(db);
    expect(cart.map((item) => [item.line.variant_id, item.modifierIds])).toEqual([
      ['VAR_TAMARIND_ICED', ['PREP_LESS_SWEET']],
      ['VAR_TAMARIND_ICED', []],
      ['VAR_PEAR_ICED', ['PREP_LESS_SWEET']],
    ]);
  });

  it('gives one cup of several away, as a line of one beside the paid ones', async () => {
    await putCups(cup({ qty: 3, freeReason: 'LOYALTY_REDEEM' }), null, db);

    const cart = await loadCart(db);
    expect(
      cart.map((item) => [item.line.qty, item.line.manual_discount_reason ?? null]).sort(),
    ).toEqual([
      [1, 'LOYALTY_REDEEM'],
      [2, null],
    ]);
  });

  it('never joins a free cup to anything', async () => {
    await putCups(cup({ freeReason: 'STAFF_DRINK' }), null, db);
    await putCups(cup({ freeReason: 'STAFF_DRINK' }), null, db);
    await putCups(cup(), null, db);

    const cart = await loadCart(db);
    expect(cart.map((item) => item.line.qty)).toEqual([1, 1, 1]);
  });

  it('records the override, and keeps it on the line it joins', async () => {
    await putCups(cup(), null, db);
    await putCups(cup({ soldOutOverride: true }), null, db);

    expect((await loadCart(db))[0]?.line).toMatchObject({ qty: 2, sold_out_override: true });
  });

  it('changes a line in place, keeping its place in the basket', async () => {
    await putCups(cup(), null, db);
    await putCups(cup({ variantId: 'VAR_PEAR_ICED' }), null, db);
    const [first] = await loadCart(db);

    await putCups(cup({ qty: 2, modifierIds: ['PREP_LESS_SWEET'] }), first!.line.id, db);

    const cart = await loadCart(db);
    expect(cart.map((item) => [item.line.id, item.line.qty, item.modifierIds])).toEqual([
      [first!.line.id, 2, ['PREP_LESS_SWEET']],
      [cart[1]!.line.id, 1, []],
    ]);
    expect(await db.cart_line_mod.count()).toBe(1);
  });

  it('joins a changed line to one it now matches', async () => {
    await putCups(cup({ modifierIds: ['PREP_LESS_SWEET'] }), null, db);
    await putCups(cup(), null, db);
    const [lessSweet] = await loadCart(db);

    await putCups(cup(), lessSweet!.line.id, db);

    const cart = await loadCart(db);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.line.qty).toBe(2);
    expect(await db.cart_line_mod.count()).toBe(0);
  });

  it('will not step a free cup up into a second one', async () => {
    await putCups(cup({ freeReason: 'LOYALTY_REDEEM' }), null, db);
    const [free] = await loadCart(db);

    await stepQty(free!.line.id, 1, db);
    expect((await loadCart(db))[0]?.line.qty).toBe(1);

    await stepQty(free!.line.id, -1, db);
    expect(await loadCart(db)).toHaveLength(0);
  });
});
