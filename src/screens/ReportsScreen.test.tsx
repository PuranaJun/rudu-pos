/**
 * Reports, Tier 1: past days re-opened, and the year against the VAT line.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportsScreen from './ReportsScreen.tsx';
import OpenDayScreen from './OpenDayScreen.tsx';
import { db } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId } from '../db/device.ts';
import { loadCostCatalog } from '../db/catalog.ts';
import { loadSettings } from '../db/settings-repo.ts';
import { addDrink, clearCart, loadCart } from '../db/cart-repo.ts';
import { completeSale, priceCart } from '../db/sale-repo.ts';
import { openSession, sessionBusinessDate } from '../db/session-repo.ts';
import { closeDay } from '../db/close-repo.ts';

const HOUR = 3_600_000;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();

beforeAll(async () => {
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

beforeEach(async () => {
  await clearCart(db);
  for (const table of [db.cash_session, db.sale, db.sale_line, db.waste_event]) {
    await table.clear();
  }
  await db.setting.put({
    key: 'annual_revenue_warn_threshold',
    value: 180_000_000,
    synced_at: null,
  });
});

/** Open a day, sell some tamarind for cash, close it with the drawer right. */
async function tradedDay(openedHoursAgo: number, cups: number) {
  const catalog = await loadCostCatalog(db);
  const session = await openSession(
    { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false },
    db,
    hoursAgo(openedHoursAgo),
  );
  for (let n = 0; n < cups; n += 1) {
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    const cart = await loadCart(db);
    const priced = priceCart(catalog, await loadSettings(db), cart);
    await completeSale(
      catalog,
      cart,
      priced,
      {
        method: 'CASH',
        cashReceived: priced.totalNet,
        operatorId: 'เจ้าของ',
        deviceId: 'test',
        brandingLineTh: '',
        businessDate: sessionBusinessDate(session),
      },
      db,
      hoursAgo(openedHoursAgo - 1),
    );
  }
  await closeDay(
    { sessionId: session.id, decisions: [], countedCash: 150_000 + cups * 4_000, note: null },
    catalog,
    db,
    hoursAgo(openedHoursAgo - 2),
  );
  return session;
}

describe('past days', () => {
  it('lists every closed day, newest first, and re-opens its full summary', async () => {
    await tradedDay(50, 1);
    await tradedDay(26, 3);
    const user = userEvent.setup();
    render(<ReportsScreen onClose={() => {}} />);

    const list = await screen.findByRole('region', { name: 'วันที่ปิดแล้ว' });
    await waitFor(() => expect(within(list).getAllByRole('button')).toHaveLength(2));
    const [newest, older] = within(list).getAllByRole('button');
    expect(newest).toHaveTextContent('฿120');
    expect(newest).toHaveTextContent('3 แก้ว');
    expect(older).toHaveTextContent('฿40');

    await user.click(newest!);
    const summary = await screen.findByRole('dialog', { name: 'สรุปวัน' });
    expect(await within(summary).findByRole('status', { name: 'จุดคุ้มทุน' })).toHaveTextContent(
      '3/10 แก้ว',
    );
    await user.click(within(summary).getByRole('button', { name: 'กลับ' }));

    expect(screen.queryByRole('dialog', { name: 'สรุปวัน' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'รายงาน' })).toBeInTheDocument();
  });

  it('leaves out the day still open', async () => {
    await openSession({ operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false }, db);
    render(<ReportsScreen onClose={() => {}} />);

    expect(await screen.findByText('ยังไม่มีวันที่ปิดร้าน')).toBeInTheDocument();
  });
});

describe('the year against the VAT threshold', () => {
  // Traded a few hours ago rather than yesterday, so the sales stay in this
  // year even when the suite runs on the first of January.
  it('shows the running total, with no tax worked out anywhere', async () => {
    await tradedDay(3, 2);
    render(<ReportsScreen onClose={() => {}} />);

    const card = await screen.findByRole('status', { name: 'ยอดขายทั้งปี' });
    await waitFor(() => expect(card).toHaveTextContent('฿80'));
    expect(card).toHaveTextContent('เกณฑ์จดทะเบียน VAT ฿1,800,000');
    expect(card).not.toHaveTextContent('7%');
  });

  it('warns from three-quarters of the way, and says so once over', async () => {
    await tradedDay(3, 2); // ฿80
    await db.setting.put({ key: 'annual_revenue_warn_threshold', value: 10_000, synced_at: null });
    render(<ReportsScreen onClose={() => {}} />);

    // ฿80 of ฿100.
    const card = await screen.findByRole('status', { name: 'ยอดขายทั้งปี' });
    await waitFor(() => expect(card).toHaveTextContent('ใกล้เกณฑ์จดทะเบียน VAT'));
    expect(card).toHaveClass('bg-today');

    await db.setting.put({ key: 'annual_revenue_warn_threshold', value: 8_000, synced_at: null });
    await waitFor(() => expect(card).toHaveTextContent('ต้องจดทะเบียน'));
  });

  it('appears on the open-day screen only once it is worth a warning', async () => {
    await tradedDay(3, 2);
    const { unmount } = render(<OpenDayScreen />);
    await screen.findByRole('button', { name: 'เปิดร้าน' });
    expect(screen.queryByRole('status', { name: 'ยอดขายทั้งปี' })).not.toBeInTheDocument();
    unmount();

    await db.setting.put({ key: 'annual_revenue_warn_threshold', value: 10_000, synced_at: null });
    render(<OpenDayScreen />);
    expect(await screen.findByRole('status', { name: 'ยอดขายทั้งปี' })).toBeInTheDocument();
  });
});
