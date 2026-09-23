import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { ensureSeeded } from './seed.ts';
import {
  addDrink,
  clearCart,
  loadCart,
  removeLine,
  setVariant,
  stepQty,
  toggleModifier,
} from './cart-repo.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-cart-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
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
