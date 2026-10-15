/**
 * Blind count: with the owner's setting on and a PIN set, staff count the
 * drawer without seeing what it should hold; unlocked, the owner sees it all.
 * With no PIN there is nobody to hide it from.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloseDayScreen from './CloseDayScreen.tsx';
import DrawerScreen from './DrawerScreen.tsx';
import { db } from '../db/database.ts';
import { seedLegacyCatalog } from '../db/legacy-catalog.ts';
import { openSession } from '../db/session-repo.ts';
import { saveSetting } from '../db/catalog-repo.ts';
import { clearOwnerPin, setOwnerPin } from '../db/owner-pin.ts';
import { useNav } from '../nav/nav-store.ts';
import type { CashSession } from '../db/types.ts';
import { BACK } from '../test/helpers.ts';

let session: CashSession;

beforeAll(async () => {
  await seedLegacyCatalog(db);
  session = await openSession({ operatorId: 'น้อง', openingFloat: 150_000, rainyDay: false }, db);
});

beforeEach(async () => {
  useNav.getState().lockOwner();
  await saveSetting('drawer_blind_count', true, db);
  await setOwnerPin('2580', db);
});

afterEach(cleanup);

/** Close day is two steps: what is left, then the drawer. */
async function toCashStep() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'ต่อไป: นับเงิน' }));
}

describe('blind count', () => {
  it('hides what the drawer should hold from staff at close', async () => {
    render(<CloseDayScreen session={session} back={BACK} onClosed={() => {}} />);
    await toCashStep();
    expect(
      await screen.findByText('นับเงินทั้งหมดในลิ้นชักแล้วใส่ยอด — เจ้าของดูผลต่างเอง'),
    ).toBeInTheDocument();
    expect(screen.queryByText('ควรมี')).toBeNull();
    expect(screen.queryByText('ขายเงินสด')).toBeNull();
  });

  it('shows it to the owner once unlocked', async () => {
    render(<CloseDayScreen session={session} back={BACK} onClosed={() => {}} />);
    await toCashStep();
    act(() => useNav.getState().unlockOwner());
    expect(await screen.findByText('ควรมี')).toBeInTheDocument();
  });

  it('hides it on ลิ้นชัก too', async () => {
    render(<DrawerScreen session={session} back={BACK} />);
    expect(await screen.findByText(/เงินตั้งต้น/)).toBeInTheDocument();
    expect(screen.queryByText(/ควรมีในลิ้นชัก/)).toBeNull();
  });

  it('hides nothing without an owner PIN', async () => {
    await clearOwnerPin(db);
    render(<DrawerScreen session={session} back={BACK} />);
    expect(await screen.findByText('ควรมีในลิ้นชัก ฿1,500')).toBeInTheDocument();
  });
});
