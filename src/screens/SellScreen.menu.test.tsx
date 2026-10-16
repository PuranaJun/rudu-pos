/**
 * The sell screen on the real menu of Oct 2026 — fifteen buttons, sweetness,
 * Yakult, three plain teas behind one button, each drink's own page — driven
 * the way the operator drives it. SellScreen.test.tsx covers the flow itself on the small fixture
 * menu; this is what changes when the menu is long.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellScreen from './SellScreen.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart, loadCart } from '../db/cart-repo.ts';
import { stockSampleDay } from '../db/sample-day.ts';
import { PRODUCTS } from '../data/seed.ts';
import type { CashSession } from '../db/types.ts';
import { enabledButton, openDrink, putInBasket } from '../test/helpers.ts';

const SESSION: CashSession = {
  id: 'SESSION_MENU',
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

/** 56px tall, the size of every button on a standard sale. */
const LARGE = /(^|\s)(min-h-touch-lg|size-touch-lg|min-h-\[7\.5rem\])(\s|$)/;

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
  await stockSampleDay(db);
});

beforeEach(async () => {
  await clearCart(db);
  await db.sale.clear();
  await db.sale_line.clear();
  await db.sale_line_mod.clear();
});

/** Open a drink's page on the real menu. */
async function open(name: RegExp) {
  const user = userEvent.setup();
  render(<SellScreen session={SESSION} />);
  const page = await openDrink(user, name);
  return { user, page };
}

/** What a group on the page offers, in order, and which one is chosen. */
function group(page: HTMLElement, name: string) {
  const buttons = within(within(page).getByRole('group', { name })).getAllByRole('button');
  return {
    names: buttons.map((button) => button.textContent),
    chosen: buttons
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => button.textContent),
  };
}

describe('the long menu', () => {
  it('shows every product as a full-size button, never truncated', async () => {
    render(<SellScreen session={SESSION} />);
    const menu = await screen.findByLabelText('เมนู');
    for (const product of PRODUCTS) {
      const button = await within(menu).findByRole('button', {
        name: new RegExp(`^${product.name_short_th} `),
      });
      expect(button.className, product.name_short_th).toMatch(LARGE);
      expect(button.textContent).toContain(product.name_short_th);
      expect(button.textContent).not.toContain('…');
    }
    // It scrolls on a phone, so the basket and the pay buttons stay in reach.
    expect(menu.className).toContain('overflow-y-auto');
  });
});

