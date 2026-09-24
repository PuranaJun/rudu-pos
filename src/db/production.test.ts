import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import {
  blanchBatch,
  loadStockSnapshot,
  promoteReadyBatches,
  recordBatch,
  recordProduction,
} from './stock-repo.ts';
import { availableCups, batchRemaining } from '../domain/stock.ts';
import type { CostCatalog } from '../domain/cost.ts';
import type { BatchState, Component, ComponentBatch } from './types.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

const NOW = '2026-09-22T13:00:00.000Z'; // 20:00 in Bangkok

beforeEach(async () => {
  dbName = `rudu-production-repo-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

const component = (id: string): Component => catalog.components.get(id)!;

/** A batch already on hand, recorded the plain way. */
async function onHand(id: string, componentId: string, qty: number, state: BatchState = 'READY') {
  const batch: ComponentBatch = {
    id,
    component_id: componentId,
    made_at: '2026-09-22T00:00:00.000Z',
    qty_made: qty,
    state,
    ready_at: '2026-09-22T00:00:00.000Z',
    expires_at: '2026-09-25T00:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
  await recordBatch(batch, null, db, batch.made_at);
}

async function remaining(batchId: string): Promise<number> {
  return batchRemaining(batchId, (await loadStockSnapshot(db, NOW)).movements);
}

describe('recording white-tea jelly', () => {
  it('CHECK: takes exactly 500 ml from the white tea, and pear drops with it', async () => {
    await onHand('TEA_WHITE', 'COMP_TEA_WHITE', 4000);
    await onHand('CONC_PEAR', 'COMP_CONC_PEAR', 3000);
    await onHand('PEAR_FRESH', 'COMP_PEAR_FRESH', 2100);
    await onHand('PEACH_GUM', 'COMP_PEACH_GUM', 2000, 'BLANCHED');

    // Hot pear has no jelly in it, so the tea is what limits it: 4000 / 100.
    const before = availableCups(catalog, await loadStockSnapshot(db, NOW), 'VAR_PEAR_HOT');
    expect(before).toEqual({ cups: 40, limitingComponentId: 'COMP_TEA_WHITE' });

    const jelly = await recordProduction(
      component('COMP_JELLY_WHITE_GOJI'),
      { qty: 1000, madeAt: NOW, sourceBatchId: 'TEA_WHITE' },
      db,
    );

    expect(await remaining('TEA_WHITE')).toBe(3500);
    expect(jelly).toMatchObject({ state: 'SLAB', parent_batch_id: 'TEA_WHITE' });
    expect(await remaining(jelly.id)).toBe(1000);

    const teaRows = await db.stock_movement
      .where('component_batch_id')
      .equals('TEA_WHITE')
      .toArray();
    expect(teaRows.find((row) => row.qty_delta === -500)?.reason).toBe('PRODUCTION');

    // "Real white-tea yield after one jelly batch is 35 cups, not 40."
    const after = availableCups(catalog, await loadStockSnapshot(db, NOW), 'VAR_PEAR_HOT');
    expect(after).toEqual({ cups: 35, limitingComponentId: 'COMP_TEA_WHITE' });
  });

  it('records from a batch that is short, and the ledger shows it went below zero', async () => {
    await onHand('TEA_WHITE', 'COMP_TEA_WHITE', 300);

    await recordProduction(
      component('COMP_JELLY_WHITE_GOJI'),
      { qty: 1000, madeAt: NOW, sourceBatchId: 'TEA_WHITE' },
      db,
    );

    expect(await remaining('TEA_WHITE')).toBe(-200);
  });

  it('refuses a source batch that is not white tea, and writes nothing', async () => {
    await onHand('TEA_RED', 'COMP_TEA_RED', 5000);

    await expect(
      recordProduction(
        component('COMP_JELLY_WHITE_GOJI'),
        { qty: 1000, madeAt: NOW, sourceBatchId: 'TEA_RED' },
        db,
      ),
    ).rejects.toThrow(/not COMP_TEA_WHITE/);

    expect(await db.component_batch.count()).toBe(1);
    expect(await remaining('TEA_RED')).toBe(5000);
  });
});

describe('after the batch is recorded', () => {
  it('stores BLANCHED when peach gum comes out of the pot', async () => {
    const gum = await recordProduction(component('COMP_PEACH_GUM'), { qty: 350, madeAt: NOW }, db);
    await blanchBatch(gum.id, db, '2026-09-23T00:00:00.000Z');

    expect(await db.component_batch.get(gum.id)).toMatchObject({
      state: 'BLANCHED',
      ready_at: '2026-09-23T00:00:00.000Z',
      expires_at: '2026-09-26T00:00:00.000Z',
    });
  });

  it('brings a finished steep’s stored state into line, and only a finished one', async () => {
    const red = await recordProduction(component('COMP_TEA_RED'), { qty: 5000, madeAt: NOW }, db);
    const white = await recordProduction(
      component('COMP_TEA_WHITE'),
      { qty: 4000, madeAt: NOW },
      db,
    );

    // 11 h later: red (10 h) is done, white (13 h) is not.
    const later = '2026-09-23T00:00:00.000Z';
    expect(await promoteReadyBatches(db, later)).toBe(1);
    expect((await db.component_batch.get(red.id))?.state).toBe('READY');
    expect((await db.component_batch.get(white.id))?.state).toBe('STEEPING');
  });
});
