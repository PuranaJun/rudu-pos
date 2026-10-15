/** A new set-price promotion starts with no price, never the ฿10-off default. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen.tsx';
import { db } from '../../db/database.ts';
import { seedLegacyCatalog } from '../../db/legacy-catalog.ts';
import { BACK } from '../../test/helpers.ts';

beforeAll(async () => {
  await seedLegacyCatalog(db);
});

afterEach(cleanup);

describe('ขายราคาเดียว', () => {
  it('starts empty, and will not save until a price is typed', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'โปรโมชั่น' }));
    await user.click(await screen.findByRole('button', { name: '+ เพิ่มโปรโมชั่น' }));
    await user.type(screen.getByLabelText('ชื่อโปรโมชั่น'), 'ทุกแก้ว');
    await user.click(screen.getByRole('button', { name: 'ขายราคาเดียว' }));

    expect(screen.getByLabelText('ขายแก้วละ')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ขายแก้วละกี่บาท ต้องมากกว่า 0');
    expect(await db.promotion.count()).toBe(0);
  });
});
