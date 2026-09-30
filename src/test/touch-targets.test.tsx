/**
 * Touch targets on the sell and payment screens and the เมนู hub (CLAUDE.md
 * §1): wet hands, ice, one thumb, direct sun. jsdom has no layout, so this
 * holds the line on the classes that set the size — every button must carry
 * a height of at least 48px and something that keeps it at least as wide, the
 * buttons on the path of a standard sale must carry the 56px size, every
 * button's label must be 20px or larger, and no button's edge may be the
 * hairline colour that disappears in sunlight.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SellScreen from '../screens/SellScreen.tsx';
import MenuHubScreen from '../screens/MenuHubScreen.tsx';
import OpenDayScreen from '../screens/OpenDayScreen.tsx';
import ProductionScreen from '../screens/ProductionScreen.tsx';
import SettingsScreen from '../screens/SettingsScreen.tsx';
import ReportsScreen from '../screens/ReportsScreen.tsx';
import PromptPayPanel from '../components/PromptPayPanel.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import type { CashSession } from '../db/types.ts';
import { BACK } from './helpers.ts';

/** 48px or more tall. `min-h-[7.5rem]` is the drink button. */
const TALL = /(^|\s)(min-h-touch|min-h-touch-lg|size-touch|size-touch-lg|min-h-\[7\.5rem\])(\s|$)/;
/** At least as wide as tall, by one means or another. */
const WIDE =
  /(^|\s)(w-full|flex-1|min-w-touch|min-w-touch-lg|size-touch|size-touch-lg|col-span-\d)(\s|$)/;
/** The 56px size, for the buttons of a standard sale. */
const LARGE = /(^|\s)(min-h-touch-lg|size-touch-lg|min-h-\[7\.5rem\])(\s|$)/;
/** 20px and up: on the button, or on the element inside that carries its label. */
const BIG_TEXT = /(^|\s)text-(xl|[2-5]xl)(\s|$)/;
/** The hairline colour: 1.6:1 on white, too faint to be the edge of a button. */
const FAINT_EDGE = /(^|\s)border-line(\s|$)/;

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

const nameOf = (button: HTMLElement) =>
  button.getAttribute('aria-label') ?? button.textContent ?? '?';

function problems(root: HTMLElement = document.body) {
  const buttons = within(root).getAllByRole('button');
  const hasBigText = (button: HTMLElement) =>
    BIG_TEXT.test(button.className) ||
    [...button.querySelectorAll('*')].some((child) => BIG_TEXT.test(child.className));

  return {
    undersized: buttons
      .filter((button) => !TALL.test(button.className) || !WIDE.test(button.className))
      .map(nameOf),
    smallText: buttons.filter((button) => !hasBigText(button)).map(nameOf),
    faintEdge: buttons.filter((button) => FAINT_EDGE.test(button.className)).map(nameOf),
  };
}

const NONE = { undersized: [], smallText: [], faintEdge: [] };

describe('touch targets', () => {
  it('on the sell screen, with every cart control open', async () => {
    const user = userEvent.setup();
    render(<SellScreen session={SESSION} />);

    // Pear has the most controls: temperature, toppings, giving it away.
    await user.click(await screen.findByRole('button', { name: /สาลี่ขาว/ }));
    const confirm = screen.queryByRole('button', { name: 'ขายต่อ' });
    if (confirm) await user.click(confirm);
    await user.click(await screen.findByLabelText('เพิ่มท็อปปิ้ง'));
    await user.click(screen.getByRole('button', { name: 'ฟรี' }));

    expect(problems()).toEqual(NONE);

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
    expect(problems()).toEqual(NONE);
    expect(screen.getByRole('button', { name: 'ลูกค้าจ่ายแล้ว' }).className).toMatch(LARGE);
  });

  it('on the เมนู hub', async () => {
    render(<MenuHubScreen session={SESSION} back={BACK} />);
    const hub = await screen.findByRole('dialog', { name: 'เมนู' });
    await within(hub).findByRole('button', { name: 'ปิดร้าน' });

    expect(problems(hub)).toEqual(NONE);
    for (const name of ['บิลวันนี้', 'ผลิต', 'รายงาน', 'ตั้งค่า', 'ปิดร้าน', BACK.label]) {
      expect(within(hub).getByRole('button', { name }).className, name).toMatch(LARGE);
    }
  });

  it('on the open-day screen', async () => {
    render(<OpenDayScreen />);
    await screen.findByRole('button', { name: 'เปิดร้าน' });
    expect(problems()).toEqual(NONE);
  });

  it('on the production screen, list and form', async () => {
    const user = userEvent.setup();
    render(<ProductionScreen back={BACK} />);
    const list = await screen.findByRole('dialog', { name: 'ผลิต' });
    await within(list).findByRole('button', { name: /ชาแดง/ });
    expect(problems()).toEqual(NONE);

    await user.click(within(list).getAllByRole('button', { name: /ชาแดง/ })[0]!);
    await screen.findByRole('button', { name: 'บันทึก' });
    expect(problems()).toEqual(NONE);
  });

  it('on the reports screen', async () => {
    render(<ReportsScreen back={BACK} />);
    await screen.findByRole('dialog', { name: 'รายงาน' });
    expect(problems()).toEqual(NONE);
  });

  it('on every settings section, and an editor in each', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await screen.findByRole('region', { name: 'เครื่องดื่ม' });

    for (const tab of ['เครื่องดื่ม', 'ส่วนประกอบ', 'บรรจุภัณฑ์', 'ท็อปปิ้ง', 'ร้าน', 'ข้อมูล']) {
      await user.click(screen.getByRole('button', { name: tab }));
      await waitFor(() => expect(screen.queryByText('กำลังโหลด…')).not.toBeInTheDocument());
      expect(problems(), tab).toEqual(NONE);

      // The first row of a list opens an editor: that must pass too.
      const region = screen.queryByRole('region', { name: tab });
      const row = region ? within(region).queryAllByRole('button')[0] : undefined;
      if (row && tab !== 'ร้าน' && tab !== 'ข้อมูล') {
        await user.click(row);
        await screen.findByRole('button', { name: 'บันทึก' });
        expect(problems(), `${tab} editor`).toEqual(NONE);
        await user.click(screen.getByRole('button', { name: 'กลับไปรายการ' }));
      }
    }
  });
});
