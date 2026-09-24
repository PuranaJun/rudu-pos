/**
 * The sell path, counted (CLAUDE.md §0, §6.1). Every tap goes through one
 * counter, and each flow must end in the sale it was meant to ring. Plain
 * tamarind paid in cash is two taps — the number the whole app is built
 * around — and this holds it there.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellScreen from '../screens/SellScreen.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart } from '../db/cart-repo.ts';
import { productionMovement } from '../domain/stock.ts';
import { enabledButton } from './helpers.ts';
import type { BatchState, CashSession, ComponentBatch } from '../db/types.ts';

const SESSION: CashSession = {
  id: 'SESSION_TAPS',
  opened_at: new Date().toISOString(),
  closed_at: null,
  operator_id: 'เจ้าของ',
  opening_float: 150_000,
  expected_cash: null,
  counted_cash: null,
  variance: null,
  note: null,
  synced_at: null,
};

function batch(componentId: string, qty: number, state: BatchState = 'READY'): ComponentBatch {
  const madeAt = new Date(Date.now() - 6 * 3_600_000).toISOString();
  return {
    id: `TAPS_${componentId}`,
    component_id: componentId,
    made_at: madeAt,
    qty_made: qty,
    state,
    ready_at: madeAt,
    expires_at: new Date(Date.now() + 48 * 3_600_000).toISOString(),
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
}

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
  // A full morning, so no drink asks for a sold-out confirmation.
  const batches = [
    batch('COMP_TEA_RED', 5000),
    batch('COMP_TEA_WHITE', 4000),
    batch('COMP_CONC_TAMARIND', 3000),
    batch('COMP_CONC_PEAR', 3000),
    batch('COMP_JELLY_CHRYS', 1000, 'CUT'),
    batch('COMP_JELLY_WHITE_GOJI', 1000, 'CUT'),
    batch('COMP_PEAR_FRESH', 420),
    batch('COMP_PEACH_GUM', 350, 'BLANCHED'),
    batch('COMP_BASIL_SEED', 250),
  ];
  await db.component_batch.bulkPut(batches);
  await db.stock_movement.bulkPut(batches.map((entry) => productionMovement(entry, entry.made_at)));
});

beforeEach(async () => {
  await clearCart(db);
  await db.sale.clear();
  await db.sale_line.clear();
  await db.sale_line_mod.clear();
});

/** Every tap the operator makes, through one door. */
function counter() {
  const user = userEvent.setup();
  let taps = 0;
  return {
    get taps() {
      return taps;
    },
    async tap(target: Promise<HTMLElement> | HTMLElement) {
      taps += 1;
      await user.click(await target);
    },
  };
}

const drink = (name: RegExp) => screen.findByRole('button', { name });

async function theSale() {
  await waitFor(async () => expect(await db.sale.count()).toBe(1));
  const sale = (await db.sale.toArray())[0]!;
  const lines = await db.sale_line.where('sale_id').equals(sale.id).toArray();
  const mods = await db.sale_line_mod.toArray();
  return { sale, lines, mods };
}

describe('taps to ring a sale', () => {
  it('plain tamarind, cash: 2', async () => {
    const operator = counter();
    render(<SellScreen session={SESSION} />);

    await operator.tap(drink(/^มะขามแดง/));
    await operator.tap(enabledButton('พอดี'));

    const { sale, lines } = await theSale();
    expect(operator.taps).toBe(2);
    expect(sale).toMatchObject({ payment_method: 'CASH', total_net: 4_000 });
    expect(lines).toMatchObject([{ variant_id: 'VAR_TAMARIND_ICED', qty: 1 }]);
  });

  it('pear hot, cash: 3', async () => {
    const operator = counter();
    render(<SellScreen session={SESSION} />);

    await operator.tap(drink(/^สาลี่ขาว/));
    await operator.tap(screen.findByRole('button', { name: 'ร้อน' }));
    await waitFor(async () =>
      expect((await db.cart_line.toArray())[0]?.variant_id).toBe('VAR_PEAR_HOT'),
    );
    await operator.tap(enabledButton('พอดี'));

    const { sale, lines } = await theSale();
    expect(operator.taps).toBe(3);
    expect(sale).toMatchObject({ payment_method: 'CASH', total_net: 5_900 });
    expect(lines).toMatchObject([{ variant_id: 'VAR_PEAR_HOT', qty: 1 }]);
  });

  it('2 tamarind + 1 pear, QR: 5', async () => {
    const operator = counter();
    render(<SellScreen session={SESSION} />);

    await operator.tap(drink(/^มะขามแดง/));
    await waitFor(async () => expect(await db.cart_line.count()).toBe(1));
    // The second identical drink is the same line, one higher (CLAUDE.md §6.1).
    await operator.tap(drink(/^มะขามแดง/));
    await waitFor(async () => expect((await db.cart_line.toArray())[0]?.qty).toBe(2));
    await operator.tap(drink(/^สาลี่ขาว/));
    // A wait, not a tap: the operator reads the total before taking payment.
    expect(await screen.findByText('฿129')).toBeInTheDocument();
    await operator.tap(enabledButton('QR'));
    await operator.tap(screen.findByRole('button', { name: 'ลูกค้าจ่ายแล้ว' }));

    const { sale, lines } = await theSale();
    expect(operator.taps).toBe(5);
    // 40 + 40 + 59, one pair: −10.
    expect(sale).toMatchObject({ payment_method: 'PROMPTPAY', total_net: 12_900 });
    expect(lines.map((line) => [line.variant_id, line.qty]).sort()).toEqual([
      ['VAR_PEAR_ICED', 1],
      ['VAR_TAMARIND_ICED', 2],
    ]);
  });

  it('tamarind with salted plum, cash: 4', async () => {
    const operator = counter();
    render(<SellScreen session={SESSION} />);

    await operator.tap(drink(/^มะขามแดง/));
    await operator.tap(screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    await operator.tap(screen.findByRole('button', { name: /บ๊วยเค็ม/ }));
    await waitFor(async () => expect(await db.cart_line_mod.count()).toBe(1));
    await operator.tap(enabledButton('พอดี'));

    const { sale, mods } = await theSale();
    expect(operator.taps).toBe(4);
    expect(sale.total_net).toBe(4_500);
    expect(mods).toMatchObject([{ modifier_id: 'MOD_SALTED_PLUM' }]);
  });
});
