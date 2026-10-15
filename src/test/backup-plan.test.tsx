/**
 * Where the records are kept safe, for this shop's two phones (CLAUDE.md §13):
 * the staff's Samsung is backed up by the cloud and nobody there is nagged
 * about a file; a file saved on it is said to land in Downloads, where staff
 * can open it; and the owner's view-only iPhone saves the file instead.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.tsx';
import SettingsScreen from '../screens/SettingsScreen.tsx';
import { asRemoteWrites, db, SYNCED_TABLES } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { ensureDeviceId } from '../db/device.ts';
import { clearCart } from '../db/cart-repo.ts';
import { openSession } from '../db/session-repo.ts';
import { BACKUP_FORMAT, LAST_BACKUP_KEY, lastSafeCopy } from '../db/backup.ts';
import { clearOwnerPin, setOwnerPin } from '../db/owner-pin.ts';
import { SYNC_KEY, SYNC_LAST_FETCHED, SYNC_LAST_SENT, SYNC_MODE } from '../sync/sync-client.ts';
import { useNav } from '../nav/nav-store.ts';
import { BACK } from './helpers.ts';

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

type User = ReturnType<typeof userEvent.setup>;

let shared: File[] = [];

/** A share sheet that takes the file, as on the iPhone. */
function shareSheetTakesFiles() {
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: async ({ files }: { files: File[] }) => {
      shared.push(...files);
    },
  });
}

async function setting(key: string, value: string | null) {
  await db.setting.put({ key, value, synced_at: null });
}

/** Everything sent: the cloud holds it all. */
async function nothingWaiting() {
  await asRemoteWrites(() =>
    db.transaction('rw', SYNCED_TABLES, async () => {
      for (const name of SYNCED_TABLES) {
        await db.table(name).where('sync_dirty').equals(1).modify({ sync_dirty: undefined });
      }
    }),
  );
}

async function asShopPhone(lastSent: string) {
  await setting(SYNC_MODE, 'SHOP');
  await setting(SYNC_KEY, 'K7QM2XRPH9TDW4NC8FJV');
  await setting(SYNC_LAST_SENT, lastSent);
}

async function openHub(user: User) {
  await user.click(await screen.findByRole('button', { name: 'เมนู' }));
  return screen.findByRole('dialog', { name: 'เมนู' });
}

