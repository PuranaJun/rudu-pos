/**
 * Backup, the tax CSV and restore, driven through the settings screen with
 * the iOS share sheet stood in for.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsScreen from '../SettingsScreen.tsx';
import { db } from '../../db/database.ts';
import { ensureSeeded } from '../../db/seed.ts';
import { ensureDeviceId } from '../../db/device.ts';
import { LAST_BACKUP_KEY, exportBackup } from '../../db/backup.ts';
import type { Sale } from '../../db/types.ts';

let shared: File[] = [];
let shareOutcome: 'ok' | 'cancel' = 'ok';

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  shared = [];
  shareOutcome = 'ok';
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  Object.defineProperty(navigator, 'share', {
    configurable: true,
    value: vi.fn(async ({ files }: { files: File[] }) => {
      if (shareOutcome === 'cancel') throw new DOMException('cancelled', 'AbortError');
      shared.push(...files);
    }),
  });
  await db.sale.clear();
  await db.sale_line.clear();
  await db.setting.delete(LAST_BACKUP_KEY);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
});

function sale(id: string, net: number, date = new Date().toISOString()): Sale {
  return {
    id,
    created_at: date,
    business_date: date.slice(0, 10),
    operator_id: 'เจ้าของ',
    total_gross: net,
    total_discount: 0,
    total_net: net,
    total_cost: 700,
    payment_method: 'CASH',
    cash_received: net,
    cash_change: 0,
    is_voided: false,
    void_reason: null,
    device_id: 'phone',
    synced_at: null,
  };
}

async function openData(user: ReturnType<typeof userEvent.setup>) {
  render(<SettingsScreen onClose={() => {}} />);
  await user.click(await screen.findByRole('button', { name: 'ข้อมูล' }));
}

describe('backing up', () => {
  it('hands the whole database to the share sheet in one tap, and remembers when', async () => {
    await db.sale.add(sale('S1', 4_000));
    const user = userEvent.setup();
    await openData(user);

    const section = screen.getByRole('region', { name: 'สำรองข้อมูล' });
    expect(within(section).getByText('ยังไม่เคยสำรองข้อมูล')).toBeInTheDocument();

    const button = await within(section).findByRole('button', { name: 'บันทึกไฟล์สำรอง' });
    await user.click(button);

    await waitFor(() => expect(shared).toHaveLength(1));
    expect(shared[0]!.name).toMatch(/^rudu-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = JSON.parse(await shared[0]!.text());
    expect(backup.tables.sale).toHaveLength(1);

    await waitFor(async () => expect((await db.setting.get(LAST_BACKUP_KEY))?.value).toBeTruthy());
    expect(await within(section).findByText(/สำรองล่าสุด/)).toBeInTheDocument();
  });

  it('does not count a share the operator backed out of', async () => {
    shareOutcome = 'cancel';
    const user = userEvent.setup();
    await openData(user);

    await user.click(await screen.findByRole('button', { name: 'บันทึกไฟล์สำรอง' }));

    await waitFor(() => expect(navigator.share).toHaveBeenCalled());
    expect(await db.setting.get(LAST_BACKUP_KEY)).toBeUndefined();
  });
});

describe('the tax CSV', () => {
  it('shows the half-year and full-year revenue, and shares the year as a CSV', async () => {
    const year = new Date().toISOString().slice(0, 4);
    await db.sale.bulkAdd([
      sale('JAN', 4_000, `${year}-01-15T03:00:00.000Z`),
      sale('AUG', 5_900, `${year}-08-15T03:00:00.000Z`),
      { ...sale('VOID', 9_900, `${year}-02-15T03:00:00.000Z`), is_voided: true },
    ]);
    const user = userEvent.setup();
    await openData(user);

    const section = await screen.findByRole('region', { name: 'ยอดขายสำหรับยื่นภาษี' });
    await waitFor(() => expect(section).toHaveTextContent('ม.ค.–มิ.ย. (ภ.ง.ด.94)฿40'));
    expect(section).toHaveTextContent('ทั้งปี (ภ.ง.ด.90)฿99');

    await user.click(await within(section).findByRole('button', { name: /ส่งออก CSV/ }));
    await waitFor(() => expect(shared).toHaveLength(1));
    expect(shared[0]!.name).toBe(`rudu-sales-${year}.csv`);
    expect((await shared[0]!.text()).split('\r\n').filter(Boolean)).toHaveLength(4);
  });
});

describe('restoring', () => {
  it('warns, says what the file holds, and only then replaces everything', async () => {
    await db.sale.add(sale('KEPT', 4_000));
    const backup = JSON.stringify(await exportBackup(db));
    // Since the backup: a sale that the restore will take away.
    await db.sale.add(sale('LATER', 5_900));

    const user = userEvent.setup();
    await openData(user);
    await user.upload(
      screen.getByLabelText('ไฟล์สำรองข้อมูล'),
      new File([backup], 'rudu-backup.json', { type: 'application/json' }),
    );

    const confirm = await screen.findByRole('alertdialog', { name: 'ยืนยันการกู้คืน' });
    expect(confirm).toHaveTextContent('ข้อมูลทั้งหมดในเครื่องนี้จะถูกแทนที่ด้วยไฟล์นี้');
    expect(confirm).toHaveTextContent('บิล1');
    // Nothing touched yet.
    expect(await db.sale.count()).toBe(2);

    await user.click(within(confirm).getByRole('button', { name: 'แทนที่ข้อมูลในเครื่อง' }));

    expect(await screen.findByText('กู้คืนข้อมูลแล้ว')).toBeInTheDocument();
    expect((await db.sale.toArray()).map((row) => row.id)).toEqual(['KEPT']);
  });

  it('can be backed out of, and refuses a file that is not a backup', async () => {
    const backup = JSON.stringify(await exportBackup(db));
    await db.sale.add(sale('STAYS', 4_000));
    const user = userEvent.setup();
    await openData(user);

    await user.upload(
      screen.getByLabelText('ไฟล์สำรองข้อมูล'),
      new File([backup], 'rudu-backup.json', { type: 'application/json' }),
    );
    const confirm = await screen.findByRole('alertdialog', { name: 'ยืนยันการกู้คืน' });
    await user.click(within(confirm).getByRole('button', { name: 'ยกเลิก' }));
    expect(await db.sale.count()).toBe(1);

    await user.upload(
      screen.getByLabelText('ไฟล์สำรองข้อมูล'),
      new File(['{"hello":"world"}'], 'photo.json', { type: 'application/json' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('ไม่ใช่ไฟล์สำรองข้อมูลของฤดูชา');
    expect(await db.sale.count()).toBe(1);
  });
});
