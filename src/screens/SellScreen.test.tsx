/**
 * The sell screen, driven the way the operator drives it.
 *
 * These run against the real singleton database, because the thing worth
 * testing is that a tap reaches IndexedDB and comes back through useLiveQuery
 * — a mocked store would prove nothing about that path.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellScreen from './SellScreen.tsx';
import ScreenHost from '../nav/ScreenHost.tsx';
import { db } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart, loadCart } from '../db/cart-repo.ts';
import { productionMovement } from '../domain/stock.ts';
import type { CashSession, ComponentBatch } from '../db/types.ts';
import { addCup, enabledButton, openDrink, putInBasket } from '../test/helpers.ts';

/** The day these tests trade in. The sell screen is only ever shown inside one. */
const SESSION: CashSession = {
  id: 'SESSION_TEST',
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
  await seedLegacyCatalog(db);
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
  await db.sale_line_mod.clear();
  await db.sale_line_discount.clear();
  await db.setting.delete('order_type');
});

async function tamarindButton() {
  return screen.findByRole('button', { name: /^มะขามแดง/ });
}

/** The sell screen with whatever the เมนู opens over it, as the app has it. */
function renderSell() {
  return render(
    <>
      <SellScreen session={SESSION} />
      <ScreenHost session={SESSION} />
    </>,
  );
}

/** The day's bills: เมนู, then บิลวันนี้ — both labelled, both one tap. */
async function openBills(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'เมนู' }));
  await user.click(await screen.findByRole('button', { name: 'บิลวันนี้' }));
  return screen.findByRole('dialog', { name: 'บิลวันนี้' });
}

describe('the menu', () => {
  it('shows the short name, the price and the available cups with what limits them', async () => {
    render(<SellScreen session={SESSION} />);

    const tamarind = await tamarindButton();
    expect(tamarind).toHaveTextContent('มะขามแดง');
    expect(tamarind).toHaveTextContent('฿40');
    // 1000 g of jelly at 30 g a cup.
    expect(tamarind).toHaveTextContent('เหลือ 33 แก้ว');
    expect(tamarind).toHaveTextContent('เยลลี่เก๊กฮวย');
  });

  it('never renders the full marketing name on a button', async () => {
    render(<SellScreen session={SESSION} />);
    await tamarindButton();

    // สาลี่ขาวสมุนไพรจีน is 18 characters and would wrap to three lines.
    expect(screen.queryByText(/สาลี่ขาวสมุนไพรจีน/)).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /สาลี่ขาว/ })).toHaveTextContent('สาลี่ขาว');
  });
});

