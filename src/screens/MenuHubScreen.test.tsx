/**
 * The เมนู hub: the one labelled door to everything that is not selling.
 * Every destination is one tap from it, and every destination's back button
 * goes straight home and says so.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart } from '../db/cart-repo.ts';
import { openSession } from '../db/session-repo.ts';

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  await clearCart(db);
  await db.cash_session.clear();
});

async function openHub(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'เมนู' }));
  return screen.findByRole('dialog', { name: 'เมนู' });
}

describe('from the sell screen', () => {
  beforeEach(async () => {
    await openSession({ operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false }, db);
  });

  it("keeps today's numbers as information, not as a hidden button", async () => {
    render(<App />);
    const today = await screen.findByLabelText('ยอดวันนี้');
    expect(today.tagName).not.toBe('BUTTON');
    expect(within(today).queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    ['บิลวันนี้', 'บิลวันนี้'],
    ['ผลิต', 'ผลิต'],
    ['รายงาน', 'รายงาน'],
    ['ตั้งค่า', 'ตั้งค่า'],
    ['ปิดร้าน', 'ปิดร้าน'],
  ])('opens %s in one tap, and its back button goes straight to selling', async (tile, title) => {
    const user = userEvent.setup();
    render(<App />);

    const hub = await openHub(user);
    await user.click(within(hub).getByRole('button', { name: tile }));
    const opened = await screen.findByRole('dialog', { name: title });

    await user.click(within(opened).getByRole('button', { name: 'กลับไปขาย' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'พอดี' })).toBeInTheDocument();
  });

  it('says what each tile holds, without changing what the tile is called', async () => {
    const user = userEvent.setup();
    render(<App />);
    const hub = await openHub(user);

    expect(within(hub).getByRole('button', { name: 'บิลวันนี้' })).toHaveAccessibleDescription(
      'ดูบิล · ยกเลิกบิล',
    );
  });
});

describe('before the day is open', () => {
  it('offers only what makes sense without a day, and goes back to open day', async () => {
    const user = userEvent.setup();
    render(<App />);

    const hub = await openHub(user);
    for (const tile of ['ผลิต', 'รายงาน', 'ตั้งค่า']) {
      expect(within(hub).getByRole('button', { name: tile })).toBeInTheDocument();
    }
    expect(within(hub).queryByRole('button', { name: 'บิลวันนี้' })).not.toBeInTheDocument();
    expect(within(hub).queryByRole('button', { name: 'ปิดร้าน' })).not.toBeInTheDocument();

    await user.click(within(hub).getByRole('button', { name: 'กลับไปหน้าเปิดร้าน' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'เปิดร้าน' })).toBeInTheDocument();
  });
});

describe('the backup', () => {
  it('is one tap from the hub, and remembers that it happened', async () => {
    const shared: File[] = [];
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files }: { files: File[] }) => {
        shared.push(...files);
      },
    });
    await db.setting.delete('last_backup_at');

    try {
      const user = userEvent.setup();
      render(<App />);
      const hub = await openHub(user);

      expect(await within(hub).findByText('ยังไม่เคยสำรองข้อมูล')).toBeInTheDocument();
      await user.click(await within(hub).findByRole('button', { name: 'สำรองข้อมูล' }));

      await waitFor(() => expect(shared).toHaveLength(1));
      await waitFor(async () =>
        expect((await db.setting.get('last_backup_at'))?.value).toBeTruthy(),
      );
      expect(await within(hub).findByText(/^สำรองล่าสุด/)).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, 'canShare');
      Reflect.deleteProperty(navigator, 'share');
    }
  });
});
