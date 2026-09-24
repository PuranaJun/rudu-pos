import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { ensureSeeded } from './seed.ts';
import { adjustBatch, loadStockSnapshot, recordBatch } from './stock-repo.ts';
import { lastOperator, loadOpenSession, openSession, sessionBusinessDate } from './session-repo.ts';
import { loadSettings } from './settings-repo.ts';
import { batchRemaining } from '../domain/stock.ts';
import type { ComponentBatch } from './types.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-open-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

const DAY = { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false };

describe('opening the session', () => {
  it('opens one session and hands the same one back on a second tap', async () => {
    const first = await openSession(DAY, db, '2026-09-23T00:30:00.000Z');
    const second = await openSession({ ...DAY, operatorId: 'someone else' }, db);

    expect(second.id).toBe(first.id);
    expect(await db.cash_session.count()).toBe(1);
    expect(await loadOpenSession(db)).toMatchObject({
      operator_id: 'เจ้าของ',
      opening_float: 150_000,
      closed_at: null,
    });
  });

  it('dates the day in Bangkok, not UTC', async () => {
    // 06:30 on the 23rd in Bangkok is still the 22nd in UTC.
    const session = await openSession(DAY, db, '2026-09-22T23:30:00.000Z');
    expect(sessionBusinessDate(session)).toBe('2026-09-23');
  });

  it('writes the rainy-day choice every morning, so yesterday’s rain does not carry over', async () => {
    await db.setting.put({ key: 'promo_rainy_day_enabled', value: true, synced_at: null });

    await openSession(DAY, db);

    expect((await loadSettings(db)).rainyDayEnabled).toBe(false);
  });

  it('remembers who opened last', async () => {
    expect(await lastOperator(db)).toBeNull();
    await openSession({ ...DAY, operatorId: 'น้อง' }, db);
    expect(await lastOperator(db)).toBe('น้อง');
  });
});

describe('adjusting a batch at open', () => {
  async function teaBatch(): Promise<ComponentBatch> {
    const batch: ComponentBatch = {
      id: 'TEA',
      component_id: 'COMP_TEA_RED',
      made_at: '2026-09-22T12:00:00.000Z',
      qty_made: 5000,
      state: 'READY',
      ready_at: '2026-09-22T12:00:00.000Z',
      expires_at: '2026-09-25T12:00:00.000Z',
      parent_batch_id: null,
      note: null,
      synced_at: null,
    };
    await recordBatch(batch, null, db, batch.made_at);
    return batch;
  }

  it('adds an ADJUSTMENT row and leaves the batch row alone', async () => {
    await teaBatch();

    await adjustBatch('TEA', 4200, db);

    const snapshot = await loadStockSnapshot(db);
    expect(batchRemaining('TEA', snapshot.movements)).toBe(4200);
    const ledger = [...snapshot.movements].sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(ledger.map((movement) => [movement.reason, movement.qty_delta])).toEqual([
      ['PRODUCTION', 5000],
      ['ADJUSTMENT', -800],
    ]);
    expect((await db.component_batch.get('TEA'))!.qty_made).toBe(5000);
  });

  it('writes nothing when the count already agrees', async () => {
    await teaBatch();
    expect(await adjustBatch('TEA', 5000, db)).toBeNull();
    expect(await db.stock_movement.count()).toBe(1);
  });
});
