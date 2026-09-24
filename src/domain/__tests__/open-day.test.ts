import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from '../../db/database.ts';
import { loadCostCatalog } from '../../db/catalog.ts';
import { ensureSeeded } from '../../db/seed.ts';
import type { CostCatalog } from '../cost.ts';
import type { BatchState, ComponentBatch, StockMovement } from '../../db/types.ts';
import {
  adjustmentMovement,
  jellyToCut,
  missingComponents,
  shelfStatus,
  stockOnHand,
  variantsUsing,
} from '../open-day.ts';
import { availableCups, cutSlab, productionMovement, type StockSnapshot } from '../stock.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

const NOW = '2026-09-23T02:00:00.000Z'; // 09:00 in Bangkok

beforeEach(async () => {
  dbName = `rudu-open-day-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

let seq = 0;

function made(
  componentId: string,
  qty: number,
  options: { state?: BatchState; expiresAt?: string; madeAt?: string } = {},
): { batch: ComponentBatch; movements: StockMovement[] } {
  seq += 1;
  const madeAt = options.madeAt ?? '2026-09-22T12:00:00.000Z';
  const batch: ComponentBatch = {
    id: `B${seq}_${componentId}`,
    component_id: componentId,
    made_at: madeAt,
    qty_made: qty,
    state: options.state ?? 'READY',
    ready_at: madeAt,
    expires_at: options.expiresAt ?? '2026-09-25T12:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
  return { batch, movements: [productionMovement(batch, madeAt)] };
}

function snapshot(...entries: { batch: ComponentBatch; movements: StockMovement[] }[]) {
  return {
    batches: entries.map((entry) => entry.batch),
    movements: entries.flatMap((entry) => entry.movements),
  } satisfies StockSnapshot;
}

function withCut(before: StockSnapshot, slab: ComponentBatch, grams: number): StockSnapshot {
  const plan = cutSlab(catalog, slab, grams, NOW);
  return {
    batches: [...before.batches, plan.batch],
    movements: [...before.movements, ...plan.movements],
  };
}

describe('shelf status', () => {
  const tea = () => catalog.components.get('COMP_TEA_RED')!;

  it('is OK with days to go', () => {
    const { batch } = made('COMP_TEA_RED', 5000, { expiresAt: '2026-09-25T12:00:00.000Z' });
    expect(shelfStatus(batch, tea(), NOW)).toBe('OK');
  });

  it('is TODAY for a batch that goes off tonight in Bangkok', () => {
    // 22:00 Bangkok on the 23rd — thirteen hours away, but today all the same.
    const { batch } = made('COMP_TEA_RED', 5000, { expiresAt: '2026-09-23T15:00:00.000Z' });
    expect(shelfStatus(batch, tea(), NOW)).toBe('TODAY');
  });

  it('is EXPIRED once past', () => {
    const { batch } = made('COMP_TEA_RED', 5000, { expiresAt: '2026-09-23T01:00:00.000Z' });
    expect(shelfStatus(batch, tea(), NOW)).toBe('EXPIRED');
  });
});

describe('stock on hand', () => {
  it('groups batches by component, combined, soonest expiry first', () => {
    const later = made('COMP_TEA_RED', 5000, { expiresAt: '2026-09-25T12:00:00.000Z' });
    const sooner = made('COMP_TEA_RED', 1200, { expiresAt: '2026-09-23T15:00:00.000Z' });
    const onHand = stockOnHand(catalog, snapshot(later, sooner), NOW);

    expect(onHand).toHaveLength(1);
    expect(onHand[0]!.total).toBe(6200);
    expect(onHand[0]!.batches.map((entry) => entry.batch.id)).toEqual([
      sooner.batch.id,
      later.batch.id,
    ]);
    expect(onHand[0]!.batches.map((entry) => entry.status)).toEqual(['TODAY', 'OK']);
  });

  it('leaves out slabs and empty batches, and keeps a batch stretched below zero', () => {
    const slab = made('COMP_JELLY_CHRYS', 1000, { state: 'SLAB' });
    const empty = made('COMP_CONC_PEAR', 0);
    const stretched = made('COMP_PEAR_FRESH', 21);
    stretched.movements.push({ ...stretched.movements[0]!, id: 'OVER', qty_delta: -42 });

    const ids = stockOnHand(catalog, snapshot(slab, empty, stretched), NOW).map(
      (entry) => entry.component.id,
    );
    expect(ids).toEqual(['COMP_PEAR_FRESH']);
  });
});

describe('jelly to cut', () => {
  it('holds up the day while a slab is uncut, and names the drink it blocks', () => {
    const slab = made('COMP_JELLY_WHITE_GOJI', 1000, { state: 'SLAB' });
    const [jelly] = jellyToCut(catalog, snapshot(slab), NOW);

    expect(jelly!.mustCut).toBe(true);
    // Iced pear only — hot pear has no jelly in it and is still sellable.
    expect(jelly!.blockedVariants.map((variant) => variant.id)).toEqual(['VAR_PEAR_ICED']);
  });

  it('is satisfied by a cut, with the rest of the slab still offered', () => {
    const slab = made('COMP_JELLY_WHITE_GOJI', 1000, { state: 'SLAB' });
    const [jelly] = jellyToCut(catalog, withCut(snapshot(slab), slab.batch, 600), NOW);

    expect(jelly!.mustCut).toBe(false);
    expect(jelly!.cutRemaining).toBe(600);
    expect(jelly!.slabs.map((entry) => entry.remaining)).toEqual([400]);
  });

  it('keeps showing a slab cut whole this morning, so the cut can be seen', () => {
    const slab = made('COMP_JELLY_WHITE_GOJI', 1000, { state: 'SLAB' });
    const [jelly] = jellyToCut(catalog, withCut(snapshot(slab), slab.batch, 1000), NOW);

    expect(jelly!.slabs).toEqual([]);
    expect(jelly!.cutRemaining).toBe(1000);
    expect(jelly!.mustCut).toBe(false);
  });

  it('forgets jelly cut on an earlier day', () => {
    const cut = made('COMP_JELLY_CHRYS', 600, { state: 'CUT' });
    cut.batch.parent_batch_id = 'OLD_SLAB';
    expect(jellyToCut(catalog, snapshot(cut), NOW)).toEqual([]);
  });

  it('asks for one cut per component, not one per slab', () => {
    const sunday = made('COMP_JELLY_CHRYS', 1000, {
      state: 'SLAB',
      expiresAt: '2026-09-24T12:00:00.000Z',
    });
    const monday = made('COMP_JELLY_CHRYS', 1000, { state: 'SLAB' });
    const cut = withCut(snapshot(sunday, monday), sunday.batch, 500);

    const [jelly] = jellyToCut(catalog, cut, NOW);
    expect(jelly!.mustCut).toBe(false);
    // Both still offered, the older one first.
    expect(jelly!.slabs.map((entry) => entry.batch.id)).toEqual([sunday.batch.id, monday.batch.id]);
  });

  it('does not count yesterday’s expired cubes as cut', () => {
    const slab = made('COMP_JELLY_CHRYS', 1000, { state: 'SLAB' });
    const stale = made('COMP_JELLY_CHRYS', 300, {
      state: 'CUT',
      madeAt: '2026-09-22T00:00:00.000Z',
      expiresAt: '2026-09-23T00:00:00.000Z',
    });

    expect(jellyToCut(catalog, snapshot(slab, stale), NOW)[0]!.mustCut).toBe(true);
  });

  it('does not hold up the day for an expired slab — that is waste', () => {
    const slab = made('COMP_JELLY_CHRYS', 1000, {
      state: 'SLAB',
      expiresAt: '2026-09-23T00:00:00.000Z',
    });
    const [jelly] = jellyToCut(catalog, snapshot(slab), NOW);

    expect(jelly!.mustCut).toBe(false);
    expect(jelly!.slabs[0]!.status).toBe('EXPIRED');
  });

  it('is the difference between a sellable pear and a sold-out one', () => {
    const stock = snapshot(
      made('COMP_TEA_WHITE', 4000),
      made('COMP_CONC_PEAR', 3000),
      made('COMP_PEAR_FRESH', 420),
      made('COMP_JELLY_WHITE_GOJI', 1000, { state: 'SLAB' }),
    );
    const slab = stock.batches.find((batch) => batch.state === 'SLAB')!;

    expect(availableCups(catalog, stock, 'VAR_PEAR_ICED').cups).toBe(0);
    // 300 g at 30 g a cup; the fresh pear would allow 20.
    expect(availableCups(catalog, withCut(stock, slab, 300), 'VAR_PEAR_ICED')).toEqual({
      cups: 10,
      limitingComponentId: 'COMP_JELLY_WHITE_GOJI',
    });
  });
});

describe('missing components', () => {
  it('lists what is not there, but not jelly that is only waiting to be cut', () => {
    const stock = snapshot(
      made('COMP_TEA_RED', 5000),
      made('COMP_JELLY_CHRYS', 1000, { state: 'SLAB' }),
    );
    const missing = missingComponents(catalog, stock).map((component) => component.id);

    expect(missing).not.toContain('COMP_TEA_RED');
    expect(missing).not.toContain('COMP_JELLY_CHRYS');
    expect(missing).toContain('COMP_PEAR_FRESH');
    // The garnish is not counted, so it can never be missing.
    expect(missing).not.toContain('COMP_CHRYS_GARNISH');
  });
});

describe('variants using a component', () => {
  it('reads the BOM, so a bottle with no jelly is not blocked by jelly', () => {
    expect(variantsUsing(catalog, 'COMP_JELLY_CHRYS').map((variant) => variant.id)).toEqual([
      'VAR_TAMARIND_ICED',
    ]);
    expect(variantsUsing(catalog, 'COMP_TEA_RED').map((variant) => variant.id)).toEqual([
      'VAR_TAMARIND_ICED',
      'VAR_BOTTLE_TAMARIND',
    ]);
  });
});

describe('adjusting a count', () => {
  it('writes the difference, never the total', () => {
    const movement = adjustmentMovement('B', 5000, 4200, NOW)!;
    expect(movement).toMatchObject({ component_batch_id: 'B', qty_delta: -800 });
    expect(movement.reason).toBe('ADJUSTMENT');
  });

  it('writes nothing when the count agrees', () => {
    expect(adjustmentMovement('B', 5000, 5000, NOW)).toBeNull();
  });

  it('refuses a negative count', () => {
    expect(() => adjustmentMovement('B', 5000, -1, NOW)).toThrow(/zero or more/);
  });
});
