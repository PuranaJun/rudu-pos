/**
 * Close day, from the sell screen, the way the operator reaches it: the
 * day's totals → ปิดร้าน → leftovers → count the drawer → the day's summary.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart } from '../db/cart-repo.ts';
import { recordBatch } from '../db/stock-repo.ts';
import { loadOpenSession, openSession } from '../db/session-repo.ts';
import type { BatchState, ComponentBatch } from '../db/types.ts';

const HOUR = 3_600_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

async function onHand(id: string, componentId: string, qty: number, state: BatchState = 'READY') {
  const batch: ComponentBatch = {
    id,
    component_id: componentId,
    made_at: at(-6),
    qty_made: qty,
    state,
    ready_at: at(-6),
    expires_at: at(state === 'CUT' ? 18 : 48),
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
  await recordBatch(batch, null, db, batch.made_at);
}

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  await clearCart(db);
  for (const table of [
    db.cash_session,
    db.component_batch,
    db.stock_movement,
    db.waste_event,
    db.sale,
  ]) {
    await table.clear();
  }
  await onHand('TEA_RED', 'COMP_TEA_RED', 5000);
  await onHand('PEAR', 'COMP_PEAR_FRESH', 420);
  await onHand('JELLY', 'COMP_JELLY_CHRYS', 600, 'CUT');
  await openSession({ operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false }, db);
});

async function toCloseDay(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByLabelText('รายการขายวันนี้'));
  await user.click(await screen.findByRole('button', { name: 'ปิดร้าน' }));
  return screen.findByRole('dialog', { name: 'ปิดร้าน' });
}

function decisionFor(dialog: HTMLElement, name: string) {
  return within(within(dialog).getByRole('group', { name: `${name} เก็บหรือทิ้ง` }));
}

describe('the leftovers', () => {
  it('comes pre-decided: same-day things thrown out with their cost, the rest kept', async () => {
    const user = userEvent.setup();
    const dialog = await toCloseDay(user);

    // 420 g of fresh pear at ฿0.07 a gram.
    expect(
      decisionFor(dialog, 'กอง B สาลี่สด').getByRole('button', { name: 'ทิ้ง ฿29.40' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      decisionFor(dialog, 'เยลลี่เก๊กฮวย').getByRole('button', { name: /ทิ้ง/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      decisionFor(dialog, 'ชาแดงสกัดเย็น 2x').getByRole('button', { name: 'เก็บไว้' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // And the whole evening's waste, where the decision is being made.
    expect(within(dialog).getByText(/^ทิ้งรวม/)).toHaveTextContent('ทิ้งรวม ฿37.60');
  });

  it('prices an eyeballed count as it is typed', async () => {
    const user = userEvent.setup();
    const dialog = await toCloseDay(user);

    await user.click(within(dialog).getByRole('button', { name: 'แก้จำนวน กอง B สาลี่สด' }));
    const input = within(dialog).getByLabelText('เหลือจริง กอง B สาลี่สด');
    await user.clear(input);
    await user.type(input, '300');

    expect(
      decisionFor(dialog, 'กอง B สาลี่สด').getByRole('button', { name: 'ทิ้ง ฿21' }),
    ).toBeInTheDocument();
  });

  it('can throw out something that would have been kept, with a reason', async () => {
    const user = userEvent.setup();
    const dialog = await toCloseDay(user);

    await user.click(decisionFor(dialog, 'ชาแดงสกัดเย็น 2x').getByRole('button', { name: /ทิ้ง/ }));
    const tea = within(dialog)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('ชาแดง'))!;
    await user.click(within(tea).getByRole('button', { name: 'คุณภาพไม่ดี' }));

    await user.click(within(dialog).getByRole('button', { name: 'ต่อไป: นับเงิน' }));
    await user.type(within(dialog).getByLabelText('เงินที่นับได้ (บาท)'), '1500');
    await user.click(within(dialog).getByRole('button', { name: 'ปิดร้าน' }));

    await screen.findByRole('dialog', { name: 'สรุปวัน' });
    const waste = await db.waste_event.where('component_batch_id').equals('TEA_RED').toArray();
    expect(waste).toEqual([expect.objectContaining({ qty_discarded: 5000, reason: 'QUALITY' })]);
  });
});

describe('the drawer', () => {
  it('counts note by note, and says when it is right', async () => {
    const user = userEvent.setup();
    const dialog = await toCloseDay(user);
    await user.click(within(dialog).getByRole('button', { name: 'ต่อไป: นับเงิน' }));

    expect(within(dialog).getByText('ควรมี').nextSibling).toHaveTextContent('฿1,500');

    await user.click(within(dialog).getByRole('button', { name: 'นับทีละใบ' }));
    await user.type(within(dialog).getByLabelText('จำนวน ฿1,000'), '1');
    await user.type(within(dialog).getByLabelText('จำนวน ฿100'), '5');

    expect(within(dialog).getByRole('status', { name: 'ผลต่าง' })).toHaveTextContent('ตรง');
  });

  it('records a shortfall and closes anyway', async () => {
    const user = userEvent.setup();
    const dialog = await toCloseDay(user);
    await user.click(within(dialog).getByRole('button', { name: 'ต่อไป: นับเงิน' }));

    // Nothing counted, nothing to close on.
    expect(within(dialog).getByRole('button', { name: 'ปิดร้าน' })).toBeDisabled();

    await user.type(within(dialog).getByLabelText('เงินที่นับได้ (บาท)'), '1300');
    expect(within(dialog).getByRole('status', { name: 'ผลต่าง' })).toHaveTextContent('ขาด ฿200');
    await user.click(within(dialog).getByRole('button', { name: 'ปิดร้าน' }));

    const summary = await screen.findByRole('dialog', { name: 'สรุปวัน' });
    expect((await within(summary).findAllByText('ขาด ฿200')).length).toBeGreaterThan(0);
    expect(await loadOpenSession(db)).toBeNull();
  });
});

describe('after the close', () => {
  it('shows the day, then goes back round to open day', async () => {
    const user = userEvent.setup();
    const dialog = await toCloseDay(user);
    await user.click(within(dialog).getByRole('button', { name: 'ต่อไป: นับเงิน' }));
    await user.type(within(dialog).getByLabelText('เงินที่นับได้ (บาท)'), '1500');
    await user.click(within(dialog).getByRole('button', { name: 'ปิดร้าน' }));

    const summary = await screen.findByRole('dialog', { name: 'สรุปวัน' });
    // The important numbers, at the top.
    expect(await within(summary).findByRole('status', { name: 'จุดคุ้มทุน' })).toHaveTextContent(
      'ยังไม่ถึงจุดคุ้มทุน',
    );
    await waitFor(() =>
      expect(
        within(summary).getByText('ของเสีย', { selector: 'dt' }).nextSibling,
      ).toHaveTextContent('฿37.60'),
    );
    const waste = within(summary).getByRole('region', { name: 'ของเสีย' });
    expect(within(waste).getByText(/กอง B สาลี่สด 420 g/)).toBeInTheDocument();

    await user.click(within(summary).getByRole('button', { name: 'เสร็จ' }));
    expect(await screen.findByRole('button', { name: 'เปิดร้าน' })).toBeInTheDocument();
  });

  it('can be backed out of without writing anything', async () => {
    const user = userEvent.setup();
    const dialog = await toCloseDay(user);
    await user.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }));

    expect(screen.queryByRole('dialog', { name: 'ปิดร้าน' })).not.toBeInTheDocument();
    expect(await db.waste_event.count()).toBe(0);
    expect(await loadOpenSession(db)).not.toBeNull();
  });
});

describe('the backup, straight after the close', () => {
  it('is offered on the summary and takes one tap', async () => {
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
      const dialog = await toCloseDay(user);
      await user.click(within(dialog).getByRole('button', { name: 'ต่อไป: นับเงิน' }));
      await user.type(within(dialog).getByLabelText('เงินที่นับได้ (บาท)'), '1500');
      await user.click(within(dialog).getByRole('button', { name: 'ปิดร้าน' }));

      const summary = await screen.findByRole('dialog', { name: 'สรุปวัน' });
      await user.click(await within(summary).findByRole('button', { name: 'สำรองข้อมูลวันนี้' }));

      await waitFor(() => expect(shared).toHaveLength(1));
      // The backup holds the day just closed.
      const backup = JSON.parse(await shared[0]!.text());
      expect(backup.tables.cash_session[0].closed_at).not.toBeNull();
      await waitFor(async () =>
        expect((await db.setting.get('last_backup_at'))?.value).toBeTruthy(),
      );
      expect(
        await within(summary).findByRole('button', { name: 'สำรองข้อมูลวันนี้ แล้ว ✓' }),
      ).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(navigator, 'canShare');
      Reflect.deleteProperty(navigator, 'share');
    }
  });
});
