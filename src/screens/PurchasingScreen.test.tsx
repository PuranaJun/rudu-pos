/**
 * สั่งของ, driven through the screen the way the owner drives it the evening
 * before: a supplier, a pack of cups, a count, an order, a delivery at a new
 * price — and the cups on the shelf to show for it.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PurchasingScreen from './PurchasingScreen.tsx';
import SellScreen from './SellScreen.tsx';
import ScreenHost from '../nav/ScreenHost.tsx';
import { db } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { ensureDeviceId } from '../db/device.ts';
import { countPackaging } from '../db/purchase-repo.ts';
import { packagingRemaining } from '../domain/packaging.ts';
import { useNav } from '../nav/nav-store.ts';
import { BACK } from '../test/helpers.ts';
import type { CashSession } from '../db/types.ts';

const CUP = 'PKGI_CUP_PLASTIC_16OZ';

beforeAll(async () => {
  await seedLegacyCatalog(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  await Promise.all([
    db.supplier.clear(),
    db.purchase_item.clear(),
    db.purchase_order.clear(),
    db.purchase_order_line.clear(),
    db.packaging_movement.clear(),
  ]);
  await db.packaging_item.update(CUP, { unit_cost: 118, reorder_at: null });
});

type User = ReturnType<typeof userEvent.setup>;

async function typeInto(user: User, label: string, text: string) {
  const field = await screen.findByLabelText(label);
  await user.clear(field);
  await user.type(field, text);
}

describe('สั่งของ', () => {
  it('cannot start an order until there is somewhere to buy from and something to buy', async () => {
    render(<PurchasingScreen back={BACK} />);
    expect(await screen.findByRole('button', { name: 'สั่งของใหม่' })).toBeDisabled();
    expect(screen.getByText(/เพิ่มร้านที่ซื้อและของที่ซื้อก่อน/)).toBeInTheDocument();
  });

  it('a pack of cups ordered, received at a new price, and on the shelf', async () => {
    const user = userEvent.setup();
    render(<PurchasingScreen back={BACK} />);

    // A supplier and what is bought from them.
    await user.click(await screen.findByRole('button', { name: 'ร้านที่ซื้อ · ของที่ซื้อ' }));
    await user.click(screen.getByRole('button', { name: '+ เพิ่มร้าน' }));
    await typeInto(user, 'ชื่อร้าน', 'ร้านป้าแดง');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await screen.findByText('บันทึกแล้ว');
    await user.click(screen.getByRole('button', { name: 'กลับไปรายการ' }));

    await user.click(await screen.findByRole('button', { name: '+ เพิ่มของที่ซื้อ' }));
    await typeInto(user, 'ชื่อ', 'แก้ว 16oz แพ็ค 50');
    await typeInto(user, 'หน่วยที่ซื้อ', 'แพ็ค');
    await user.click(
      within(screen.getByRole('group', { name: 'เป็นของใช้ที่นับสต็อก' })).getByRole('button', {
        name: 'แก้วพลาสติก 16 oz',
      }),
    );
    await typeInto(user, '1 หน่วยมีกี่ชิ้น', '50');
    await user.click(
      within(screen.getByRole('group', { name: 'ซื้อร้านไหนประจำ' })).getByRole('button', {
        name: 'ร้านป้าแดง',
      }),
    );
    await typeInto(user, 'ราคาล่าสุดต่อหน่วย', '59');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await screen.findByText('บันทึกแล้ว');
    await user.click(screen.getByRole('button', { name: 'กลับไปรายการ' }));
    await user.click(await screen.findByRole('button', { name: 'กลับไปสั่งของ' }));

    // Count what is on the shelf first.
    await user.click(await screen.findByRole('button', { name: 'นับ แก้วพลาสติก 16 oz' }));
    await typeInto(user, 'นับได้ แก้วพลาสติก 16 oz', '20');
    await user.click(screen.getByRole('button', { name: 'บันทึกที่นับ' }));
    expect(await screen.findByText('เหลือ 20')).toBeInTheDocument();

    // Order two packs.
    await user.click(screen.getByRole('button', { name: 'สั่งของใหม่' }));
    await typeInto(user, 'จำนวน แก้ว 16oz แพ็ค 50', '2');
    expect(await screen.findByText('฿118')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'สั่งไว้ รอของมา' }));

    // It arrives, at a new price.
    expect(await screen.findByText(/รอรับของ · สั่ง/)).toBeInTheDocument();
    await typeInto(user, 'ราคาจริงต่อแพ็ค แก้ว 16oz แพ็ค 50', '62.50');
    await user.click(screen.getByRole('button', { name: 'รับของแล้ว' }));

    const offer = await screen.findByRole('region', { name: 'ราคาต่อชิ้นเปลี่ยน' });
    expect(within(offer).getByText(/แก้วพลาสติก 16 oz ฿1\.18 → ฿1\.25/)).toBeInTheDocument();
    await user.click(within(offer).getByRole('button', { name: 'ใช้ราคาใหม่ แก้วพลาสติก 16 oz' }));
    await waitFor(async () => expect((await db.packaging_item.get(CUP))?.unit_cost).toBe(125));

    await user.click(screen.getByRole('button', { name: 'กลับไปสั่งของ' }));
    expect(await screen.findByText('เหลือ 120')).toBeInTheDocument();
    expect(packagingRemaining(CUP, await db.packaging_movement.toArray())).toBe(120);
    expect(
      within(screen.getByRole('region', { name: 'ยอดซื้อ' })).getByText('ร้านป้าแดง'),
    ).toBeInTheDocument();
  }, 20_000);
});

describe('the sell screen', () => {
  const SESSION: CashSession = {
    id: 'SESSION_PURCHASING',
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

  it('says when cups run low, and the tap goes to สั่งของ — never in the way of a sale', async () => {
    await db.packaging_item.update(CUP, { reorder_at: 50 });
    await countPackaging(CUP, 30, db);
    const user = userEvent.setup();
    render(
      <>
        <SellScreen session={SESSION} />
        <ScreenHost session={SESSION} />
      </>,
    );

    const banner = await screen.findByRole('button', { name: 'ของใช้ใกล้หมด' });
    expect(banner).toHaveTextContent('แก้วพลาสติก 16 oz เหลือ 30');
    // The drinks are still there to sell.
    expect(screen.getByRole('button', { name: /มะขามแดง/ })).toBeEnabled();

    await user.click(banner);
    expect(useNav.getState().route).toBe('PURCHASING');
  });
});
