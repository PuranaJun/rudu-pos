/**
 * หมดวันนี้: a drink taken off for the day reads as sold out on the sell
 * screen and can still be sold through the override; the next day it is back.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SoldOutScreen from './SoldOutScreen.tsx';
import SellScreen from './SellScreen.tsx';
import { db } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { ensureDeviceId } from '../db/device.ts';
import { openSession, sessionBusinessDate } from '../db/session-repo.ts';
import { soldOutToday } from '../domain/sold-out.ts';
import type { CashSession } from '../db/types.ts';
import { BACK, openDrink } from '../test/helpers.ts';

let session: CashSession;

beforeAll(async () => {
  await seedLegacyCatalog(db);
  await ensureDeviceId(db);
  session = await openSession({ operatorId: 'น้อง', openingFloat: 150_000, rainyDay: false }, db);
});

afterEach(cleanup);

describe('soldOutToday', () => {
  it('holds for the day it was marked, and not the next', () => {
    expect(soldOutToday({ sold_out_on: '2026-10-15' }, '2026-10-15')).toBe(true);
    expect(soldOutToday({ sold_out_on: '2026-10-15' }, '2026-10-16')).toBe(false);
    expect(soldOutToday({}, '2026-10-15')).toBe(false);
  });
});

describe('หมดวันนี้', () => {
  it('takes a drink off for the day, and the sell screen still lets it be sold', async () => {
    const user = userEvent.setup();
    render(<SoldOutScreen session={session} back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'สาลี่ขาว หมดวันนี้' }));
    expect(await screen.findByText('ปิดอยู่ 1 เมนู')).toBeInTheDocument();
    expect((await db.product.get('DRINK_PEAR'))?.sold_out_on).toBe(sessionBusinessDate(session));
    cleanup();

    render(<SellScreen session={session} />);
    const pear = await screen.findByRole('button', { name: /^สาลี่ขาว .* — หมด$/ });
    expect(pear).toHaveTextContent('ปิดไว้วันนี้');
    // Its page opens like any drink's, says why, and sells it only as an override.
    const page = await openDrink(user, /^สาลี่ขาว/);
    expect(within(page).getByRole('alert')).toHaveTextContent('ปิดไว้ในหมดวันนี้');
    await user.click(within(page).getByRole('button', { name: /^ขายต่อ/ }));
    await waitFor(async () =>
      expect((await db.cart_line.toArray())[0]).toMatchObject({ sold_out_override: true }),
    );
    await db.cart_line.clear();
  });

  it('puts it back with one more tap', async () => {
    const user = userEvent.setup();
    render(<SoldOutScreen session={session} back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'สาลี่ขาว หมดวันนี้' }));
    expect(await screen.findByText('ขายได้ทุกเมนู')).toBeInTheDocument();
    expect((await db.product.get('DRINK_PEAR'))?.sold_out_on).toBeNull();
  });
});
