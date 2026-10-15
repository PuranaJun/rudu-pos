/**
 * ลิ้นชัก, through the screen: the bag of ice paid from the till is three taps
 * and บันทึก, it moves what the drawer should hold, and a mistake is cancelled.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DrawerScreen from './DrawerScreen.tsx';
import { db } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { openSession } from '../db/session-repo.ts';
import { loadExpectedCash } from '../db/close-repo.ts';
import type { CashSession } from '../db/types.ts';
import { BACK } from '../test/helpers.ts';

let session: CashSession;

beforeAll(async () => {
  await seedLegacyCatalog(db);
  session = await openSession({ operatorId: 'น้อง', openingFloat: 150_000, rainyDay: false }, db);
});

afterEach(cleanup);

describe('ลิ้นชัก', () => {
  it('records the ice paid from the till, and cancels it again', async () => {
    const user = userEvent.setup();
    render(<DrawerScreen session={session} back={BACK} />);

    expect(await screen.findByText('ควรมีในลิ้นชัก ฿1,500')).toBeInTheDocument();

    // Opens on จ่ายออก · ซื้อน้ำแข็ง: an amount and บันทึก.
    await user.click(screen.getByRole('button', { name: '฿40' }));
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByRole('status')).toHaveTextContent('จ่ายออก ฿40 · ซื้อน้ำแข็ง');
    expect(await screen.findByText('ควรมีในลิ้นชัก ฿1,460')).toBeInTheDocument();
    expect(await loadExpectedCash(session, db)).toBe(146_000);

    const today = screen.getByRole('region', { name: 'วันนี้' });
    await user.click(within(today).getByRole('button', { name: 'ยกเลิก ซื้อน้ำแข็ง −฿40' }));
    const confirm = screen.getByRole('group', { name: 'ยืนยันยกเลิก' });
    await user.click(within(confirm).getByRole('button', { name: 'ยกเลิก' }));

    expect(await screen.findByText('ควรมีในลิ้นชัก ฿1,500')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'วันนี้' })).toBeNull();
  });

  it('says what is wrong without an amount', async () => {
    const user = userEvent.setup();
    render(<DrawerScreen session={session} back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ใส่จำนวนเงินมากกว่า 0');
  });
});
