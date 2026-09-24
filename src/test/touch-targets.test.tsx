/**
 * Touch targets on the sell and payment screens (CLAUDE.md §1): wet hands,
 * ice, one thumb. jsdom has no layout, so this holds the line on the classes
 * that set the size — every button must carry a height of at least 48px and
 * something that keeps it at least as wide, and the buttons on the path of a
 * standard sale must carry the 56px size.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellScreen from '../screens/SellScreen.tsx';
import PromptPayPanel from '../components/PromptPayPanel.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import type { CashSession } from '../db/types.ts';

/** 48px or more tall. `min-h-[7.5rem]` is the drink button. */
const TALL = /(^|\s)(min-h-touch|min-h-touch-lg|size-touch|size-touch-lg|min-h-\[7\.5rem\])(\s|$)/;
/** At least as wide as tall, by one means or another. */
const WIDE =
  /(^|\s)(w-full|flex-1|min-w-touch|min-w-touch-lg|size-touch|size-touch-lg|col-span-\d)(\s|$)/;
/** The 56px size, for the buttons of a standard sale. */
const LARGE = /(^|\s)(min-h-touch-lg|size-touch-lg|min-h-\[7\.5rem\])(\s|$)/;

const SESSION: CashSession = {
  id: 'SESSION_TOUCH',
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

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

function undersized(): string[] {
  return screen
    .getAllByRole('button')
    .filter((button) => !TALL.test(button.className) || !WIDE.test(button.className))
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '?');
}

describe('touch targets', () => {
  it('on the sell screen, with every cart control open', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    // Pear has the most controls: temperature, toppings, giving it away.
    await user.click(await screen.findByRole('button', { name: /สาลี่ขาว/ }));
    const confirm = screen.queryByRole('button', { name: 'ขายต่อ' });
    if (confirm) await user.click(confirm);
    await user.click(await screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    await user.click(screen.getByLabelText('ลดราคา'));

    expect(undersized()).toEqual([]);

    // The standard sale: drink, quantity, temperature, then pay.
    for (const name of [
      /สาลี่ขาว/,
      /มะขามแดง/,
      'เพิ่มจำนวน',
      'ลดจำนวน',
      'ร้อน',
      'เย็น',
      'พอดี',
      '฿100',
      'QR',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button.className, String(name)).toMatch(LARGE);
    }
  });

  it('on the PromptPay panel', () => {
    render(
      <PromptPayPanel
        due={4_000}
        qrImage={null}
        onConfirm={() => {}}
        onCancel={() => {}}
        busy={false}
      />,
    );
    expect(undersized()).toEqual([]);
    expect(screen.getByRole('button', { name: 'ลูกค้าจ่ายแล้ว' }).className).toMatch(LARGE);
  });
});