describe('ringing a sale', () => {
  it('opens the drink page set to the usual cup, and ใส่ตะกร้า puts it in the basket', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    expect(page).toHaveAccessibleName('มะขามแดง');
    // The usual cup, chosen already: normal sweetness, one of it.
    expect(within(page).getByRole('button', { name: 'หวานปกติ' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Nothing is in the basket until the operator says so.
    expect(await loadCart(db)).toHaveLength(0);

    await putInBasket(user);

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(1));
    const [item] = await loadCart(db);
    expect(item).toMatchObject({ line: { variant_id: 'VAR_TAMARIND_ICED', qty: 1 } });
    expect(item!.modifierIds).toEqual([]);
    expect(await screen.findByRole('button', { name: /^แก้ มะขามแดง/ })).toBeInTheDocument();
  });

  it('leaves without adding anything on ยกเลิก', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: /บ๊วยเค็ม/ }));
    await user.click(within(page).getByRole('button', { name: 'ยกเลิก' }));

    expect(page).not.toBeInTheDocument();
    expect(await loadCart(db)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'พอดี' })).not.toBeInTheDocument();
  });

  it('puts a second identical cup on the same line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await addCup(user, /^มะขามแดง/);

    await waitFor(async () => {
      const cart = await loadCart(db);
      expect(cart).toHaveLength(1);
      expect(cart[0]?.line.qty).toBe(2);
    });
  });

  it('puts several cups in at once from the stepper on the page', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: 'เพิ่มจำนวน' }));
    await user.click(within(page).getByRole('button', { name: 'เพิ่มจำนวน' }));
    expect(within(page).getByRole('button', { name: 'ใส่ตะกร้า ฿120' })).toBeInTheDocument();
    await putInBasket(user);

    await waitFor(async () => expect((await loadCart(db))[0]?.line.qty).toBe(3));
  });

  it('makes two cups of one drink two ways, as two lines of one bill', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const first = await openDrink(user, /^มะขามแดง/);
    await user.click(within(first).getByRole('button', { name: 'หวานน้อย' }));
    await putInBasket(user);
    await addCup(user, /^มะขามแดง/);

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(2));
    const cart = await loadCart(db);
    expect(cart.map((item) => [item.line.qty, item.modifierIds])).toEqual([
      [1, ['PREP_LESS_SWEET']],
      [1, []],
    ]);
    // Said on the line, so the cup is made the way it was asked for.
    expect(screen.getByRole('button', { name: 'แก้ มะขามแดง (หวานน้อย)' })).toBeInTheDocument();
    // One bill: the pair still earns its discount.
    expect(await screen.findByText('฿70')).toBeInTheDocument();
  });

  it('steps a line down from the basket and removes it at zero', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await screen.findByLabelText('ลดจำนวน'));

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(0));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'พอดี' })).not.toBeInTheDocument(),
    );
  });

  it('opens pear as ICED, and HOT is one more tap on its page', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^สาลี่ขาว/);
    expect(within(page).getByRole('button', { name: 'เย็น' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(page).getByRole('button', { name: 'ร้อน' }));
    await putInBasket(user);

    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.variant_id).toBe('VAR_PEAR_HOT');
    });
  });
});

describe('changing a line in the basket', () => {
  it('opens its page as it was, and saves it as one line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await addCup(user, /^มะขามแดง/);
    await user.click(await screen.findByRole('button', { name: /^แก้ มะขามแดง/ }));

    const page = (await screen.findByRole('button', { name: /^บันทึก/ })).closest<HTMLElement>(
      '[role="dialog"]',
    )!;
    // Both cups, as they are.
    expect(within(page).getByText('2')).toBeInTheDocument();
    await user.click(within(page).getByRole('button', { name: 'หวานน้อย' }));
    await user.click(within(page).getByRole('button', { name: 'บันทึก ฿80' }));

    await waitFor(async () =>
      expect((await loadCart(db)).map((item) => [item.line.qty, item.modifierIds])).toEqual([
        [2, ['PREP_LESS_SWEET']],
      ]),
    );
  });

  it('joins a line that is now the same cup as another', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: 'หวานน้อย' }));
    await putInBasket(user);
    await addCup(user, /^มะขามแดง/);
    await waitFor(async () => expect(await loadCart(db)).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'แก้ มะขามแดง (หวานน้อย)' }));
    await user.click(await screen.findByRole('button', { name: 'หวานปกติ' }));
    await putInBasket(user);

    await waitFor(async () =>
      expect((await loadCart(db)).map((item) => item.line.qty)).toEqual([2]),
    );
  });

  it('takes the line out from its page', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await screen.findByRole('button', { name: /^แก้ มะขามแดง/ }));
    await user.click(await screen.findByRole('button', { name: 'เอาออกจากบิล' }));

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(0));
  });
});

describe('choices on the drink page', () => {
  it('hides peach gum on hot pear, where it is already in the recipe', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^สาลี่ขาว/);
    expect(within(page).getByRole('button', { name: /เพิ่มวุ้นยางท้อ/ })).toBeInTheDocument();

    await user.click(within(page).getByRole('button', { name: 'ร้อน' }));

    expect(within(page).queryByRole('button', { name: /เพิ่มวุ้นยางท้อ/ })).not.toBeInTheDocument();
  });

  it('shows the salted plum advisory from the data, not from a string in the code', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: /บ๊วยเค็ม/ }));

    const seeded = await db.modifier.get('MOD_SALTED_PLUM');
    expect(seeded?.advisory_th).toBeTruthy();
    expect(within(page).getByRole('alert')).toHaveTextContent(seeded!.advisory_th!);

    // And again on the basket line, for when the cup is handed over.
    await putInBasket(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(seeded!.advisory_th!);
  });

  it('prices the cup with its toppings, times the cups', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: /บ๊วยเค็ม/ }));
    await user.click(within(page).getByRole('button', { name: 'เพิ่มจำนวน' }));

    expect(within(page).getByRole('button', { name: 'ใส่ตะกร้า ฿90' })).toBeInTheDocument();
  });
});

