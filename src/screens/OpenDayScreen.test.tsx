/**
 * Open day, driven through the app the way the operator meets it: no session
 * open, so this is the first screen of the morning.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart } from '../db/cart-repo.ts';
import { loadOpenSession } from '../db/session-repo.ts';
import { loadStockSnapshot } from '../db/stock-repo.ts';
import { batchRemaining, productionMovement } from '../domain/stock.ts';
import type { BatchState, ComponentBatch } from '../db/types.ts';

const HOUR = 3_600_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

function batch(
  componentId: string,
  qty: number,
  state: BatchState = 'READY',
  expiresInHours = 48,
): ComponentBatch {
  return {
    id: `B_${componentId}`,
    component_id: componentId,
    made_at: at(-12),
    qty_made: qty,
    state,
    ready_at: at(-12),
    expires_at: at(expiresInHours),
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
}

/** A morning's stock, with the white-tea jelly still in the tray unless told otherwise. */
async function stock(goji: BatchState = 'SLAB') {
  const batches = [
    batch('COMP_TEA_RED', 5000),
    batch('COMP_TEA_WHITE', 3500),
    batch('COMP_CONC_TAMARIND', 3000),
    batch('COMP_CONC_PEAR', 3000),
    batch('COMP_JELLY_CHRYS', 1000, 'CUT', 20),
    batch('COMP_JELLY_WHITE_GOJI', 1000, goji),
    batch('COMP_PEAR_FRESH', 420),
    batch('COMP_PEACH_GUM', 350, 'BLANCHED'),
    batch('COMP_BASIL_SEED', 250),
  ];
  await db.component_batch.bulkPut(batches);
  await db.stock_movement.bulkPut(batches.map((entry) => productionMovement(entry, entry.made_at)));
}

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  await clearCart(db);
  await db.cash_session.clear();
  await db.component_batch.clear();
  await db.stock_movement.clear();
  await db.sale.clear();
  await db.setting.put({ key: 'operators', value: ['เจ้าของ'], synced_at: null });
  await db.setting.put({ key: 'promo_rainy_day_enabled', value: false, synced_at: null });
});

const openButton = () => screen.findByRole('button', { name: 'เปิดร้าน' });

describe('a day where nothing changed', () => {
  it('opens in one tap with the default operator, float and no rain', async () => {
    await stock('CUT');
    const user = userEvent.setup();
    render(<App />);

    await user.click(await openButton());

    // Straight onto the sell screen.
    expect(await screen.findByRole('button', { name: /มะขามแดง/ })).toBeInTheDocument();
    expect(await loadOpenSession(db)).toMatchObject({
      operator_id: 'เจ้าของ',
      opening_float: 150_000,
    });
    expect((await db.setting.get('promo_rainy_day_enabled'))?.value).toBe(false);
  });

  it('does not ask again after a reload — the day is open until it is closed', async () => {
    await stock('CUT');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await openButton());
    await screen.findByRole('button', { name: /มะขามแดง/ });

    cleanup();
    render(<App />);

    expect(await screen.findByRole('button', { name: /มะขามแดง/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เปิดร้าน' })).not.toBeInTheDocument();
  });
});

describe('jelly in the tray', () => {
  it('says which drink cannot be sold, and will not open until it is cut', async () => {
    await stock('SLAB');
    render(<App />);

    const jelly = await screen.findByRole('region', { name: 'ตัดเยลลี่วันนี้' });
    const warning = within(jelly).getByRole('alert');
    expect(warning).toHaveTextContent('สาลี่ขาว (เย็น) ขายไม่ได้');
    // Hot pear has no jelly in it.
    expect(warning).not.toHaveTextContent('ร้อน');

    expect(await openButton()).toBeDisabled();
    expect(screen.getByText(/ต้องตัดเยลลี่ชาขาวฝังเก๋ากี้ก่อนเปิดร้าน/)).toBeInTheDocument();
  });

  it('cuts the whole slab by default', async () => {
    await stock('SLAB');
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'ตัด 1,000 g' }));

    expect(
      await screen.findByText(/ตัดแล้ว 1,000 g — สาลี่ขาว \(เย็น\) ขายได้/),
    ).toBeInTheDocument();
    expect(await openButton()).toBeEnabled();

    const cut = (await db.component_batch.toArray()).find(
      (entry) => entry.state === 'CUT' && entry.parent_batch_id,
    );
    expect(cut).toMatchObject({ qty_made: 1000, parent_batch_id: 'B_COMP_JELLY_WHITE_GOJI' });
  });

  it('CHECK: pear is unsellable until the cut, then sellable with the right cups', async () => {
    await stock('SLAB');
    const user = userEvent.setup();
    render(<App />);

    const grams = await screen.findByLabelText('กรัมที่ตัด เยลลี่ชาขาวฝังเก๋ากี้');
    await user.clear(grams);
    await user.type(grams, '300');
    await user.click(screen.getByRole('button', { name: 'ตัด 300 g' }));

    // The uncut 700 g stays in the tray on its own, longer clock.
    await waitFor(async () => {
      const snapshot = await loadStockSnapshot(db);
      expect(batchRemaining('B_COMP_JELLY_WHITE_GOJI', snapshot.movements)).toBe(700);
    });
    const slab = await db.component_batch.get('B_COMP_JELLY_WHITE_GOJI');
    const cut = (await db.component_batch.toArray()).find((entry) => entry.parent_batch_id);
    expect(slab!.state).toBe('SLAB');
    expect(Date.parse(cut!.expires_at) - Date.parse(cut!.made_at)).toBe(24 * HOUR);
    expect(Date.parse(slab!.expires_at)).toBeGreaterThan(Date.parse(cut!.expires_at));

    await user.click(await openButton());

    // 300 g at 30 g a cup, and the button says what is limiting it.
    const pear = await screen.findByRole('button', { name: 'สาลี่ขาว ฿59' });
    expect(pear).toHaveTextContent('เหลือ 10 แก้ว');
    expect(pear).toHaveTextContent('เยลลี่ชาขาวฝังเก๋ากี้');
  });
});

