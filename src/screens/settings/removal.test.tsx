/**
 * Removing a drink, a component and a packaging item, through the screen:
 * asked first, refused with a reason while still in use, and brought back
 * from ลบแล้ว.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen.tsx';
import { db } from '../../db/database.ts';
import { seedLegacyCatalog } from '../../db/legacy-catalog.ts';
import { ensureDeviceId } from '../../db/device.ts';
import { createPackagingItem } from '../../db/catalog-repo.ts';
import { BACK } from '../../test/helpers.ts';

let spareId = '';

beforeAll(async () => {
  await seedLegacyCatalog(db);
  await ensureDeviceId(db);
  // In no set, no topping and bought for nothing: free to go.
  spareId = (await createPackagingItem('ช้อนยาว', 50, db)).id;
});

afterEach(cleanup);

describe('removing from settings', () => {
  it('removes a drink after asking, and brings it back from ลบแล้ว switched off', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);

    const list = await screen.findByRole('region', { name: 'เครื่องดื่ม' });
    await user.click(within(list).getByRole('button', { name: /สาลี่ขาว/ }));
    await user.click(await screen.findByRole('button', { name: 'ลบสาลี่ขาว' }));

    // Asked first; "ไม่ลบ" changes nothing.
    await user.click(screen.getByRole('button', { name: 'ไม่ลบ' }));
    expect((await db.product.get('DRINK_PEAR'))?.removed_at).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'ลบสาลี่ขาว' }));
    const confirm = screen.getByRole('group', { name: 'ยืนยันลบสาลี่ขาว' });
    await user.click(within(confirm).getByRole('button', { name: 'ลบ' }));

    // Back on the list, without it.
    const after = await screen.findByRole('region', { name: 'เครื่องดื่ม' });
    // The list redraws from the database: wait for the removal to reach it.
    await user.click(await within(after).findByRole('button', { name: 'ลบแล้ว (1)' }));
    expect(within(after).queryByRole('button', { name: /^สาลี่ขาว/ })).toBeNull();
    expect((await db.product.get('DRINK_PEAR'))?.is_active).toBe(false);

    await user.click(screen.getByRole('button', { name: 'เอาสาลี่ขาวกลับมา' }));
    // Its row, not the restore button: that one reads เอาสาลี่ขาวกลับมา.
    expect(
      await within(await screen.findByRole('region', { name: 'เครื่องดื่ม' })).findByRole(
        'button',
        { name: /^สาลี่ขาว/ },
      ),
    ).toBeInTheDocument();
    expect(await db.product.get('DRINK_PEAR')).toMatchObject({
      removed_at: null,
      is_active: false,
    });
  });

  it('refuses to remove a component a recipe still uses, saying which', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);

    await user.click(await screen.findByRole('button', { name: 'ส่วนประกอบ' }));
    const list = await screen.findByRole('region', { name: 'ส่วนประกอบ' });
    await user.click(within(list).getByRole('button', { name: /หัวเชื้อมะขาม/ }));
    await user.click(await screen.findByRole('button', { name: 'ลบหัวเชื้อมะขาม' }));
    const confirm = screen.getByRole('group', { name: 'ยืนยันลบหัวเชื้อมะขาม' });
    await user.click(within(confirm).getByRole('button', { name: 'ลบ' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ยังลบไม่ได้');
    expect(alert).toHaveTextContent(/อยู่ในสูตรของ ขวดมะขาม 1L, มะขามแดง/);
    expect((await db.component.get('COMP_CONC_TAMARIND'))?.removed_at).toBeUndefined();
  });

  it('removes a packaging item nothing uses', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);

    await user.click(await screen.findByRole('button', { name: 'บรรจุภัณฑ์' }));
    const list = await screen.findByRole('region', { name: 'บรรจุภัณฑ์' });
    await user.click(within(list).getByRole('button', { name: /ช้อนยาว/ }));
    await user.click(await screen.findByRole('button', { name: 'ลบช้อนยาว' }));
    const confirm = screen.getByRole('group', { name: 'ยืนยันลบช้อนยาว' });
    await user.click(within(confirm).getByRole('button', { name: 'ลบ' }));

    const after = await screen.findByRole('region', { name: 'บรรจุภัณฑ์' });
    expect(await within(after).findByRole('button', { name: 'ลบแล้ว (1)' })).toBeInTheDocument();
    expect((await db.packaging_item.get(spareId))?.removed_at).toBeTruthy();
  });
});