describe('sold out', () => {
  it('greys the drink but still opens it, and records the override', async () => {
    const user = userEvent.setup();
    // Empty the jelly: every tamarind component but that one is still there.
    await db.component_batch.update('B_COMP_JELLY_CHRYS', { state: 'DISCARDED' });
    try {
      render(<SellScreen session={SESSION} />);

      const tamarind = await screen.findByRole('button', { name: /^มะขามแดง/ });
      await waitFor(() => expect(tamarind).toHaveTextContent('หมด'));
      // Said, not only shown: a screen reader hears it too.
      expect(tamarind).toHaveAccessibleName('มะขามแดง ฿40 — หมด');

      const page = await openDrink(user, /^มะขามแดง/);
      expect(within(page).getByRole('alert')).toHaveTextContent('หมดแล้ว');
      // Selling it anyway is a button that says so, never a quiet ใส่ตะกร้า.
      expect(within(page).queryByRole('button', { name: /^ใส่ตะกร้า/ })).not.toBeInTheDocument();
      expect(await loadCart(db)).toHaveLength(0);

      await user.click(within(page).getByRole('button', { name: 'ขายต่อ ฿40' }));

      await waitFor(async () => {
        const cart = await loadCart(db);
        expect(cart).toHaveLength(1);
        expect(cart[0]?.line.sold_out_override).toBe(true);
      });
    } finally {
      await db.component_batch.update('B_COMP_JELLY_CHRYS', { state: 'CUT' });
    }
  });

  it('says so when more cups are asked for than are left', async () => {
    const user = userEvent.setup();
    // 1000 g of jelly less 940 g: 60 g, at 30 g a cup, is 2 cups.
    await db.stock_movement.put({
      id: 'ALMOST_OUT',
      sale_line_id: null,
      component_batch_id: 'B_COMP_JELLY_CHRYS',
      qty_delta: -940,
      reason: 'ADJUSTMENT',
      reverses_movement_id: null,
      created_at: '2026-09-22T01:00:00.000Z',
      synced_at: null,
    });
    try {
      render(<SellScreen session={SESSION} />);
      const page = await openDrink(user, /^มะขามแดง/);
      expect(within(page).queryByRole('alert')).not.toBeInTheDocument();

      for (let tap = 0; tap < 2; tap += 1) {
        await user.click(within(page).getByRole('button', { name: 'เพิ่มจำนวน' }));
      }
      expect(within(page).getByRole('alert')).toHaveTextContent('เหลือ 2 แก้ว แต่สั่ง 3');
      await user.click(within(page).getByRole('button', { name: 'ขายต่อ ฿120' }));

      await waitFor(async () =>
        expect((await loadCart(db))[0]?.line).toMatchObject({ qty: 3, sold_out_override: true }),
      );
    } finally {
      await db.stock_movement.delete('ALMOST_OUT');
    }
  });
});

