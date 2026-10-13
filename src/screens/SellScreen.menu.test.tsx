/**
 * The sell screen on the real menu of Oct 2026 — fifteen buttons, sweetness,
 * Yakult, three plain teas behind one button — driven the way the operator
 * drives it. SellScreen.test.tsx covers the flow itself on the small fixture
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
});

async function ring(name: RegExp) {
  const user = userEvent.setup();
  render(<SellScreen session={SESSION} />);
  await user.click(await screen.findByRole('button', { name }));
  // Anything sold out asks first; the operator may stretch a batch.
  const confirm = screen.queryByRole('button', { name: 'ขายต่อ' });
  if (confirm) await user.click(confirm);
  await waitFor(async () => expect(await loadCart(db)).toHaveLength(1));
  // Saved is not yet drawn: under a full parallel run the live query can take
  // a moment to bring the line back to the screen.
  await screen.findByRole('button', { name: 'ลดจำนวน' });
  return user;
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
    // It scrolls on a phone, so the cart and the pay buttons stay in reach.
    expect(menu.className).toContain('overflow-y-auto');
  });
});

describe('a cup on the long menu', () => {
  it('is normal sweetness unless asked, and one sweetness at a time', async () => {
    const user = await ring(/^ส้มจี๊ด /);
    expect((await loadCart(db))[0]!.modifierIds).toEqual([]);

    await user.click(screen.getByRole('button', { name: /ความหวาน/ }));
    const sweetness = screen.getByRole('group', { name: 'ความหวาน' });
    expect(
      within(sweetness)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['หวานน้อย', 'หวานน้อยมาก', 'ไม่เติมน้ำตาล']);

    await user.click(within(sweetness).getByRole('button', { name: 'หวานน้อย' }));
    await waitFor(async () =>
      expect((await loadCart(db))[0]!.modifierIds).toEqual(['PREP_LESS_SWEET']),
    );
    await user.click(within(sweetness).getByRole('button', { name: 'ไม่เติมน้ำตาล' }));
    await waitFor(async () =>
      expect((await loadCart(db))[0]!.modifierIds).toEqual(['PREP_NO_SUGAR']),
    );
  });

  it('takes Yakult as a topping, on top of a sweetness', async () => {
    const user = await ring(/^ส้มจี๊ด /);
    await user.click(screen.getByRole('button', { name: /ความหวาน/ }));
    await user.click(screen.getByRole('button', { name: 'หวานน้อย' }));
    await user.click(screen.getByLabelText('เพิ่มท็อปปิ้ง'));
    await user.click(screen.getByRole('button', { name: /ยาคูลท์/ }));

    await waitFor(async () =>
      expect((await loadCart(db))[0]!.modifierIds.sort()).toEqual(
        ['MOD_YAKULT', 'PREP_LESS_SWEET'].sort(),
      ),
    );
  });

  it('chooses the plain tea by name on the line', async () => {
    const user = await ring(/^ชาล้วน /);
    for (const name of ['ชาแดง', 'ชามะลิ', 'ชาขาว']) {
      expect(screen.getByRole('button', { name }).className).toMatch(LARGE);
    }
    await user.click(screen.getByRole('button', { name: 'ชามะลิ' }));
    await waitFor(async () =>
      expect((await loadCart(db))[0]!.line.variant_id).toBe('VAR_PLAIN_JASMINE'),
    );
  });

  it('says the roselle warning on the line', async () => {
    await ring(/^สตรอว์เบอร์รี /);
    expect(await screen.findByText(/ควรปรึกษาแพทย์ก่อนดื่มกระเจี๊ยบ/)).toBeInTheDocument();
  });
});
