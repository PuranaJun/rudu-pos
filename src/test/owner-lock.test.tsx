/**
 * The owner lock: staff sell, the owner sees what things cost. With a PIN
 * set, selling is untouched, the owner's screens wait behind the pad, the
 * screens the staff do use show no cost or profit, and the PIN never leaves
 * the phone — not to the cloud, not into a backup file.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';
import SettingsScreen from '../screens/SettingsScreen.tsx';
import { db } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart } from '../db/cart-repo.ts';
import { recordBatch } from '../db/stock-repo.ts';
import { openSession } from '../db/session-repo.ts';
import { exportBackup, restoreBackup } from '../db/backup.ts';
import {
  OWNER_PIN_KEY,
  clearOwnerPin,
  isValidPin,
  loadOwnerPin,
  pinMatches,
  pinRecord,
  setOwnerPin,
} from '../db/owner-pin.ts';
import { LOCAL_SETTINGS } from '../sync/sync-client.ts';
import { useNav } from '../nav/nav-store.ts';
import { lockWhenAway } from '../nav/owner-lock.ts';
import { BACK, enabledButton } from './helpers.ts';
import type { BatchState, ComponentBatch } from '../db/types.ts';

const PIN = '2580';
const HOUR = 3_600_000;
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * HOUR).toISOString();

type User = ReturnType<typeof userEvent.setup>;

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
  await seedLegacyCatalog(db);
  await ensureDeviceId(db);
});

async function aDayWithAPin() {
  await clearCart(db);
  for (const table of [
    db.cash_session,
    db.component_batch,
    db.stock_movement,
    db.waste_event,
    db.sale,
    db.sale_line,
  ]) {
    await table.clear();
  }
  await onHand('TEA_RED', 'COMP_TEA_RED', 5000);
  await onHand('TAMARIND', 'COMP_CONC_TAMARIND', 3000);
  await onHand('PEAR', 'COMP_PEAR_FRESH', 420);
  await onHand('JELLY', 'COMP_JELLY_CHRYS', 600, 'CUT');
  await openSession({ operatorId: 'น้อง', openingFloat: 150_000, rainyDay: false }, db);
  await setOwnerPin(PIN, db);
}

async function openHub(user: User) {
  await user.click(await screen.findByRole('button', { name: 'เมนู' }));
  return screen.findByRole('dialog', { name: 'เมนู' });
}

async function typePin(user: User, pin: string) {
  const pad = within(await screen.findByRole('dialog', { name: 'รหัสเจ้าของ' }));
  for (const digit of pin) await user.click(pad.getByRole('button', { name: digit }));
}

describe('the PIN itself', () => {
  it('is kept as a salted hash, never as the digits', async () => {
    const record = await pinRecord(PIN, 'abc');
    expect(record).toMatch(/^abc:[0-9a-f]{64}$/);
    expect(await pinMatches(record, PIN)).toBe(true);
    expect(await pinMatches(record, '2581')).toBe(false);
    // A fresh salt each time: two phones with one PIN store different things.
    expect(await pinRecord(PIN)).not.toBe(await pinRecord(PIN));
  });

  it('is four to eight digits', () => {
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
});

describe('with a PIN set, on the shop phone', () => {
  beforeEach(aDayWithAPin);

  it('never asks while selling: plain tamarind, cash, is still two taps', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /^มะขามแดง/ }));
    await user.click(await enabledButton('พอดี'));

    await waitFor(async () => expect(await db.sale.count()).toBe(1));
    expect(screen.queryByRole('dialog', { name: 'รหัสเจ้าของ' })).not.toBeInTheDocument();
  });

  it('says on the tiles which ones need it', async () => {
    const user = userEvent.setup();
    render(<App />);
    const hub = within(await openHub(user));

    await waitFor(() =>
      expect(hub.getByRole('button', { name: 'ตั้งค่า' })).toHaveAccessibleDescription(
        'เครื่องดื่ม · ราคา · สูตร · ต้องใช้รหัส',
      ),
    );
    expect(hub.getByRole('button', { name: 'บิลวันนี้' })).toHaveAccessibleDescription(
      'ดูบิล · ยกเลิกบิล',
    );
  });

  it.each(['ตั้งค่า', 'รายงาน', 'สั่งของ'])(
    'keeps %s behind the pad, opens it for the right PIN, and locks again at home',
    async (tile) => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(within(await openHub(user)).getByRole('button', { name: tile }));
      expect(await screen.findByRole('dialog', { name: 'รหัสเจ้าของ' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: tile })).not.toBeInTheDocument();

      // A wrong one is said to be wrong, and cleared.
      await typePin(user, '1111');
      await user.click(screen.getByRole('button', { name: 'ตกลง' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('รหัสไม่ถูก');
      expect(screen.queryByRole('dialog', { name: tile })).not.toBeInTheDocument();

      // The right one opens the moment its last digit goes in.
      await typePin(user, PIN);
      await screen.findByRole('dialog', { name: tile });
      // Loaded first: a tap on the loading screen's back button is lost when
      // the loaded screen replaces it.
      await waitFor(() => expect(screen.queryByText('กำลังโหลด…')).not.toBeInTheDocument());

      const opened = screen.getByRole('dialog', { name: tile });
      await user.click(within(opened).getByRole('button', { name: 'กลับไปขาย' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      await user.click(within(await openHub(user)).getByRole('button', { name: tile }));
      expect(await screen.findByRole('dialog', { name: 'รหัสเจ้าของ' })).toBeInTheDocument();
    },
  );

  it("shows today's bills in cups, not profit", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(await openHub(user)).getByRole('button', { name: 'บิลวันนี้' }));
    const bills = await screen.findByRole('dialog', { name: 'บิลวันนี้' });

    expect(await within(bills).findByText('คุ้มทุน 0/10 แก้ว')).toBeInTheDocument();
    expect(within(bills).queryByText(/กำไรขั้นต้น/)).not.toBeInTheDocument();
  });

  it('closes the day without a baht of cost on screen, and the owner can see it after', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(await openHub(user)).getByRole('button', { name: 'ปิดร้าน' }));
    const close = await screen.findByRole('dialog', { name: 'ปิดร้าน' });

    // Same-day things still default to thrown out — just not priced.
    const pear = within(close).getByRole('group', { name: 'กอง B สาลี่สด เก็บหรือทิ้ง' });
    await waitFor(() =>
      expect(within(pear).getByRole('button', { name: 'ทิ้ง' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(within(close).getByText('ทิ้ง 2 อย่าง')).toBeInTheDocument();
    expect(within(close).queryByText(/ทิ้งรวม/)).not.toBeInTheDocument();

    await user.click(within(close).getByRole('button', { name: 'ต่อไป: นับเงิน' }));
    await user.type(within(close).getByLabelText('เงินที่นับได้ (บาท)'), '1500');
    await user.click(within(close).getByRole('button', { name: 'ยืนยันปิดร้าน' }));

    const summary = await screen.findByRole('dialog', { name: 'สรุปวัน' });
    const waste = await within(summary).findByRole('region', { name: 'ของเสีย' });
    expect(within(waste).getByText('420 g')).toBeInTheDocument();
    expect(within(summary).queryByText('ต้นทุน')).not.toBeInTheDocument();
    expect(within(summary).queryByText(/กำไรขั้นต้น/)).not.toBeInTheDocument();
    expect(within(summary).queryByText('฿29.40')).not.toBeInTheDocument();

    // The backup carries every cost: the owner's to send.
    const backup = await within(summary).findByRole('button', { name: 'สำรองข้อมูลวันนี้' });
    expect(backup).toHaveAccessibleDescription('ต้องใช้รหัสเจ้าของ');
    await user.click(backup);
    await typePin(user, PIN);

    expect((await within(summary).findAllByText(/กำไรขั้นต้น/)).length).toBeGreaterThan(0);
    expect(within(summary).getByText('฿29.40')).toBeInTheDocument();
    // The real share button now, once its file is built.
    expect(
      await within(summary).findByRole('button', { name: 'สำรองข้อมูลวันนี้' }),
    ).not.toHaveAccessibleDescription('ต้องใช้รหัสเจ้าของ');

    await user.click(within(summary).getByRole('button', { name: 'กลับไปหน้าเปิดร้าน' }));
    await screen.findByRole('button', { name: 'เปิดร้าน' });
    expect(useNav.getState().ownerUnlocked).toBe(false);
  });

  it('keeps the backup on the เมนู behind it too', async () => {
    const user = userEvent.setup();
    render(<App />);
    const hub = within(await openHub(user));

    expect(await hub.findByRole('button', { name: 'สำรองข้อมูล' })).toHaveAccessibleDescription(
      'ต้องใช้รหัสเจ้าของ',
    );
  });
});

describe('without a PIN', () => {
  beforeEach(async () => {
    await aDayWithAPin();
    await clearOwnerPin(db);
  });

  it('opens everything straight away, as before', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(await openHub(user)).getByRole('button', { name: 'ตั้งค่า' }));
    expect(await screen.findByRole('dialog', { name: 'ตั้งค่า' })).toBeInTheDocument();
  });
});

describe('setting it, in ตั้งค่า → ข้อมูล', () => {
  beforeEach(async () => {
    await clearOwnerPin(db);
  });

  it('asks for it twice, warns there is no reset, and keeps this visit open', async () => {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'ข้อมูล' }));
    const section = within(await screen.findByRole('region', { name: 'รหัสเจ้าของ' }));

    expect(section.getByText(/ลืมรหัสแล้วตั้งใหม่ไม่ได้/)).toBeInTheDocument();

    await user.type(section.getByLabelText('รหัสใหม่'), '135790');
    await user.type(section.getByLabelText('ใส่รหัสใหม่อีกครั้ง'), '135791');
    await user.click(section.getByRole('button', { name: 'ตั้งรหัส' }));
    expect(await section.findByRole('alert')).toHaveTextContent('ไม่ตรงกัน');
    expect(await loadOwnerPin(db)).toBeNull();

    await user.clear(section.getByLabelText('ใส่รหัสใหม่อีกครั้ง'));
    await user.type(section.getByLabelText('ใส่รหัสใหม่อีกครั้ง'), '135790');
    await user.click(section.getByRole('button', { name: 'ตั้งรหัส' }));

    expect(await section.findByRole('status')).toHaveTextContent('ตั้งรหัสแล้ว');
    const record = await loadOwnerPin(db);
    expect(record).not.toBeNull();
    expect(await pinMatches(record!, '135790')).toBe(true);
    expect(useNav.getState().ownerUnlocked).toBe(true);

    await user.click(section.getByRole('button', { name: 'เอารหัสออก' }));
    const confirm = within(await screen.findByRole('alertdialog', { name: 'ยืนยันเอารหัสออก' }));
    await user.click(confirm.getByRole('button', { name: 'เอารหัสออก' }));
    await waitFor(async () => expect(await loadOwnerPin(db)).toBeNull());
  });
});

describe('the PIN stays on the phone', () => {
  it('is never sent to the cloud', () => {
    expect(LOCAL_SETTINGS).toContain(OWNER_PIN_KEY);
  });

  it('is left out of a backup file, and a restore keeps the phone its own', async () => {
    await setOwnerPin(PIN, db);
    const mine = await loadOwnerPin(db);

    const backup = await exportBackup(db);
    const settings = backup.tables['setting'] as { key: string }[];
    expect(settings.some((row) => row.key === OWNER_PIN_KEY)).toBe(false);

    // A file that does carry one — from another phone — does not bring it.
    const other = { key: OWNER_PIN_KEY, value: await pinRecord('9999'), synced_at: null };
    await restoreBackup(
      { ...backup, tables: { ...backup.tables, setting: [...settings, other] } },
      db,
    );
    expect(await loadOwnerPin(db)).toBe(mine);
  });
});

describe('locking again when the phone has been away', () => {
  function fakeDocument() {
    const target = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    target.visibilityState = 'visible';
    const set = (state: DocumentVisibilityState) => {
      target.visibilityState = state;
      target.dispatchEvent(new Event('visibilitychange'));
    };
    return { doc: target as unknown as Document, set };
  }

  it('locks after more than a minute away, not after a glance at the share sheet', () => {
    let clock = 0;
    const { doc, set } = fakeDocument();
    lockWhenAway(doc, () => clock);
    useNav.getState().unlockOwner();

    set('hidden');
    clock += 20_000;
    set('visible');
    expect(useNav.getState().ownerUnlocked).toBe(true);

    set('hidden');
    clock += 61_000;
    set('visible');
    expect(useNav.getState().ownerUnlocked).toBe(false);
  });
});