describe('running low', () => {
  it('puts the cups left on a yellow block once there are five or fewer', async () => {
    // 1000 g of jelly less 880 g: 120 g, at 30 g a cup, is 4 cups.
    await db.stock_movement.put({
      id: 'RUNNING_LOW',
      sale_line_id: null,
      component_batch_id: 'B_COMP_JELLY_CHRYS',
      qty_delta: -880,
      reason: 'ADJUSTMENT',
      reverses_movement_id: null,
      created_at: '2026-09-22T01:00:00.000Z',
      synced_at: null,
    });
    try {
      render(<SellScreen session={SESSION} />);
      const tamarind = await tamarindButton();
      await waitFor(() => expect(tamarind).toHaveTextContent('เหลือ 4 แก้ว'));
      expect(within(tamarind).getByText(/เหลือ 4 แก้ว/)).toHaveClass('bg-today');
    } finally {
      await db.stock_movement.delete('RUNNING_LOW');
    }
  });

  it('keeps plenty plain', async () => {
    render(<SellScreen session={SESSION} />);
    const tamarind = await tamarindButton();
    await waitFor(() => expect(tamarind).toHaveTextContent('เหลือ 33 แก้ว'));
    expect(within(tamarind).getByText(/เหลือ 33 แก้ว/)).not.toHaveClass('bg-today');
  });

  it('names what limits the drink on its page, for the variant chosen', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    expect(page).toHaveTextContent('เหลือ 33 แก้ว — จำกัดโดยเยลลี่เก๊กฮวย');
  });
});

describe('the two-cup discount', () => {
  it('applies by itself when the cart qualifies — the operator never asks', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await addCup(user, /^มะขามแดง/);

    // 80 less 10 for the pair.
    expect(await screen.findByText('฿70')).toBeInTheDocument();
    expect(screen.getByText(/ส่วนลด 2 แก้ว/)).toBeInTheDocument();
  });

  it('gives nothing on a drink plus a bottle', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await addCup(user, /^ขวดมะขาม 1L/);

    expect(await screen.findByText('฿139')).toBeInTheDocument();
    expect(screen.queryByText(/ส่วนลด 2 แก้ว/)).not.toBeInTheDocument();
  });
});

describe('giving a cup away', () => {
  it('requires a reason, and offers no way to zero a cup without one', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    const free = within(page).getByRole('group', { name: 'แก้วฟรี' });

    // Only the operator's own reasons are offered. The two promotions apply
    // themselves, and offering them by hand would let a forgotten one look
    // like a deliberate one.
    expect(within(free).getByRole('button', { name: 'แลกแสตมป์' })).toBeInTheDocument();
    expect(within(free).getByRole('button', { name: 'พนักงาน' })).toBeInTheDocument();
    expect(within(free).queryByRole('button', { name: 'ส่วนลด 2 แก้ว' })).not.toBeInTheDocument();

    await user.click(within(free).getByRole('button', { name: 'แลกแสตมป์' }));
    expect(within(page).getByRole('button', { name: 'ใส่ตะกร้า ฿0' })).toBeInTheDocument();
    await putInBasket(user);

    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.manual_discount_reason).toBe('LOYALTY_REDEEM');
    });
    expect(await screen.findByText(/ฟรี — แลกแสตมป์/)).toBeInTheDocument();
  });

  it('gives one cup of several away, never the whole line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: 'เพิ่มจำนวน' }));
    await user.click(within(page).getByRole('button', { name: 'แลกแสตมป์' }));
    // Two cups, one of them paid for.
    expect(within(page).getByRole('button', { name: 'ใส่ตะกร้า ฿40' })).toBeInTheDocument();
    await putInBasket(user);

    await waitFor(async () => expect(await loadCart(db)).toHaveLength(2));
    const cart = await loadCart(db);
    expect(cart.map((item) => [item.line.qty, item.line.manual_discount_reason]).sort()).toEqual([
      [1, null],
      [1, 'LOYALTY_REDEEM'],
    ]);
    // The free line cannot be stepped up into a second free cup.
    const freeRow = screen.getByRole('button', { name: /ฟรี — แลกแสตมป์/ }).closest('li')!;
    expect(within(freeRow).getByRole('button', { name: 'เพิ่มจำนวน' })).toBeDisabled();
  });

  it('rings a loyalty cup at zero but still deducts its components', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: 'แลกแสตมป์' }));
    await putInBasket(user);
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.manual_discount_reason).toBe('LOYALTY_REDEEM');
    });

    await user.click(await enabledButton('พอดี'));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const sale = (await db.sale.toArray())[0]!;
    // Out of revenue, into COGS, and still one cup off the stock.
    expect(sale.total_net).toBe(0);
    expect(sale.total_cost).toBeGreaterThan(0);
    expect(
      (await db.stock_movement.where('reason').equals('SALE').toArray()).length,
    ).toBeGreaterThan(0);
  });
});

