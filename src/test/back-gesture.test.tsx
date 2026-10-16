/**
 * Android's back gesture, everywhere: it does what the page's own back button
 * does — one level at a time, asking first about unsaved changes — and never
 * leaves the app from a page. `history.back()` is the gesture as the browser
 * delivers it.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';
import SettingsScreen from '../screens/SettingsScreen.tsx';
import { db } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart, loadCart } from '../db/cart-repo.ts';
import { openSession } from '../db/session-repo.ts';
import { addCup, BACK, enabledButton } from './helpers.ts';

type User = ReturnType<typeof userEvent.setup>;

const back = () => window.history.back();

beforeAll(async () => {
  await seedLegacyCatalog(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  await clearCart(db);
  await db.sale.clear();
  await db.cash_session.clear();
  await openSession({ operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false }, db);
});

async function openHub(user: User) {
  await user.click(await screen.findByRole('button', { name: 'เมนู' }));
  return screen.findByRole('dialog', { name: 'เมนู' });
}

describe('the back gesture', () => {
  it('closes the เมนู hub, back to selling', async () => {
    const user = userEvent.setup();
    render(<App />);

    const hub = await openHub(user);
    back();

    await waitFor(() => expect(hub).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: /^มะขามแดง/ })).toBeInTheDocument();
  });

  it('goes back one page at a time: the receipt to the bills, the bills to selling', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('พอดี'));
    await waitFor(async () => expect(await db.sale.count()).toBe(1));

    const hub = await openHub(user);
    await user.click(within(hub).getByRole('button', { name: 'บิลวันนี้' }));
    const bills = await screen.findByRole('dialog', { name: 'บิลวันนี้' });
    await user.click(await within(bills).findByRole('button', { name: /^ใบเสร็จ/ }));
    const receipt = await screen.findByRole('dialog', { name: 'ใบเสร็จ' });

    back();
    await waitFor(() => expect(receipt).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'บิลวันนี้' })).toBeInTheDocument();

    back();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^มะขามแดง/ })).toBeInTheDocument();
  });

  it('leaves the QR without taking the payment, and keeps the basket', async () => {
    const user = userEvent.setup();
    render(<App />);
    await addCup(user, /^มะขามแดง/);
    await user.click(await enabledButton('QR'));
    const paid = await screen.findByRole('button', { name: 'ลูกค้าจ่ายแล้ว' });

    back();

    await waitFor(() => expect(paid).not.toBeInTheDocument());
    expect(await enabledButton('พอดี')).toBeInTheDocument();
    expect(await loadCart(db)).toHaveLength(1);
    expect(await db.sale.count()).toBe(0);
  });

  it('asks about unsaved changes, and a second gesture keeps editing', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await user.click(await screen.findByRole('button', { name: /^มะขามแดง/ }));
    await screen.findByRole('region', { name: 'มะขามแดง' });
    const price = screen.getByLabelText('ราคา');
    await user.clear(price);
    await user.type(price, '45');

    back();
    const sheet = await screen.findByRole('alertdialog', { name: 'มีการแก้ที่ยังไม่บันทึก' });

    back();
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'มะขามแดง' })).toBeInTheDocument();
    expect(screen.getByLabelText('ราคา')).toHaveValue('45');
    expect((await db.product.get('DRINK_TAMARIND'))?.base_price).toBe(4_000);
  });

  it('adds at most one step of history, however many pages are opened and closed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: /^มะขามแดง/ });
    const before = window.history.length;

    for (let round = 0; round < 3; round += 1) {
      const hub = await openHub(user);
      await user.click(within(hub).getByRole('button', { name: 'กลับไปขาย' }));
      await waitFor(() => expect(hub).not.toBeInTheDocument());
    }

    expect(window.history.length).toBeLessThanOrEqual(before + 1);
  });
});
