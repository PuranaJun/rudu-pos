import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { seedLegacyCatalog } from './legacy-catalog.ts';
import { openSession } from './session-repo.ts';
import { closeDay, loadDaySummary, loadExpectedCash } from './close-repo.ts';
import { recordCashMovement, sessionMovements, voidCashMovement } from './drawer-repo.ts';
import { auditDatabase } from './audit-repo.ts';
import { CatalogError } from './catalog-repo.ts';
import { checkMovement, liveMovements, movementTotals } from '../domain/drawer.ts';
import { expectedCash } from '../domain/close-day.ts';
import type { CashMovement, CashSession } from './types.ts';

let db: RuduPosDB;
let dbName: string;
const OPEN = '2026-10-15T01:00:00.000Z'; // 08:00 Bangkok

beforeEach(async () => {
  dbName = `rudu-drawer-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await seedLegacyCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

function open(): Promise<CashSession> {
  return openSession({ operatorId: 'น้อง', openingFloat: 150_000, rainyDay: false }, db, OPEN);
}

describe('the drawer rules', () => {
  const session = { id: 'S1', opening_float: 150_000 } as CashSession;
  const row = (patch: Partial<CashMovement>): CashMovement => ({
    id: crypto.randomUUID(),
    cash_session_id: 'S1',
    created_at: OPEN,
    direction: 'OUT',
    amount: 4_000,
    reason: 'ICE',
    note: null,
    operator_id: 'น้อง',
    voided_at: null,
    synced_at: null,
    ...patch,
  });

  it('counts what stands in this session only', () => {
    const movements = [
      row({}),
      row({ direction: 'IN', reason: 'CHANGE', amount: 50_000 }),
      row({ voided_at: OPEN, amount: 99_900 }),
      row({ cash_session_id: 'S0', amount: 77_700 }),
    ];
    expect(movementTotals(session, movements)).toEqual({ paidIn: 50_000, paidOut: 4_000 });
    expect(liveMovements(session, movements)).toHaveLength(2);
  });

  it('wants a positive amount', () => {
    expect(checkMovement(null, '')).not.toEqual([]);
    expect(checkMovement(0, '')).not.toEqual([]);
    expect(checkMovement(4_000, 'ถุงใหญ่')).toEqual([]);
  });
});

describe('cash in and out of the drawer', () => {
  it('moves expected cash, and close day counts against it', async () => {
    const session = await open();
    await recordCashMovement(
      session,
      { direction: 'OUT', amount: 4_000, reason: 'ICE', note: '' },
      db,
    );
    await recordCashMovement(
      session,
      { direction: 'IN', amount: 20_000, reason: 'CHANGE', note: 'แบงค์ย่อย' },
      db,
    );
    expect(await loadExpectedCash(session, db)).toBe(150_000 - 4_000 + 20_000);

    const catalog = await loadCostCatalog(db);
    const closed = await closeDay(
      { sessionId: session.id, decisions: [], countedCash: 166_000, note: null },
      catalog,
      db,
    );
    expect(closed.expected_cash).toBe(166_000);
    expect(closed.variance).toBe(0);

    const summary = (await loadDaySummary(session.id, db))!;
    expect(summary.cash).toMatchObject({ paidIn: 20_000, paidOut: 4_000, variance: 0 });
    expect(summary.drawerMovements.map((m) => m.label)).toEqual(['ซื้อน้ำแข็ง', 'เติมเงินทอน']);

    // The audit agrees: expected recorded at close is what the rows say.
    const findings = (await auditDatabase(db)).filter((f) => f.check === 'CASH_DOES_NOT_RECONCILE');
    expect(findings).toEqual([]);
  });

  it('cancels a mistake instead of deleting it', async () => {
    const session = await open();
    const wrong = await recordCashMovement(
      session,
      { direction: 'OUT', amount: 40_000, reason: 'ICE', note: '' },
      db,
    );
    await voidCashMovement(wrong.id, db);

    const rows = await sessionMovements(session.id, db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.voided_at).not.toBeNull();
    expect(await loadExpectedCash(session, db)).toBe(150_000);
    expect(expectedCash(session, [], rows)).toBe(150_000);
  });

  it('refuses a bad amount, and anything once the day is closed', async () => {
    const session = await open();
    await expect(
      recordCashMovement(session, { direction: 'OUT', amount: null, reason: 'ICE', note: '' }, db),
    ).rejects.toBeInstanceOf(CatalogError);

    const kept = await recordCashMovement(
      session,
      { direction: 'OUT', amount: 4_000, reason: 'ICE', note: '' },
      db,
    );
    await closeDay(
      { sessionId: session.id, decisions: [], countedCash: 146_000, note: null },
      await loadCostCatalog(db),
      db,
    );
    await expect(
      recordCashMovement(session, { direction: 'OUT', amount: 4_000, reason: 'ICE', note: '' }, db),
    ).rejects.toThrow(/ปิดร้านไปแล้ว/);
    await expect(voidCashMovement(kept.id, db)).rejects.toThrow(/ปิดร้านไปแล้ว/);
  });

  it('is marked to go to the cloud', async () => {
    const session = await open();
    const movement = await recordCashMovement(
      session,
      { direction: 'OUT', amount: 4_000, reason: 'ICE', note: '' },
      db,
    );
    expect((await db.cash_movement.get(movement.id))?.sync_dirty).toBe(1);
  });
});
