/**
 * Settings, driven through the screen. The catalog is data: a third drink is
 * added here, with no code change, and sells correctly.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from './SettingsScreen.tsx';
import SellScreen from './SellScreen.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { recordProduction } from '../db/stock-repo.ts';
import { loadSettings } from '../db/settings-repo.ts';
import type { CashSession } from '../db/types.ts';

const SESSION: CashSession = {
  id: 'SESSION_SETTINGS',
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

type User = ReturnType<typeof userEvent.setup>;

async function typeInto(user: User, label: string, text: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, text);
}

describe('a third drink, through settings alone', () => {
  it('appears on the sell screen with the right available cups and cost — no code change', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen onClose={() => {}} />);

    // 1. A new component: a clear, caffeine-free flower tea.
    await user.click(await screen.findByRole('button', { name: 'ส่วนประกอบ' }));
    await user.click(screen.getByRole('button', { name: '+ เพิ่มส่วนประกอบ' }));
    await typeInto(user, 'ชื่อ', 'ชาดอกไม้สกัดเย็น');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await screen.findByRole('region', { name: 'ชาดอกไม้สกัดเย็น' });
    await typeInto(user, 'ต้นทุน', '0.012');
    await typeInto(user, 'ทำครั้งละ', '3000');
    await typeInto(user, 'อายุ', '48');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('บันทึกแล้ว')).toBeInTheDocument();

    // 2. A new menu item at ฿40, in the iced cup.
    await user.click(screen.getByRole('button', { name: 'เมนู' }));
    await user.click(screen.getByRole('button', { name: '+ เพิ่มเมนู' }));
    await typeInto(user, 'ชื่อสั้น (บนปุ่ม)', 'ดอกไม้');
    await typeInto(user, 'ชื่อเต็ม (ป้ายเมนู)', 'ชาดอกไม้ตามฤดู');
    await typeInto(user, 'ราคา', '40');
    await user.click(screen.getByRole('button', { name: 'แก้วเย็น + หลอด' }));
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    // 3. Its recipe: 150 ml of the new tea per cup.
    const product = await screen.findByRole('region', { name: 'ดอกไม้' });
    await user.click(within(product).getByRole('button', { name: /ค่าเริ่มต้น/ }));
    const variant = await screen.findByRole('region', { name: 'ดอกไม้' });
    const add = within(variant).getByRole('group', { name: 'เพิ่มส่วนประกอบ' });
    await user.click(within(add).getByRole('button', { name: 'ชาดอกไม้สกัดเย็น' }));
    await typeInto(user, 'ปริมาณต่อแก้ว', '150');
    await user.click(screen.getByRole('button', { name: 'เพิ่มในสูตร' }));

    // By hand: 150 ml × ฿0.012 = ฿1.80, plus the iced set
    // (cup 1.18 + lid 0.59 + wide straw 0.25 + ice 1.00 + sticker 0.30 + bag 0.20 = ฿3.52).
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'ต้นทุนต่อแก้ว' })).toHaveTextContent(
        'ขาย ฿40 · ต้นทุน ฿5.32',
      ),
    );
    cleanup();

    // A morning's batch of it, recorded the ordinary way.
    const flower = (await db.component.toArray()).find(
      (component) => component.name_th === 'ชาดอกไม้สกัดเย็น',
    )!;
    await recordProduction(flower, {
      qty: 3000,
      madeAt: new Date(Date.now() - 3_600_000).toISOString(),
    });

    // 4. On the sell screen: 3000 ml at 150 a cup, and what limits it named.
    render(<SellScreen session={SESSION} />);
    const button = await screen.findByRole('button', { name: 'ดอกไม้ ฿40' });
    await waitFor(() => expect(button).toHaveTextContent('เหลือ 20 แก้ว'));
    expect(button).toHaveTextContent('ชาดอกไม้สกัดเย็น');

    // 5. Rung, it is priced and costed from the rows just typed in.
    await user.click(button);
    await user.click(await screen.findByRole('button', { name: 'เงินสด' }));
    await user.click(await screen.findByRole('button', { name: 'พอดี' }));

    await waitFor(async () => {
      const line = (await db.sale_line.toArray()).find(
        (entry) => entry.variant_id !== 'VAR_TAMARIND_ICED' && entry.unit_price === 4_000,
      );
      expect(line).toMatchObject({ qty: 1, unit_price: 4_000, unit_cost: 532 });
    });
    // The tender pad replaced the menu; this is a fresh button.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'ดอกไม้ ฿40' })).toHaveTextContent('เหลือ 19 แก้ว'),
    );
  });
});

describe('editing what is there', () => {
  it('saves a new price, and says why it will not save a bad one', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /^มะขามแดง/ }));
    await typeInto(user, 'ราคา', '45');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(async () =>
      expect((await db.product.get('DRINK_TAMARIND'))?.base_price).toBe(4_500),
    );

    await typeInto(user, 'ชื่อสั้น (บนปุ่ม)', ' ');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ต้องมีชื่อสั้น');
    expect((await db.product.get('DRINK_TAMARIND'))?.name_short_th).toBe('มะขามแดง');

    await typeInto(user, 'ชื่อสั้น (บนปุ่ม)', 'มะขามแดง');
    await typeInto(user, 'ราคา', '40');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(async () =>
      expect((await db.product.get('DRINK_TAMARIND'))?.base_price).toBe(4_000),
    );
  });

  it('changes a recipe quantity per variant, leaving the other variants alone', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: /^สาลี่ขาว/ }));
    await user.click(await screen.findByRole('button', { name: /^สาลี่ขาว \(ร้อน\)/ }));
    const recipe = await screen.findByRole('list', { name: 'สูตรต่อแก้ว' });
    const tea = within(recipe).getByLabelText('ชาขาวสกัดเย็น 2x');
    await user.clear(tea);
    await user.type(tea, '110');
    await user.click(within(recipe).getByRole('button', { name: 'บันทึก' }));

    await waitFor(async () =>
      expect((await db.bom.get('BOM_VAR_PEAR_HOT_COMP_TEA_WHITE'))?.qty_per_cup).toBe(110),
    );
    expect((await db.bom.get('BOM_VAR_PEAR_ICED_COMP_TEA_WHITE'))?.qty_per_cup).toBe(100);
  });

  it('changes the shop: tender buttons, operators, fixed cost', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen onClose={() => {}} />);

    await user.click(await screen.findByRole('button', { name: 'ร้าน' }));
    await typeInto(user, 'ปุ่มรับเงิน', '40, 59, 100, 500');
    await typeInto(user, 'คนขาย', 'เจ้าของ\nน้อง');
    await typeInto(user, 'ค่าใช้จ่ายคงที่ต่อวัน', '400');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(async () => {
      const settings = await loadSettings(db);
      expect(settings.quickTender).toEqual([4_000, 5_900, 10_000, 50_000]);
      expect(settings.operators).toEqual(['เจ้าของ', 'น้อง']);
      expect(settings.fixedCostPerDay).toBe(40_000);
    });
  });
});

describe('the PromptPay QR', () => {
  it('is uploaded once and shown from then on, and can be taken away', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen onClose={() => {}} />);
    await user.click(await screen.findByRole('button', { name: 'ร้าน' }));

    const qr = new File([new Uint8Array([137, 80, 78, 71])], 'qr.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('รูป QR พร้อมเพย์'), qr);

    // No canvas here, so it is kept as it came rather than lost.
    await waitFor(async () =>
      expect((await loadSettings(db)).promptPayQrImage).toMatch(/^data:image\/png;base64,/),
    );
    expect(await screen.findByRole('img', { name: 'QR พร้อมเพย์' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ลบรูป' }));
    await waitFor(async () => expect((await loadSettings(db)).promptPayQrImage).toBeNull());
  });
});