describe('paying cash', () => {
  it('completes on พอดี, with no change to read', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const sale = (await db.sale.toArray())[0]!;
    expect(sale.total_net).toBe(4000);
    expect(sale.cash_received).toBe(4000);
    expect(sale.cash_change).toBe(0);
    expect(sale.payment_method).toBe('CASH');
    expect(await loadCart(db)).toHaveLength(0);
  });

  it('takes a note in one tap and shows the change, largest on the screen', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('฿100'));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    expect((await db.sale.toArray())[0]).toMatchObject({
      total_net: 4_000,
      cash_received: 10_000,
      cash_change: 6_000,
    });
    const change = await screen.findByText('ทอน ฿60');
    expect(change).toHaveClass('text-5xl');

    // It stays until the next customer's first tap, not on a timer.
    await openDrink(user, /^มะขามแดง/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    await waitFor(() => expect(screen.queryByText('ทอน ฿60')).not.toBeInTheDocument());
  });

  it('only offers notes that cover the bill', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^สาลี่ขาว/);
    await enabledButton('พอดี');

    // 59 THB due: a ฿40 or a ฿50 cannot pay it, so neither is there to be tapped.
    const pay = screen.getByRole('group', { name: 'รับเงิน' });
    expect(within(pay).queryByRole('button', { name: '฿40' })).not.toBeInTheDocument();
    expect(within(pay).queryByRole('button', { name: '฿50' })).not.toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: '฿100' })).toBeEnabled();
  });

  it('writes the discount rows the day report reads', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await addCup(user, /^มะขามแดง/);
    // Paid against the total on the screen, as the operator does.
    expect(await screen.findByText('฿70')).toBeInTheDocument();
    await user.click(await enabledButton('พอดี'));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const discounts = await db.sale_line_discount.toArray();
    expect(discounts).toHaveLength(1);
    expect(discounts[0]).toMatchObject({ reason: 'PROMO_TWO_CUP', amount: 1000 });
    expect((await db.sale.toArray())[0]?.total_net).toBe(7000);
  });
});

describe('the pay buttons', () => {
  it('keep พอดี first and QR second whatever is due, so the thumb learns them', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);
    const order = () =>
      within(screen.getByRole('group', { name: 'รับเงิน' }))
        .getAllByRole('button')
        .slice(0, 2)
        .map((button) => button.textContent);

    await addCup(user, /^มะขามแดง/);
    await waitFor(() => expect(screen.getByRole('button', { name: '฿50' })).toBeInTheDocument());
    expect(order()).toEqual(['พอดี', 'QR']);

    await addCup(user, /^สาลี่ขาว/);
    // ฿89: the ฿50 and ฿59 notes no longer cover it, and nothing slides over.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '฿50' })).not.toBeInTheDocument(),
    );
    expect(order()).toEqual(['พอดี', 'QR']);
  });
});

describe('paying by PromptPay', () => {
  it('says plainly that the app checked nothing, and waits for the operator', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('QR'));

    expect(await screen.findByText(/ระบบไม่ได้ตรวจสอบการโอน/)).toBeInTheDocument();
    // Nothing is recorded until the operator says the money arrived.
    expect(await db.sale.count()).toBe(0);

    await user.click(screen.getByRole('button', { name: 'ลูกค้าจ่ายแล้ว' }));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    const sale = (await db.sale.toArray())[0]!;
    expect(sale.payment_method).toBe('PROMPTPAY');
    expect(sale.cash_received).toBeNull();
  });
});

