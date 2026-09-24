import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import { ensureDeviceId, DEVICE_ID_KEY } from './device.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart, toggleModifier } from './cart-repo.ts';
import { completeSale, priceCart } from './sale-repo.ts';
import { commitCut, recordProduction, voidSale } from './stock-repo.ts';
import { openSession, sessionBusinessDate } from './session-repo.ts';
import { closeDay } from './close-repo.ts';
import { saveSetting } from './catalog-repo.ts';
import {
  BackupError,
  backupFilename,
  describeBackup,
  exportBackup,
  parseBackup,
  restoreBackup,
} from './backup.ts';
import { closingLines } from '../domain/close-day.ts';
import { loadStockSnapshot } from './stock-repo.ts';
import type { CashSession } from './types.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-backup-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  await ensureDeviceId(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

const MORNING = '2026-09-22T00:00:00.000Z'; // 07:00 Bangkok

async function ring(session: CashSession, variantId: string, at: string, modifierId?: string) {
  const catalog = await loadCostCatalog(db);
  const lineId = await addDrink(variantId, {}, db);
  if (modifierId) await toggleModifier(lineId, modifierId, db);
  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart);
  const { saleId } = await completeSale(
    catalog,
    cart,
    priced,
    {
      method: 'CASH',
      cashReceived: priced.totalNet,
      operatorId: session.operator_id,
      deviceId: 'phone',
      brandingLineTh: '',
      businessDate: sessionBusinessDate(session),
    },
    db,
    at,
  );
  return saleId;
}

/** A realistic history: production, a cut, sales, a void, a close with waste. */
async function aWeekOfTrading() {
  const component = async (id: string) => (await db.component.get(id))!;
  const tea = await recordProduction(
    await component('COMP_TEA_WHITE'),
    { qty: 4000, madeAt: '2026-09-21T11:00:00.000Z' },
    db,
  );
  const goji = await recordProduction(
    await component('COMP_JELLY_WHITE_GOJI'),
    { qty: 1000, madeAt: '2026-09-21T13:00:00.000Z', sourceBatchId: tea.id },
    db,
  );
  for (const [id, qty] of [
    ['COMP_TEA_RED', 5000],
    ['COMP_CONC_TAMARIND', 3000],
    ['COMP_CONC_PEAR', 3000],
    ['COMP_JELLY_CHRYS', 1000],
    ['COMP_PEAR_FRESH', 420],
    ['COMP_BASIL_SEED', 250],
  ] as const) {
    await recordProduction(await component(id), { qty, madeAt: '2026-09-21T12:00:00.000Z' }, db);
  }
  const chrys = (await db.component_batch.toArray()).find(
    (b) => b.component_id === 'COMP_JELLY_CHRYS',
  )!;
  const catalog = await loadCostCatalog(db);
  await commitCut(catalog, chrys.id, 600, db, MORNING);
  await commitCut(catalog, goji.id, 1000, db, MORNING);

  const session = await openSession(
    { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: true },
    db,
    MORNING,
  );
  await ring(session, 'VAR_TAMARIND_ICED', '2026-09-22T01:00:00.000Z', 'MOD_BASIL_SEED');
  const mistake = await ring(session, 'VAR_PEAR_ICED', '2026-09-22T02:00:00.000Z');
  await ring(session, 'VAR_PEAR_ICED', '2026-09-22T03:00:00.000Z');
  await voidSale(mistake, 'กดผิด', db, '2026-09-22T02:05:00.000Z');

  const close = '2026-09-22T12:00:00.000Z';
  const decisions = closingLines(catalog, await loadStockSnapshot(db, close), close).map(
    (line) => ({
      batchId: line.batch.id,
      counted:
        Math.max(0, line.remaining) - (line.batch.component_id === 'COMP_PEAR_FRESH' ? 20 : 0),
      decision: line.decision,
      reason: line.reason,
    }),
  );
  await closeDay(
    { sessionId: session.id, decisions, countedCash: 157_000, note: 'ทอนเกิน' },
    catalog,
    db,
    close,
  );

  // The next morning, a cup half rung when the backup is taken.
  await openSession({ operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: false }, db);
  await addDrink('VAR_TAMARIND_ICED', {}, db);
  await saveSetting('operators', ['เจ้าของ', 'น้อง'], db);
}