describe('a cup on the long menu', () => {
  it('opens at normal sweetness, and takes one sweetness at a time', async () => {
    const { user, page } = await open(/^ส้มจี๊ด /);
    expect(group(page, 'ความหวาน')).toEqual({
      names: ['หวานปกติ', 'หวานมาก', 'หวานน้อย', 'หวานน้อยมาก', 'ไม่เติมน้ำตาล'],
      chosen: ['หวานปกติ'],
    });

    await user.click(within(page).getByRole('button', { name: 'หวานน้อย' }));
    expect(group(page, 'ความหวาน').chosen).toEqual(['หวานน้อย']);
    await user.click(within(page).getByRole('button', { name: 'ไม่เติมน้ำตาล' }));
    expect(group(page, 'ความหวาน').chosen).toEqual(['ไม่เติมน้ำตาล']);

    await putInBasket(user);
    await waitFor(async () =>
      expect((await loadCart(db))[0]!.modifierIds).toEqual(['PREP_NO_SUGAR']),
    );
  });

  it('offers only the sweetness the recipe has: no หวานมาก on the longan, none on the jelly cup', async () => {
    const { user, page } = await open(/^ลำไยขิง /);
    expect(group(page, 'ความหวาน').names).toEqual(['หวานปกติ', 'หวานน้อย', 'หวานน้อยมาก']);
    await user.click(within(page).getByRole('button', { name: 'ยกเลิก' }));

    const jelly = await openDrink(user, /^เยลลี่สาลี่ /);
    expect(within(jelly).queryByRole('group', { name: 'ความหวาน' })).not.toBeInTheDocument();
  });

  it('takes Yakult as a topping, on top of a sweetness', async () => {
    const { user, page } = await open(/^ส้มจี๊ด /);
    await user.click(within(page).getByRole('button', { name: 'หวานน้อย' }));
    await user.click(within(page).getByRole('button', { name: /ยาคูลท์/ }));
    expect(within(page).getByRole('button', { name: 'ใส่ตะกร้า ฿60' })).toBeInTheDocument();
    await putInBasket(user);

    await waitFor(async () =>
      expect((await loadCart(db))[0]!.modifierIds.sort()).toEqual(
        ['MOD_YAKULT', 'PREP_LESS_SWEET'].sort(),
      ),
    );
  });

  it('chooses the plain tea by name on its page, each at its own price', async () => {
    const { user, page } = await open(/^ชาล้วน /);
    expect(group(page, 'แบบ')).toEqual({
      names: ['ชาแดง฿35', 'ชามะลิ฿39', 'ชาขาว฿45'],
      chosen: ['ชาแดง฿35'],
    });
    for (const button of within(within(page).getByRole('group', { name: 'แบบ' })).getAllByRole(
      'button',
    )) {
      expect(button.className).toMatch(LARGE);
    }

    await user.click(within(page).getByRole('button', { name: /^ชามะลิ/ }));
    expect(within(page).getByRole('button', { name: 'ใส่ตะกร้า ฿39' })).toBeInTheDocument();
    await putInBasket(user);
    await waitFor(async () =>
      expect((await loadCart(db))[0]!.line.variant_id).toBe('VAR_PLAIN_JASMINE'),
    );
  });

  it('says the roselle warning on its page', async () => {
    const { page } = await open(/^สตรอว์เบอร์รี /);
    expect(within(page).getByText(/ควรปรึกษาแพทย์ก่อนดื่มกระเจี๊ยบ/)).toBeInTheDocument();
  });
});

describe('one drink, made two ways, in one bill', () => {
  it('rings one ส้มจี๊ด less sweet and one extra sweet, and pours each its own syrup', async () => {
    const { user, page } = await open(/^ส้มจี๊ด /);
    await user.click(within(page).getByRole('button', { name: 'หวานน้อย' }));
    await putInBasket(user);
    const second = await openDrink(user, /^ส้มจี๊ด /);
    await user.click(within(second).getByRole('button', { name: 'หวานมาก' }));
    await putInBasket(user);

    // Two lines in the basket, each saying how its cup is made.
    expect(
      await screen.findByRole('button', { name: 'แก้ ส้มจี๊ด (หวานน้อย)' }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'แก้ ส้มจี๊ด (หวานมาก)' }),
    ).toBeInTheDocument();

    // Paid for at once: 45 + 45, one pair, −10.
    expect(await screen.findByText('฿80')).toBeInTheDocument();
    await user.click(await enabledButton('฿100'));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    const [sale] = await db.sale.toArray();
    expect(sale).toMatchObject({ total_net: 8_000, cash_change: 2_000 });
    const lines = await db.sale_line.where('sale_id').equals(sale!.id).toArray();
    expect(lines.map((line) => line.qty)).toEqual([1, 1]);
    expect((await db.sale_line_mod.toArray()).map((mod) => mod.modifier_id).sort()).toEqual([
      'PREP_EXTRA_SWEET',
      'PREP_LESS_SWEET',
    ]);

    // Off the stock, each cup as it was made: 2 pumps of syrup for the less
    // sweet one, 4 for the extra sweet one.
    const syrupBatches = new Set(
      (await db.component_batch.where('component_id').equals('COMP_SYRUP').toArray()).map(
        (batch) => batch.id,
      ),
    );
    const poured = (await db.stock_movement.where('reason').equals('SALE').toArray())
      .filter((movement) => syrupBatches.has(movement.component_batch_id))
      .map((movement) => -movement.qty_delta)
      .sort((a, b) => a - b);
    expect(poured).toEqual([20, 40]);
  });
});