describe('the receipt', () => {
  it('is never prompted for, and opens from the completed-sale toast', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    // Nothing opened by itself.
    expect(screen.queryByRole('dialog', { name: 'ใบเสร็จ' })).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'ดูใบเสร็จ' }));

    const receipt = await screen.findByRole('dialog', { name: 'ใบเสร็จ' });
    expect(within(receipt).getByText(/มะขามแดง/)).toBeInTheDocument();
    expect(within(receipt).getByText('สุทธิ')).toBeInTheDocument();
    // The shop is not VAT registered: no VAT line, anywhere.
    expect(receipt).not.toHaveTextContent(/VAT|ภาษีมูลค่าเพิ่ม/);
  });
});

describe('an empty basket', () => {
  it('has no pay buttons to press', async () => {
    render(<SellScreen session={SESSION} />);
    await tamarindButton();
    expect(screen.queryByRole('button', { name: 'พอดี' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'QR' })).not.toBeInTheDocument();
  });
});

describe('crash safety', () => {
  /** The closest jsdom gets to a hard reload: everything React held is gone. */
  async function reload() {
    cleanup();
    render(<SellScreen session={SESSION} />);
    await screen.findByRole('button', { name: /^มะขามแดง/ });
  }

  it('survives a reload with an empty basket', async () => {
    render(<SellScreen session={SESSION} />);
    await reload();

    expect(screen.queryByRole('button', { name: 'พอดี' })).not.toBeInTheDocument();
    expect(await loadCart(db)).toHaveLength(0);
  });

  it('keeps nothing of a cup still on its page: it was never put in the basket', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: /บ๊วยเค็ม/ }));

    await reload();

    expect(await loadCart(db)).toHaveLength(0);
  });

  it('survives a reload with one line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await addCup(user, /^มะขามแดง/);
    await waitFor(async () => expect((await loadCart(db))[0]?.line.qty).toBe(2));

    await reload();

    expect(await screen.findByText('2')).toBeInTheDocument();
    expect((await loadCart(db))[0]?.line.qty).toBe(2);
  });

  it('survives a reload with modifiers on the line', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: /บ๊วยเค็ม/ }));
    await putInBasket(user);
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.modifierIds).toEqual(['MOD_SALTED_PLUM']);
    });

    await reload();

    // The modifier is still on the line, and so is its spoken advisory.
    expect(await screen.findByRole('button', { name: /บ๊วยเค็ม/ })).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('ระวังสำลัก');
    expect((await loadCart(db))[0]?.modifierIds).toEqual(['MOD_SALTED_PLUM']);
  });

  it('survives a reload with a line given away', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    const page = await openDrink(user, /^มะขามแดง/);
    await user.click(within(page).getByRole('button', { name: 'แลกแสตมป์' }));
    await putInBasket(user);
    await waitFor(async () => {
      expect((await loadCart(db))[0]?.line.manual_discount_reason).toBe('LOYALTY_REDEEM');
    });

    await reload();

    expect(await screen.findByText(/ฟรี — แลกแสตมป์/)).toBeInTheDocument();
  });

  it('survives a reload on the payment screen, and does not resume a half-taken payment', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('QR'));
    expect(await screen.findByRole('button', { name: 'ลูกค้าจ่ายแล้ว' })).toBeInTheDocument();

    await reload();

    // Back on the sell screen with the cart intact: a payment the phone died
    // in the middle of is not something to carry forward unconfirmed.
    expect(await enabledButton('พอดี')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'ลูกค้าจ่ายแล้ว' })).not.toBeInTheDocument();
    expect(await loadCart(db)).toHaveLength(1);
    expect(await db.sale.count()).toBe(0);
  });

  it('is empty again after a reload that follows a completed sale', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    await reload();

    expect(screen.queryByRole('button', { name: 'พอดี' })).not.toBeInTheDocument();
    expect(await loadCart(db)).toHaveLength(0);
  });
});