describe('the batches', () => {
  it('shows expired and last-day stock loudly', async () => {
    await stock('CUT');
    await db.component_batch.update('B_COMP_PEAR_FRESH', { expires_at: at(-1) });
    await db.component_batch.update('B_COMP_BASIL_SEED', { expires_at: at(3) });
    render(<App />);

    const onHand = await screen.findByRole('region', { name: 'ของที่มี' });
    expect(within(onHand).getByText(/หมดอายุแล้ว/)).toBeInTheDocument();
    expect(within(onHand).getAllByText(/หมดอายุวันนี้/).length).toBeGreaterThan(0);
  });

  it('corrects a count with an ADJUSTMENT, never an overwrite', async () => {
    await stock('CUT');
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'แก้จำนวน ชาแดงสกัดเย็น 2x' }));
    const input = screen.getByLabelText('จำนวนที่เหลือ ชาแดงสกัดเย็น 2x');
    await user.clear(input);
    await user.type(input, '4200');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'แก้จำนวน ชาแดงสกัดเย็น 2x' })).toHaveTextContent(
        '4,200 ml',
      );
    });

    const movements = await db.stock_movement
      .where('component_batch_id')
      .equals('B_COMP_TEA_RED')
      .sortBy('created_at');
    expect(movements.map((movement) => [movement.reason, movement.qty_delta])).toEqual([
      ['PRODUCTION', 5000],
      ['ADJUSTMENT', -800],
    ]);
    expect((await db.component_batch.get('B_COMP_TEA_RED'))!.qty_made).toBe(5000);
  });

  it('names what is not there at all', async () => {
    await stock('CUT');
    await db.component_batch.delete('B_COMP_PEAR_FRESH');
    render(<App />);

    expect(await screen.findByText('ไม่มีของพร้อมขาย')).toBeInTheDocument();
    expect(screen.getByText(/กอง B สาลี่สด/)).toBeInTheDocument();
  });
});

describe('the choices', () => {
  it('records the operator and a changed float', async () => {
    await db.setting.put({ key: 'operators', value: ['เจ้าของ', 'น้อง'], synced_at: null });
    await stock('CUT');
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'น้อง' }));
    await user.click(screen.getByRole('button', { name: 'แก้เงินทอนเริ่มต้น' }));
    const float = screen.getByLabelText('เงินทอนเริ่มต้น (บาท)');
    await user.clear(float);
    await user.type(float, '2000');
    await user.click(screen.getByRole('button', { name: 'ตกลง' }));
    expect(screen.getByText('฿2,000')).toBeInTheDocument();

    await user.click(await openButton());

    await waitFor(async () => {
      expect(await loadOpenSession(db)).toMatchObject({
        operator_id: 'น้อง',
        opening_float: 200_000,
      });
    });
  });

  it('starts every morning with the rainy-day promo off, and turns it on when asked', async () => {
    // Yesterday was rainy.
    await db.setting.put({ key: 'promo_rainy_day_enabled', value: true, synced_at: null });
    await stock('CUT');
    const user = userEvent.setup();
    render(<App />);

    const rainy = await screen.findByRole('button', { name: /โปรวันฝนตก/ });
    expect(rainy).toHaveAttribute('aria-pressed', 'false');
    expect(rainy).toHaveTextContent('สาลี่ขาว (ร้อน) ฿59 → ฿54');

    await user.click(rainy);
    await user.click(await openButton());

    await waitFor(async () => {
      expect((await db.setting.get('promo_rainy_day_enabled'))?.value).toBe(true);
    });
  });
});

describe('the storage note', () => {
  it('is shown on open day until the operator says they have read it', async () => {
    await stock('CUT');
    await db.setting.put({ key: 'storage_persist_note', value: 'PENDING', synced_at: null });
    const user = userEvent.setup();
    render(<App />);

    const note = await screen.findByText(/ไม่รับประกันว่าจะเก็บข้อมูลไว้ถาวร/);
    expect(note).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'รับทราบ' }));

    await waitFor(() =>
      expect(screen.queryByText(/ไม่รับประกันว่าจะเก็บข้อมูลไว้ถาวร/)).not.toBeInTheDocument(),
    );
    expect((await db.setting.get('storage_persist_note'))?.value).toBe('SEEN');
  });
});
