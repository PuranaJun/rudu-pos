/**
 * ราคาทั้งหมด: every price and on/off switch on one screen, saved together —
 * or, if anything is wrong, not at all.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen.tsx';
import { db } from '../../db/database.ts';
import { seedLegacyCatalog } from '../../db/legacy-catalog.ts';
import { BACK } from '../../test/helpers.ts';

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  await seedLegacyCatalog(db);
});

afterEach(cleanup);

type User = ReturnType<typeof userEvent.setup>;

async function openPrices(user: User) {
  render(<SettingsScreen back={BACK} />);
  await user.click(await screen.findByRole('button', { name: 'ราคาทั้งหมด' }));
}

async function retype(user: User, label: string, text: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  if (text) await user.type(field, text);
}

describe('ราคาทั้งหมด', () => {
  it('changes prices and switches a drink off, in one save', async () => {
    const user = userEvent.setup();
    await openPrices(user);

    await retype(user, 'ราคามะขามแดง', '45');
    // The hot pear gets a price of its own; the iced one keeps the drink's.
    await retype(user, 'สาลี่ขาว (ร้อน)', '55');
    await user.click(screen.getByRole('button', { name: 'ขายขวดมะขาม 1L' }));
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('บันทึกแล้ว')).toBeInTheDocument();

    expect((await db.product.get('DRINK_TAMARIND'))?.base_price).toBe(4_500);
    expect((await db.variant.get('VAR_PEAR_HOT'))?.price_override).toBe(5_500);
    expect((await db.variant.get('VAR_PEAR_ICED'))?.price_override).toBeNull();
    expect((await db.product.get('BOTTLE_TAMARIND_1L'))?.is_active).toBe(false);
  });

  it('saves nothing while one price is wrong', async () => {
    const user = userEvent.setup();
    await openPrices(user);

    await retype(user, 'ราคามะขามแดง', '45');
    await retype(user, 'ราคาสาลี่ขาว', 'ห้าสิบ');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('สาลี่ขาว: ราคาต้องเป็นตัวเลข');
    expect((await db.product.get('DRINK_TAMARIND'))?.base_price).toBe(4_000);
  });
});