/** Every table, every row, in key order. */
async function everything(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of db.tables) out[table.name] = await table.orderBy(':id').toArray();
  return out;
}

describe('export → wipe → import', () => {
  it('brings back every sale, batch, movement and waste event exactly', async () => {
    await aWeekOfTrading();
    const before = await everything();

    // Sanity: there is real history to lose.
    expect(before['sale']).toHaveLength(3);
    expect(before['waste_event']!.length).toBeGreaterThan(0);
    expect(before['stock_movement']!.length).toBeGreaterThan(20);

    // Through text, the way it travels through the share sheet and back.
    const text = JSON.stringify(await exportBackup(db, '2026-09-23T13:00:00.000Z'));

    db.close();
    await RuduPosDB.delete(dbName);
    db = new RuduPosDB(dbName);
    await db.open();
    for (const table of db.tables) expect(await table.count()).toBe(0);

    await restoreBackup(parseBackup(text, db), db);

    expect(await everything()).toStrictEqual(before);
  });

  it('keeps this phone’s own device id when restoring onto a new phone', async () => {
    await aWeekOfTrading();
    const text = JSON.stringify(await exportBackup(db));
    const oldPhone = (await db.setting.get(DEVICE_ID_KEY))!.value;

    // A new phone: fresh database, its own id.
    db.close();
    await RuduPosDB.delete(dbName);
    db = new RuduPosDB(dbName);
    await db.open();
    await ensureSeeded(db);
    const newPhone = await ensureDeviceId(db);

    await restoreBackup(parseBackup(text, db), db);

    expect(newPhone).not.toBe(oldPhone);
    expect((await db.setting.get(DEVICE_ID_KEY))!.value).toBe(newPhone);
    expect(await db.sale.count()).toBe(3);
  });

  it('replaces, rather than merges with, whatever was on the phone', async () => {
    const empty = JSON.stringify(await exportBackup(db));
    await aWeekOfTrading();

    await restoreBackup(parseBackup(empty, db), db);

    expect(await db.sale.count()).toBe(0);
    expect(await db.component_batch.count()).toBe(0);
    expect(await db.product.count()).toBeGreaterThan(0);
  });
});

describe('reading a backup file', () => {
  it('is named for the Bangkok date', () => {
    // 23:30 on the 25th in Bangkok is still the 25th, though UTC says the 25th 16:30.
    expect(backupFilename('2026-09-25T16:30:00.000Z')).toBe('rudu-backup-2026-09-25.json');
    // 01:00 on the 26th in Bangkok is the 25th in UTC.
    expect(backupFilename('2026-09-25T18:00:00.000Z')).toBe('rudu-backup-2026-09-26.json');
  });

  it('says what it holds before anything is replaced', async () => {
    await aWeekOfTrading();
    const summary = describeBackup(await exportBackup(db, '2026-09-23T13:00:00.000Z'));
    expect(summary).toMatchObject({ exportedAt: '2026-09-23T13:00:00.000Z', sales: 3, days: 2 });
  });

  it('refuses anything that is not a whole, current backup — in Thai, touching nothing', async () => {
    const good = await exportBackup(db);
    const refuse = (text: string) => expect(() => parseBackup(text, db)).toThrow(BackupError);

    refuse('not json');
    refuse(JSON.stringify({ hello: 'world' }));
    refuse(JSON.stringify({ ...good, schema_version: db.verno + 1 }));
    refuse(JSON.stringify({ ...good, tables: { ...good.tables, spreadsheet: [] } }));
    refuse(JSON.stringify({ ...good, tables: { ...good.tables, sale: [{ total_net: 4000 }] } }));
    expect(() => parseBackup(JSON.stringify({ ...good, schema_version: 99 }), db)).toThrow(
      'อัปเดตแอปก่อน',
    );
    expect(await db.product.count()).toBeGreaterThan(0);
  });
});