describe('the day’s sales', () => {
  it('lists them newest first with queue number, time, items, total and method', async () => {
    const user = userEvent.setup();
    renderSell();

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const list = await openBills(user);
    expect(await within(list).findByText('มะขามแดง')).toBeInTheDocument();
    expect(within(list).getByText(/^คิว 1 · /)).toBeInTheDocument();
    expect(within(list).getByText(/เงินสด · กลับบ้าน/)).toBeInTheDocument();
  });

  it('voids with a reason and puts the stock back', async () => {
    const user = userEvent.setup();
    renderSell();

    // What the tamarind button says before anything is sold.
    const before = (await tamarindButton()).textContent ?? '';

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const list = await openBills(user);
    await user.click(await within(list).findByRole('button', { name: /ยกเลิกบิล/ }));

    // A void cannot happen without a reason being chosen.
    expect(await screen.findByText('ยกเลิกบิลนี้เพราะอะไร?')).toBeInTheDocument();
    expect(await db.sale.get((await db.sale.toArray())[0]!.id)).toMatchObject({
      is_voided: false,
    });

    await user.click(screen.getByRole('button', { name: 'ลูกค้าเปลี่ยนใจ' }));

    await waitFor(async () => {
      expect((await db.sale.toArray())[0]?.is_voided).toBe(true);
    });

    expect(await screen.findByText(/ยกเลิกแล้ว — ลูกค้าเปลี่ยนใจ/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'กลับไปขาย' }));

    // Available cups is back where it started, and so is the day's revenue.
    await waitFor(async () => {
      expect((await tamarindButton()).textContent).toBe(before);
    });
    const movements = await db.stock_movement.where('reason').equals('VOID_REVERSAL').toArray();
    expect(movements.length).toBeGreaterThan(0);
  });
});

describe('a receipt asked for later', () => {
  it('opens from the day’s bills, and goes back to them', async () => {
    const user = userEvent.setup();
    renderSell();

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    // The next customer: the sell screen's own receipt button is gone.
    await openDrink(user, /^มะขามแดง/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.queryByRole('button', { name: 'ดูใบเสร็จ' })).not.toBeInTheDocument();

    const list = await openBills(user);
    await user.click(await within(list).findByRole('button', { name: /^ใบเสร็จ/ }));

    const receipt = await screen.findByRole('dialog', { name: 'ใบเสร็จ' });
    expect(within(receipt).getByText(/มะขามแดง/)).toBeInTheDocument();
    expect(within(receipt).getByText('สุทธิ')).toBeInTheDocument();

    await user.click(within(receipt).getByRole('button', { name: 'กลับไปบิลวันนี้' }));
    expect(screen.queryByRole('dialog', { name: 'ใบเสร็จ' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'บิลวันนี้' })).toBeInTheDocument();
  });
});

