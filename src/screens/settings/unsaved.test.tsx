/**
 * Nothing typed into settings is lost without being asked, and a save says so
 * where it happened. Driven through the screen, the way the owner edits at
 * home in the evening.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen.tsx';
import { db } from '../../db/database.ts';
import { ensureSeeded } from '../../db/seed.ts';
import { ensureDeviceId } from '../../db/device.ts';
import { BACK } from '../../test/helpers.ts';

type User = ReturnType<typeof userEvent.setup>;

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

async function typeInto(user: User, label: string, text: string) {
  const field = screen.getByLabelText(label);
  await user.clear(field);
  await user.type(field, text);
}

/** Tamarind's editor, with a new price typed and not saved. */
async function tamarindPriceTyped(user: User, price: string) {
  render(<SettingsScreen back={BACK} />);
  await user.click(await screen.findByRole('button', { name: /^มะขามแดง/ }));
  await screen.findByRole('region', { name: 'มะขามแดง' });
  await typeInto(user, 'ราคา', price);
}

const tamarindPrice = async () => (await db.product.get('DRINK_TAMARIND'))?.base_price;
const sheet = () => screen.findByRole('alertdialog', { name: 'มีการแก้ที่ยังไม่บันทึก' });

describe('leaving with unsaved changes', () => {
  it('asks first, and แก้ต่อ stays with the changes still there', async () => {
    const user = userEvent.setup();
    await tamarindPriceTyped(user, '45');

    await user.click(screen.getByRole('button', { name: 'ส่วนประกอบ' }));
    await user.click(within(await sheet()).getByRole('button', { name: 'แก้ต่อ' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'มะขามแดง' })).toBeInTheDocument();
    expect(screen.getByLabelText('ราคา')).toHaveValue('45');
    expect(await tamarindPrice()).toBe(4_000);
  });

  it('throws the changes away only when told to', async () => {
    const user = userEvent.setup();
    await tamarindPriceTyped(user, '45');

    await user.click(screen.getByRole('button', { name: 'ส่วนประกอบ' }));
    await user.click(within(await sheet()).getByRole('button', { name: 'ทิ้งการแก้ไข' }));

    expect(await screen.findByRole('region', { name: 'ส่วนประกอบ' })).toBeInTheDocument();
    expect(await tamarindPrice()).toBe(4_000);
  });

  it('saves and then goes, when that is the answer', async () => {
    const user = userEvent.setup();
    await tamarindPriceTyped(user, '45');

    // Back, not a tab, this time: every way out asks the same question.
    await user.click(screen.getByRole('button', { name: 'กลับไปรายการ' }));
    await user.click(within(await sheet()).getByRole('button', { name: 'บันทึก' }));

    await waitFor(async () => expect(await tamarindPrice()).toBe(4_500));
    expect(await screen.findByRole('region', { name: 'เครื่องดื่ม' })).toBeInTheDocument();

    await db.product.update('DRINK_TAMARIND', { base_price: 4_000 });
  });

  it('does not ask when nothing has changed', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await user.click(await screen.findByRole('button', { name: /^มะขามแดง/ }));
    await screen.findByRole('region', { name: 'มะขามแดง' });

    await user.click(screen.getByRole('button', { name: 'ส่วนประกอบ' }));

    expect(await screen.findByRole('region', { name: 'ส่วนประกอบ' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('saving', () => {
  it('says it is saved beside the button, and stops saying so once something changes', async () => {
    const user = userEvent.setup();
    await tamarindPriceTyped(user, '45');
    expect(screen.getByText('ยังไม่ได้บันทึก')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    expect(await screen.findByText('บันทึกแล้ว')).toBeInTheDocument();

    await typeInto(user, 'ราคา', '40');
    expect(screen.queryByText('บันทึกแล้ว')).not.toBeInTheDocument();
    expect(screen.getByText('ยังไม่ได้บันทึก')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'บันทึก' }));
    await waitFor(async () => expect(await tamarindPrice()).toBe(4_000));
  });

  it('makes one new packaging set however many times บันทึก is pressed', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'บรรจุภัณฑ์' }));
    await user.click(screen.getByRole('button', { name: '+ เพิ่มชุด' }));
    await typeInto(user, 'ชื่อชุด', 'ชุดทดสอบ');

    const save = screen.getByRole('button', { name: 'บันทึก' });
    await user.click(save);
    expect(await screen.findByText('บันทึกแล้ว')).toBeInTheDocument();
    await user.click(save);
    await user.click(save);

    await waitFor(async () => {
      const sets = await db.packaging_set.filter((set) => set.name === 'ชุดทดสอบ').toArray();
      expect(sets).toHaveLength(1);
    });
  });
});
