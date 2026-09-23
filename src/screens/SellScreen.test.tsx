/**
 * The sell screen, driven the way the operator drives it.
 *
 * These run against the real singleton database, because the thing worth
 * testing is that a tap reaches IndexedDB and comes back through useLiveQuery
 * — a mocked store would prove nothing about that path.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellScreen from './SellScreen.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart, loadCart } from '../db/cart-repo.ts';
import { productionMovement } from '../domain/stock.ts';
import type { ComponentBatch } from '../db/types.ts';

function batch(componentId: string, qty: number, state: ComponentBatch['state'] = 'READY') {
  const madeAt = '2026-09-22T00:00:00.000Z';
  return {
    id: `B_${componentId}`,
    component_id: componentId,
    made_at: madeAt,
    qty_made: qty,
    state,
    ready_at: madeAt,
    expires_at: '2026-12-25T00:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  } satisfies ComponentBatch;
}

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);

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
});

async function tamarindButton() {
  return screen.findByRole('button', { name: /มะขามแดง/ });
}

describe('the menu', () => {
  it('shows the short name, the price and the available cups with what limits them', async () => {
    render(<SellScreen />);

    const tamarind = await tamarindButton();
    expect(tamarind).toHaveTextContent('มะขามแดง');
    expect(tamarind).toHaveTextContent('฿40');
    // 1000 g of jelly at 30 g a cup.
    expect(tamarind).toHaveTextContent('เหลือ 33 แก้ว');
    expect(tamarind).toHaveTextContent('เยลลี่เก๊กฮวย');
  });

  it('never renders the full marketing name on a button', async () => {
    render(<SellScreen />);
    await tamarindButton();

    // สาลี่ขาวสมุนไพรจีน is 18 characters and would wrap to three lines.
    expect(screen.queryByText(/สาลี่ขาวสมุนไพรจีน/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /สาลี่ขาว/ })).toHaveTextContent('สาลี่ขาว');
  });
});

describe('ringing a sale', () => {
  it('adds a cup on one tap, with no confirmation', async () => {
    const user = userEvent.setup();
    render(<SellScreen />);

    await user.click(await tamarindButton());

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(1));
    expect(await screen.findByLabelText('เพิ่มจำนวน')).toBeInTheDocument();
  });

  it('increments on a second tap rather than adding a row', async () => {
    const user = userEvent.setup();
    render(<SellScreen />);

    const tamarind = await tamarindButton();
    await user.click(tamarind);
    await user.click(tamarind);

    await waitFor(async () => {
      const cart = await loadCart(db);
      expect(cart).toHaveLength(1);
      expect(cart[0]?.line.qty).toBe(2);
    });
  });

  it('steps a line down and removes it at zero', async () => {
    const user = userEvent.setup();
    render(<SellScreen />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('ลดจำนวน'));

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(0));
    expect(screen.getByText('ยังไม่มีรายการ')).toBeInTheDocument();
  });

  it('rings pear as ICED and switches to HOT in one tap on the line', async () => {
    const user = userEvent.setup();
    render(<SellScreen />);

    await user.click(await screen.findByRole('button', { name: /สาลี่ขาว/ }));
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.variant_id).toBe('VAR_PEAR_ICED');
    });

    await user.click(await screen.findByRole('button', { name: 'ร้อน' }));

    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.variant_id).toBe('VAR_PEAR_HOT');
    });
  });
});

describe('modifiers on the line', () => {
  it('hides peach gum on hot pear, where it is already in the recipe', async () => {
    const user = userEvent.setup();
    render(<SellScreen />);

    await user.click(await screen.findByRole('button', { name: /สาลี่ขาว/ }));
    await user.click(await screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    expect(await screen.findByRole('button', { name: /เพิ่มวุ้นยางท้อ/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ร้อน' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /เพิ่มวุ้นยางท้อ/ })).not.toBeInTheDocument();
    });
  });

  it('shows the salted plum advisory from the data, not from a string in the code', async () => {
    const user = userEvent.setup();
    render(<SellScreen />);

    await user.click(await tamarindButton());
    await user.click(await screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    await user.click(await screen.findByRole('button', { name: /บ๊วยเค็ม/ }));

    const advisory = await screen.findByRole('alert');
    const seeded = await db.modifier.get('MOD_SALTED_PLUM');
    expect(seeded?.advisory_th).toBeTruthy();
    expect(advisory).toHaveTextContent(seeded!.advisory_th!);
  });
});

describe('sold out', () => {
  it('greys the drink but still takes the tap, and records the override', async () => {
    const user = userEvent.setup();
    // Empty the jelly: every tamarind component but that one is still there.
    await db.component_batch.update('B_COMP_JELLY_CHRYS', { state: 'DISCARDED' });

    render(<SellScreen />);

    const tamarind = await screen.findByRole('button', { name: /มะขามแดง/ });
    await waitFor(() => expect(tamarind).toHaveTextContent('หมด'));

    await user.click(tamarind);
    expect(await screen.findByText('เลยจำนวนที่มี — ขายต่อ?')).toBeInTheDocument();
    // Nothing was added until the operator said so.
    expect(await loadCart(db)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'ขายต่อ' }));

    await waitFor(async () => {
      const cart = await loadCart(db);
      expect(cart).toHaveLength(1);
      expect(cart[0]?.line.sold_out_override).toBe(true);
    });

    await db.component_batch.update('B_COMP_JELLY_CHRYS', { state: 'CUT' });
  });
});

describe('payment', () => {
  it('writes the sale, deducts the stock and empties the cart', async () => {
    const user = userEvent.setup();
    render(<SellScreen />);

    await user.click(await tamarindButton());
    await waitFor(async () => expect(await loadCart(db)).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'เงินสด' }));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const sale = (await db.sale.toArray())[0]!;
    expect(sale.total_net).toBe(4000);
    expect(sale.payment_method).toBe('CASH');
    expect(sale.is_voided).toBe(false);

    // The cart is empty and today's header has moved.
    expect(await loadCart(db)).toHaveLength(0);
    const header = screen.getByRole('banner');
    await waitFor(() => expect(within(header).getByText(/฿40/)).toBeInTheDocument());

    // Stock came off in the same transaction.
    const movements = await db.stock_movement.where('reason').equals('SALE').toArray();
    expect(movements.length).toBeGreaterThan(0);
  });

  it('does nothing on an empty cart', async () => {
    render(<SellScreen />);
    const cash = await screen.findByRole('button', { name: 'เงินสด' });
    expect(cash).toBeDisabled();
  });
});
