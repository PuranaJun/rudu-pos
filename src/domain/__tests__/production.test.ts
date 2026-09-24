import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from '../../db/database.ts';
import { loadCostCatalog } from '../../db/catalog.ts';
import { ensureSeeded } from '../../db/seed.ts';
import type { CostCatalog } from '../cost.ts';
import type { BatchState, Component, ComponentBatch, StockMovement } from '../../db/types.ts';
import {
  batchList,
  blanched,
  planBatch,
  prepReminders,
  sourceOptions,
  sourceQtyFor,
} from '../production.ts';
import {
  availableCups,
  productionMovement,
  stateAt,
  stockAt,
  type StockSnapshot,
} from '../stock.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

beforeEach(async () => {
  dbName = `rudu-production-${crypto.randomUUID()}`;
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
const HOUR = 3_600_000;
const plus = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * HOUR).toISOString();

let seq = 0;
function made(
  componentId: string,
  qty: number,
  options: { state?: BatchState; madeAt?: string; readyAt?: string; expiresAt?: string } = {},
): { batch: ComponentBatch; movements: StockMovement[] } {
  seq += 1;
  const madeAt = options.madeAt ?? '2026-09-22T12:00:00.000Z';
  const batch: ComponentBatch = {
    id: `P${seq}_${componentId}`,
    component_id: componentId,
    made_at: madeAt,
    qty_made: qty,
    state: options.state ?? 'READY',
    ready_at: options.readyAt ?? madeAt,
    expires_at: options.expiresAt ?? '2026-09-26T12:00:00.000Z',
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

// 20:00 on the 22nd in Bangkok: the evening before a market day.
const EVENING = '2026-09-22T13:00:00.000Z';

describe('a new batch takes its clocks from its lifecycle', () => {
  it('STEEP starts STEEPING and is ready after the lead time, good for 72 h from then', () => {
    const batch = planBatch(component('COMP_TEA_RED'), { qty: 5000, madeAt: EVENING });

    expect(batch.state).toBe('STEEPING');
    expect(batch.ready_at).toBe(plus(EVENING, 10)); // 06:00 Bangkok
    expect(batch.expires_at).toBe(plus(EVENING, 10 + 72));
  });

  it('SOAK_BLANCH starts SOAKING', () => {
    const batch = planBatch(component('COMP_PEACH_GUM'), { qty: 350, madeAt: EVENING });
    expect(batch.state).toBe('SOAKING');
    expect(batch.ready_at).toBe(plus(EVENING, 11));
  });

  it('SLAB_CUT starts as an uncut SLAB', () => {
    expect(planBatch(component('COMP_JELLY_CHRYS'), { qty: 1000, madeAt: EVENING }).state).toBe(
      'SLAB',
    );
  });

  it('SIMPLE is READY straight away', () => {
    const batch = planBatch(component('COMP_CONC_TAMARIND'), { qty: 3000, madeAt: EVENING });
    expect(batch.state).toBe('READY');
    expect(batch.ready_at).toBe(EVENING);
    expect(batch.expires_at).toBe(plus(EVENING, 168));
  });

  it('refuses nothing to record and anything that is not batch tracked', () => {
    expect(() => planBatch(component('COMP_TEA_RED'), { qty: 0, madeAt: EVENING })).toThrow();
    expect(() => planBatch(component('COMP_CHRYS_GARNISH'), { qty: 10, madeAt: EVENING })).toThrow(
      /not batch tracked/,
    );
  });
});

describe('steeping becomes ready on its own', () => {
  it('reads READY once the lead time has run, with nothing tapped', () => {
    const tea = planBatch(component('COMP_TEA_RED'), { qty: 5000, madeAt: EVENING });

    expect(stateAt(tea, plus(EVENING, 9))).toBe('STEEPING');
    expect(stateAt(tea, plus(EVENING, 10))).toBe('READY');
  });

  it('keeps the drink sold out until then, and sellable after', () => {
    const tea = planBatch(component('COMP_TEA_RED'), { qty: 5000, madeAt: EVENING });
    const stock = snapshot(
      { batch: tea, movements: [productionMovement(tea, EVENING)] },
      made('COMP_CONC_TAMARIND', 3000),
      made('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
    );

    expect(availableCups(catalog, stockAt(stock, plus(EVENING, 9)), 'VAR_TAMARIND_ICED').cups).toBe(
      0,
    );
    expect(
      availableCups(catalog, stockAt(stock, plus(EVENING, 10)), 'VAR_TAMARIND_ICED').cups,
    ).toBe(33);
  });
});

describe('white-tea jelly is made out of white tea', () => {
  it('takes 500 ml for a full slab, and scales with a half one', () => {
    expect(sourceQtyFor(component('COMP_JELLY_WHITE_GOJI'), 1000)).toBe(500);
    expect(sourceQtyFor(component('COMP_JELLY_WHITE_GOJI'), 500)).toBe(250);
    expect(sourceQtyFor(component('COMP_JELLY_CHRYS'), 1000)).toBeNull();
  });

  it('cannot be planned without a source batch', () => {
    expect(() =>
      planBatch(component('COMP_JELLY_WHITE_GOJI'), { qty: 1000, madeAt: EVENING }),
    ).toThrow(/pick the batch/);

    const jelly = planBatch(component('COMP_JELLY_WHITE_GOJI'), {
      qty: 1000,
      madeAt: EVENING,
      sourceBatchId: 'TEA',
    });
    expect(jelly.parent_batch_id).toBe('TEA');
  });

  it('offers ready white tea, oldest first, and flags a batch that is short', () => {
    const older = made('COMP_TEA_WHITE', 300, { expiresAt: '2026-09-24T00:00:00.000Z' });
    const newer = made('COMP_TEA_WHITE', 4000, { expiresAt: '2026-09-25T12:00:00.000Z' });
    const steeping = made('COMP_TEA_WHITE', 4000, {
      state: 'STEEPING',
      readyAt: plus(EVENING, 5),
    });
    const expired = made('COMP_TEA_WHITE', 4000, { expiresAt: '2026-09-22T00:00:00.000Z' });

    const options = sourceOptions(
      catalog,
      snapshot(newer, steeping, older, expired),
      component('COMP_JELLY_WHITE_GOJI'),
      1000,
      EVENING,
    );

    expect(options.map((option) => option.batch.id)).toEqual([older.batch.id, newer.batch.id]);
    expect(options.map((option) => option.enough)).toEqual([false, true]);
  });
});

describe('blanching', () => {
  it('makes soaked peach gum sellable, on a clock that starts at the blanch', () => {
    const gum = planBatch(component('COMP_PEACH_GUM'), { qty: 350, madeAt: EVENING });
    const at = plus(EVENING, 12);

    expect(blanched(gum, component('COMP_PEACH_GUM'), at)).toEqual({
      state: 'BLANCHED',
      ready_at: at,
      expires_at: plus(at, 72),
    });
  });

  it('only applies to something soaking', () => {
    const tea = planBatch(component('COMP_TEA_RED'), { qty: 5000, madeAt: EVENING });
    expect(() => blanched(tea, component('COMP_TEA_RED'), EVENING)).toThrow(/not SOAKING/);
  });
});

describe('the batch list', () => {
  it('counts down to ready while steeping and to expiry after', () => {
    const tea = planBatch(component('COMP_TEA_RED'), { qty: 5000, madeAt: EVENING });
    const stock = snapshot({ batch: tea, movements: [productionMovement(tea, EVENING)] });

    const [steeping] = batchList(catalog, stock, plus(EVENING, 4));
    expect(steeping).toMatchObject({ state: 'STEEPING', readyInMs: 6 * HOUR });

    const [ready] = batchList(catalog, stock, plus(EVENING, 10 + 48));
    expect(ready).toMatchObject({ state: 'READY', readyInMs: null, leftMs: 24 * HOUR });
  });

  it('leaves out what is used up or thrown away', () => {
    const used = made('COMP_TEA_RED', 125);
    used.movements.push({ ...used.movements[0]!, id: 'SOLD', qty_delta: -125, reason: 'SALE' });
    const discarded = made('COMP_TEA_WHITE', 4000, { state: 'DISCARDED' });

    expect(batchList(catalog, snapshot(used, discarded), EVENING)).toEqual([]);
  });
});

describe('prep reminders', () => {
  it('asks for both teas when nothing will be ready tomorrow morning', () => {
    const reminders = prepReminders(catalog, snapshot(), EVENING);

    expect(reminders.map((reminder) => [reminder.component.id, reminder.startBy])).toEqual([
      ['COMP_TEA_RED', '21:00'],
      ['COMP_TEA_WHITE', '19:00'],
    ]);
    // 20:00: still in time for red, already late for white.
    expect(reminders.map((reminder) => reminder.late)).toEqual([false, true]);
    // 21:00 + 10 h steep = 07:00 Bangkok.
    expect(reminders[0]!.readyBy).toBe('2026-09-23T00:00:00.000Z');
  });

  it('is quiet once tonight’s batch is steeping', () => {
    const red = planBatch(component('COMP_TEA_RED'), { qty: 5000, madeAt: EVENING });
    const reminders = prepReminders(
      catalog,
      snapshot({ batch: red, movements: [productionMovement(red, EVENING)] }),
      EVENING,
    );

    expect(reminders.map((reminder) => reminder.component.id)).toEqual(['COMP_TEA_WHITE']);
  });

  it('goes quiet for a batch started late, rather than nagging until midnight', () => {
    const late = plus(EVENING, 2); // 22:00, an hour past red tea's 21:00
    const red = planBatch(component('COMP_TEA_RED'), { qty: 5000, madeAt: late });

    const before = prepReminders(catalog, snapshot(), late);
    expect(before.find((reminder) => reminder.component.id === 'COMP_TEA_RED')?.late).toBe(true);

    const after = prepReminders(
      catalog,
      snapshot({ batch: red, movements: [productionMovement(red, late)] }),
      late,
    );
    expect(after.map((reminder) => reminder.component.id)).toEqual(['COMP_TEA_WHITE']);
  });

  it('does not count tea that will be gone off or empty by morning', () => {
    const stale = made('COMP_TEA_RED', 3000, { expiresAt: '2026-09-22T22:00:00.000Z' });
    const empty = made('COMP_TEA_WHITE', 100);
    empty.movements.push({ ...empty.movements[0]!, id: 'SOLD', qty_delta: -100, reason: 'SALE' });

    expect(prepReminders(catalog, snapshot(stale, empty), EVENING)).toHaveLength(2);
  });

  it('reads the time from the component row, so it is edited as data', () => {
    const red = catalog.components.get('COMP_TEA_RED')!;
    (catalog.components as Map<string, Component>).set('COMP_TEA_RED', {
      ...red,
      prep_start_by: '22:30',
    });
    (catalog.components as Map<string, Component>).set('COMP_TEA_WHITE', {
      ...component('COMP_TEA_WHITE'),
      prep_start_by: null,
    });

    const reminders = prepReminders(catalog, snapshot(), EVENING);
    expect(reminders.map((reminder) => reminder.startBy)).toEqual(['22:30']);
  });
});