beforeAll(async () => {
  await seedLegacyCatalog(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  shared = [];
  await clearCart(db);
  await db.cash_session.clear();
  for (const key of [SYNC_MODE, SYNC_KEY, SYNC_LAST_SENT, SYNC_LAST_FETCHED, LAST_BACKUP_KEY]) {
    await db.setting.delete(key);
  }
  await clearOwnerPin(db);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

describe('the last safe copy', () => {
  const now = '2026-10-15T12:00:00.000Z';

  it('is the cloud, as of now, when nothing is waiting to go', () => {
    expect(lastSafeCopy(null, { lastSent: '2026-10-01T00:00:00.000Z', pending: 0 }, now)).toBe(now);
  });

  it('is the last send while changes are waiting', () => {
    const lastSent = '2026-10-12T00:00:00.000Z';
    expect(lastSafeCopy(null, { lastSent, pending: 3 }, now)).toBe(lastSent);
  });

  it('is whichever is newer, the file or the cloud', () => {
    const file = '2026-10-14T00:00:00.000Z';
    expect(lastSafeCopy(file, { lastSent: '2026-10-12T00:00:00.000Z', pending: 3 }, now)).toBe(
      file,
    );
    expect(lastSafeCopy(file, null, now)).toBe(file);
    expect(lastSafeCopy(null, null, now)).toBeNull();
  });
});

describe('the shop phone, syncing', () => {
  beforeEach(async () => {
    await openSession({ operatorId: 'น้อง', openingFloat: 150_000, rainyDay: false }, db);
  });

  it('is backed up by the cloud: no file, and nobody is nagged', async () => {
    await asShopPhone(daysAgo(5));
    await nothingWaiting();
    const user = userEvent.setup();
    render(<App />);

    const backup = within(within(await openHub(user)).getByRole('region', { name: 'สำรองข้อมูล' }));
    const status = await backup.findByText('ข้อมูลอยู่บนคลาวด์ครบแล้ว');
    expect(backup.getByText('ยังไม่เคยสำรองเป็นไฟล์')).toBeInTheDocument();
    expect(status.parentElement).not.toHaveClass('bg-today');
  });

  it('says so loudly when changes have been waiting for days', async () => {
    await asShopPhone(daysAgo(3));
    const user = userEvent.setup();
    render(<App />);

    const backup = within(within(await openHub(user)).getByRole('region', { name: 'สำรองข้อมูล' }));
    const status = await backup.findByText(/^รอส่งขึ้นคลาวด์ \d+ รายการ · ส่งล่าสุด/);
    expect(status.parentElement).toHaveClass('bg-today');
  });

  it('does not offer a file after closing the day: the cloud gets the day', async () => {
    await asShopPhone(daysAgo(0));
    const user = userEvent.setup();
    render(<App />);
    await user.click(within(await openHub(user)).getByRole('button', { name: 'ปิดร้าน' }));
    const close = await screen.findByRole('dialog', { name: 'ปิดร้าน' });
    await user.click(await within(close).findByRole('button', { name: 'ต่อไป: นับเงิน' }));
    await user.type(within(close).getByLabelText('เงินที่นับได้ (บาท)'), '1500');
    await user.click(within(close).getByRole('button', { name: 'ยืนยันปิดร้าน' }));

    const summary = await screen.findByRole('dialog', { name: 'สรุปวัน' });
    await within(summary).findByRole('status', { name: 'จุดคุ้มทุน' });
    expect(
      within(summary).queryByRole('button', { name: 'สำรองข้อมูลวันนี้' }),
    ).not.toBeInTheDocument();
  });
});

describe('a file saved on a phone that downloads it', () => {
  async function backupSection() {
    const user = userEvent.setup();
    render(<SettingsScreen back={BACK} />);
    await user.click(await screen.findByRole('button', { name: 'ข้อมูล' }));
    return within(await screen.findByRole('region', { name: 'สำรองข้อมูล' }));
  }

  it('warns the owner it lands in Downloads, where the staff can open it', async () => {
    // Chrome on Android: no share sheet for a .json file.
    await setOwnerPin('2580', db);
    useNav.getState().unlockOwner();
    const section = await backupSection();

    expect(await section.findByText(/โฟลเดอร์ดาวน์โหลด/)).toBeInTheDocument();
  });

  it('says nothing where the share sheet takes it', async () => {
    shareSheetTakesFiles();
    await setOwnerPin('2580', db);
    useNav.getState().unlockOwner();
    const section = await backupSection();

    await section.findByRole('button', { name: 'บันทึกไฟล์สำรอง' });
    expect(section.queryByText(/โฟลเดอร์ดาวน์โหลด/)).not.toBeInTheDocument();
  });

  it('says nothing without a PIN: there is nothing hidden to give away', async () => {
    const section = await backupSection();
    await section.findByRole('button', { name: 'บันทึกไฟล์สำรอง' });
    expect(section.queryByText(/โฟลเดอร์ดาวน์โหลด/)).not.toBeInTheDocument();
  });
});

describe("the owner's view-only phone", () => {
  it('saves the whole shop as a backup file, through the share sheet', async () => {
    shareSheetTakesFiles();
    await setting(SYNC_MODE, 'VIEWER');
    await setting(SYNC_KEY, 'K7QM2XRPH9TDW4NC8FJV');
    await setting(SYNC_LAST_FETCHED, daysAgo(0));
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'สำรอง' }));
    const page = within(await screen.findByRole('dialog', { name: 'สำรองข้อมูล' }));
    expect(await page.findByText(/^ข้อมูลถึง /)).toBeInTheDocument();

    await user.click(await page.findByRole('button', { name: 'บันทึกไฟล์สำรอง' }));
    await waitFor(() => expect(shared).toHaveLength(1));
    const backup = JSON.parse(await shared[0]!.text());
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.tables.component.length).toBeGreaterThan(0);
    await waitFor(async () => expect((await db.setting.get(LAST_BACKUP_KEY))?.value).toBeTruthy());

    await user.click(page.getByRole('button', { name: 'กลับไปดูยอด' }));
    expect(await screen.findByRole('button', { name: 'รายงาน' })).toBeInTheDocument();
  });
});
