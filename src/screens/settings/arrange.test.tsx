/**
 * The sell screen's order, set from settings with ▲ ▼ and saved in one go.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen.tsx';
import { db } from '../../db/database.ts';
import { seedLegacyCatalog } from '../../db/legacy-catalog.ts';
import { BACK } from '../../test/helpers.ts';

beforeAll(async () => {
  await seedLegacyCatalog(db);
});

afterEach(cleanup);

describe('ลำดับบนหน้าขาย', () => {
  it('moves a drink up and saves the new order', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);

    await user.click(await screen.findByRole('button', { name: 'จัดลำดับหน้าขาย' }));
    const list = await screen.findByRole('list', { name: 'ลำดับ' });
    const names = () =>
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.textContent);
    expect(names()[0]).toContain('มะขามแดง');
    expect(screen.getByRole('button', { name: 'เลื่อนมะขามแดงขึ้น' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'เลื่อนสาลี่ขาวขึ้น' }));
    expect(names()[0]).toContain('สาลี่ขาว');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('บันทึกแล้ว')).toBeInTheDocument();

    expect((await db.product.get('DRINK_PEAR'))?.sort_order).toBe(1);
    expect((await db.product.get('DRINK_TAMARIND'))?.sort_order).toBe(2);
  });

  it('says so when there is nothing sold to sort by', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'จัดลำดับหน้าขาย' }));
    await user.click(screen.getByRole('button', { name: 'เรียงตามขายดี 30 วัน' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ยังไม่มียอดขาย');
  });
});