describe('today, live', () => {
  const header = () => screen.getByLabelText('ยอดวันนี้');
  const cupsLeft = async () =>
    Number(/เหลือ (\d+) แก้ว/.exec((await tamarindButton()).textContent ?? '')?.[1]);

  async function pay(method: 'เงินสด' | 'QR') {
    const user = userEvent.setup();
    await addCup(user, /^มะขามแดง/);
    if (method === 'เงินสด') {
      await user.click(await enabledButton('พอดี'));
    } else {
      await user.click(await enabledButton('QR'));
      await user.click(await screen.findByRole('button', { name: 'ลูกค้าจ่ายแล้ว' }));
    }
  }

  it('moves cups, revenue, the drawer and available cups with every sale and void', async () => {
    const user = userEvent.setup();
    renderSell();

    await waitFor(() => expect(header()).toHaveTextContent('ลิ้นชัก ฿1,500'));
    expect(header()).toHaveTextContent('0 แก้ว');
    const before = await cupsLeft();

    // Cash: into the drawer.
    await pay('เงินสด');
    await waitFor(() => {
      expect(header()).toHaveTextContent('ลิ้นชัก ฿1,540');
      expect(header()).toHaveTextContent('1 แก้ว');
      expect(header()).toHaveTextContent('฿40');
    });
    await waitFor(async () => expect(await cupsLeft()).toBe(before - 1));

    // QR: the takings move, the drawer does not.
    await pay('QR');
    await waitFor(() => {
      expect(header()).toHaveTextContent('2 แก้ว');
      expect(header()).toHaveTextContent('฿80');
      expect(header()).toHaveTextContent('ลิ้นชัก ฿1,540');
    });

    // Void the cash sale: all of it comes back.
    const list = await openBills(user);
    const buttons = await within(list).findAllByRole('button', { name: /ยกเลิกบิล/ });
    await user.click(buttons[buttons.length - 1]!); // oldest: the cash sale
    await user.click(within(list).getByRole('button', { name: 'กดผิด' }));
    await user.click(within(list).getByRole('button', { name: 'กลับไปขาย' }));

    await waitFor(() => {
      expect(header()).toHaveTextContent('ลิ้นชัก ฿1,500');
      expect(header()).toHaveTextContent('1 แก้ว');
    });
    await waitFor(async () => expect(await cupsLeft()).toBe(before - 1));
  });

  it('marks breakeven: cups against ten, then past it once gross profit covers the day', async () => {
    const fixed = await db.setting.get('fixed_cost_per_day');
    renderSell();
    await waitFor(() => expect(header()).toHaveTextContent('คุ้มทุน 0/10'));

    // A day whose fixed cost one cup covers.
    await db.setting.put({ key: 'fixed_cost_per_day', value: 1_000, synced_at: null });
    try {
      await pay('เงินสด');
      await waitFor(() => expect(header()).toHaveTextContent('ผ่านจุดคุ้มทุน'));

      const user = userEvent.setup();
      const list = await openBills(user);
      expect(await within(list).findByText(/กำไรขั้นต้น .* จาก ฿10/)).toBeInTheDocument();
    } finally {
      await db.setting.put(fixed!);
    }
  });
});

describe('order number, order type and the queue', () => {
  it('calls out the order number on the done line, and keeps dine-in for the next sale', async () => {
    const user = userEvent.setup();
    renderSell();

    await addCup(user, /^มะขามแดง/);
    await user.click(await screen.findByRole('button', { name: 'ทานที่ร้าน' }));
    await waitFor(async () => expect((await db.setting.get('order_type'))?.value).toBe('DINE_IN'));
    await user.click(await enabledButton('พอดี'));
    expect(await screen.findByText('คิว 1')).toBeInTheDocument();

    // The next bill is dine-in too, with nothing touched: still three taps.
    await addCup(user, /^มะขามแดง/);
    expect(await screen.findByRole('button', { name: /ทานที่ร้าน/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(await enabledButton('พอดี'));
    expect(await screen.findByText('คิว 2')).toBeInTheDocument();

    const sales = await db.sale.orderBy('created_at').toArray();
    expect(sales.map((sale) => [sale.order_no, sale.order_type])).toEqual([
      [1, 'DINE_IN'],
      [2, 'DINE_IN'],
    ]);
  });

  it('shows waiting orders in a strip, and one tap says it went out', async () => {
    const user = userEvent.setup();
    renderSell();

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));
    const strip = await screen.findByRole('region', { name: 'คิวรอ' });

    await user.click(within(strip).getByRole('button', { name: 'ส่งคิว 1 แล้ว' }));
    await waitFor(async () => {
      expect((await db.sale.toArray())[0]?.handed_over_at).not.toBeNull();
    });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'คิวรอ' })).not.toBeInTheDocument(),
    );
  });

  it('puts a mis-tapped order back from the คิว screen', async () => {
    const user = userEvent.setup();
    renderSell();

    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));
    await user.click(await screen.findByRole('button', { name: 'ส่งคิว 1 แล้ว' }));

    await user.click(screen.getByRole('button', { name: 'เมนู' }));
    await user.click(await screen.findByRole('button', { name: 'คิว' }));
    const queue = await screen.findByRole('dialog', { name: 'คิว' });
    await user.click(await within(queue).findByRole('button', { name: 'คิว 1 ยังไม่ได้ส่ง' }));

    expect(await within(queue).findByRole('button', { name: 'ส่งคิว 1 แล้ว' })).toBeInTheDocument();
    expect((await db.sale.toArray())[0]?.handed_over_at).toBeNull();
  });
});
