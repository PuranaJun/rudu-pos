/**
 * The production screen, driven the way it is used: the evening before, at
 * home, recording what went into the fridge.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductionScreen from './ProductionScreen.tsx';
import App from '../App.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { loadStockSnapshot, recordBatch } from '../db/stock-repo.ts';
import { batchRemaining } from '../domain/stock.ts';
import { toBangkokInput } from '../lib/datetime.ts';
import type { BatchState, ComponentBatch } from '../db/types.ts';

const HOUR = 3_600_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

async function onHand(
  id: string,
  componentId: string,
  qty: number,
  options: { state?: BatchState; expiresInHours?: number } = {},
) {
  const batch: ComponentBatch = {
    id,
    component_id: componentId,
    made_at: at(-12),
    qty_made: qty,
    state: options.state ?? 'READY',
    ready_at: at(-12),
    expires_at: at(options.expiresInHours ?? 48),
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
  await db.component_batch.clear();
  await db.stock_movement.clear();
  await db.cash_session.clear();
});

const noop = () => {};

describe('recording a batch', () => {
  it('prefills the catalog quantity, shows the recipe, and starts a steep', async () => {
    const user = userEvent.setup();
    render(<ProductionScreen onClose={noop} />);

    await user.click(await screen.findByRole('button', { name: 'ชาแดงสกัดเย็น 2x' }));

    expect(screen.getByLabelText('จำนวนที่ทำ')).toHaveValue('5000');
    // The recipe, as a reminder.
    expect(screen.getByText(/ชาแดง 50 g ในถุงกรอง/)).toBeInTheDocument();
    expect(screen.getByText(/กำลังแช่ · พร้อม/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    const list = await screen.findByRole('region', { name: 'ของที่ทำไว้' });
    await waitFor(() => expect(within(list).getByText('พร้อมใน 10 ชม.')).toBeInTheDocument());
    expect(within(list).getByText('กำลังแช่')).toBeInTheDocument();

    const [batch] = await db.component_batch.toArray();
    expect(batch).toMatchObject({
      component_id: 'COMP_TEA_RED',
      qty_made: 5000,
      state: 'STEEPING',
    });
  });

  it('takes an edited made-at time, in Bangkok time', async () => {
    const user = userEvent.setup();
    render(<ProductionScreen onClose={noop} />);

    await user.click(await screen.findByRole('button', { name: 'หัวเชื้อมะขาม' }));
    const madeAt = screen.getByLabelText('เวลาที่ทำ');
    await user.clear(madeAt);
    await user.type(madeAt, '2026-09-22T19:30');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(async () => expect(await db.component_batch.count()).toBe(1));
    // 19:30 in Bangkok is 12:30 UTC.
    expect((await db.component_batch.toArray())[0]!.made_at).toBe('2026-09-22T12:30:00.000Z');
    expect(toBangkokInput('2026-09-22T12:30:00.000Z')).toBe('2026-09-22T19:30');
  });
});

describe('white-tea jelly', () => {
  it('deducts 500 ml from the white-tea batch picked, oldest offered first', async () => {
    await onHand('TEA_NEW', 'COMP_TEA_WHITE', 4000, { expiresInHours: 60 });
    await onHand('TEA_OLD', 'COMP_TEA_WHITE', 2000, { expiresInHours: 20 });
    const user = userEvent.setup();
    render(<ProductionScreen onClose={noop} />);

    await user.click(await screen.findByRole('button', { name: 'เยลลี่ชาขาวฝังเก๋ากี้' }));
    expect(screen.getByText('ใช้ชาขาวสกัดเย็น 2x 500 ml จากถัง')).toBeInTheDocument();

    const [first, second] = screen
      .getAllByRole('button', { pressed: true, name: /เหลือ/ })
      .concat(screen.getAllByRole('button', { pressed: false, name: /เหลือ/ }));
    expect(first).toHaveTextContent('2,000 ml');
    expect(second).toHaveTextContent('4,000 ml');

    await user.click(second!);
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(async () => {
      const snapshot = await loadStockSnapshot(db);
      expect(batchRemaining('TEA_NEW', snapshot.movements)).toBe(3500);
    });
    const snapshot = await loadStockSnapshot(db);
    expect(batchRemaining('TEA_OLD', snapshot.movements)).toBe(2000);
    const jelly = snapshot.batches.find((batch) => batch.component_id === 'COMP_JELLY_WHITE_GOJI');
    expect(jelly).toMatchObject({ state: 'SLAB', parent_batch_id: 'TEA_NEW' });
  });

  it('warns when the batch holds less than 500 ml, and records anyway', async () => {
    await onHand('TEA_LOW', 'COMP_TEA_WHITE', 300);
    const user = userEvent.setup();
    render(<ProductionScreen onClose={noop} />);

    await user.click(await screen.findByRole('button', { name: 'เยลลี่ชาขาวฝังเก๋ากี้' }));

    expect(screen.getByRole('alert')).toHaveTextContent('ถังนี้เหลือ 300 ml — ไม่ถึง 500 ml');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(async () => {
      const snapshot = await loadStockSnapshot(db);
      expect(batchRemaining('TEA_LOW', snapshot.movements)).toBe(-200);
    });
  });

  it('cannot be recorded with no white tea to take it from', async () => {
    const user = userEvent.setup();
    render(<ProductionScreen onClose={noop} />);

    await user.click(await screen.findByRole('button', { name: 'เยลลี่ชาขาวฝังเก๋ากี้' }));

    expect(screen.getByRole('alert')).toHaveTextContent('ไม่มีชาขาวสกัดเย็น 2xพร้อมใช้');
    expect(screen.getByRole('button', { name: 'บันทึก' })).toBeDisabled();
  });
});

describe('the batch list', () => {
  it('counts down to expiry, loud on the last day', async () => {
    await onHand('TEA_RED', 'COMP_TEA_RED', 5000, { expiresInHours: 30.5 });
    await onHand('PEAR', 'COMP_PEAR_FRESH', 420, { expiresInHours: 5.5 });
    render(<ProductionScreen onClose={noop} />);

    const list = await screen.findByRole('region', { name: 'ของที่ทำไว้' });
    expect(await within(list).findByText('เหลือ 1 วัน')).toBeInTheDocument();
    expect(within(list).getByText('เหลือ 5 ชม.')).toHaveClass('bg-today');
  });

  it('blanches soaked peach gum with one tap', async () => {
    await onHand('GUM', 'COMP_PEACH_GUM', 350, { state: 'SOAKING' });
    const user = userEvent.setup();
    render(<ProductionScreen onClose={noop} />);

    await user.click(await screen.findByRole('button', { name: 'ลวกแล้ว ยางพีช' }));

    await waitFor(async () => {
      expect((await db.component_batch.get('GUM'))?.state).toBe('BLANCHED');
    });
  });
});

describe('prep reminders on the home screen', () => {
  it('asks for red tea when none will be ready tomorrow, and goes quiet once it is steeping', async () => {
    // White tea for tomorrow is already in the fridge; red tea is not.
    await onHand('TEA_WHITE', 'COMP_TEA_WHITE', 4000, { expiresInHours: 60 });
    const user = userEvent.setup();
    render(<App />);

    const banner = await screen.findByRole('button', { name: 'เตือนเตรียมของพรุ่งนี้' });
    expect(banner).toHaveTextContent('เริ่มแช่ชาแดงสกัดเย็น 2x ก่อน 21:00');
    expect(banner).not.toHaveTextContent('ชาขาว');

    // The banner goes straight to the form for it.
    await user.click(banner);
    const production = await screen.findByRole('dialog', { name: 'การผลิต' });
    await user.click(within(production).getByRole('button', { name: 'เตือนเตรียมของพรุ่งนี้' }));
    await user.click(within(production).getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'เตือนเตรียมของพรุ่งนี้' }),
      ).not.toBeInTheDocument();
    });
  });
});
