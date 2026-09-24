/**
 * The stock engine.
 *
 * This is the part of the app most likely to be built wrong, so the tests are
 * written against the real seeded catalog and the real default batch sizes
 * from docs/seed-data.md §3 rather than against invented numbers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from '../../db/database.ts';
import { loadCostCatalog } from '../../db/catalog.ts';
import { commitCut, commitSaleStock, loadStockSnapshot, voidSale } from '../../db/stock-repo.ts';
import { ensureSeeded } from '../../db/seed.ts';
import type { BatchState, ComponentBatch, StockMovement } from '../../db/types.ts';
import type { CostCatalog } from '../cost.ts';
import {
  availableCups,
  batchRemaining,
  componentRemaining,
  cutSlab,
  deductForSale,
  deductForSaleLine,
  effectiveExpiry,
  expiryStatus,
  isSellable,
  modifierAvailable,
  productionMovement,
  reverseForSale,
  sellableStates,
  type StockSnapshot,
} from '../stock.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

const NOW = '2026-09-23T02:00:00.000Z'; // 09:00 in Bangkok

beforeEach(async () => {
  dbName = `rudu-stock-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

// ---------------------------------------------------------------- fixtures

let batchSeq = 0;

/** A batch plus the PRODUCTION movement that is its opening balance. */
function makeBatch(
  componentId: string,
  qty: number,
  options: { state?: BatchState; expiresAt?: string; madeAt?: string } = {},
): { batch: ComponentBatch; movements: StockMovement[] } {
  batchSeq += 1;
  const madeAt = options.madeAt ?? '2026-09-22T00:00:00.000Z';
  const batch: ComponentBatch = {
    id: `BATCH_${componentId}_${batchSeq}`,
    component_id: componentId,
    made_at: madeAt,
    qty_made: qty,
    state: options.state ?? 'READY',
    ready_at: madeAt,
    expires_at: options.expiresAt ?? '2026-09-25T00:00:00.000Z',
    parent_batch_id: null,
    note: null,
    synced_at: null,
  };
  return { batch, movements: [productionMovement(batch, madeAt)] };
}

function snapshotOf(
  ...made: { batch: ComponentBatch; movements: StockMovement[] }[]
): StockSnapshot {
  return {
    batches: made.map((entry) => entry.batch),
    movements: made.flatMap((entry) => entry.movements),
  };
}

/** A full day's stock at the catalog's default batch sizes. */
function fullDay(): StockSnapshot {
  return snapshotOf(
    makeBatch('COMP_TEA_RED', 5000),
    makeBatch('COMP_TEA_WHITE', 4000),
    makeBatch('COMP_CONC_TAMARIND', 3000),
    makeBatch('COMP_CONC_PEAR', 3000),
    makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
    makeBatch('COMP_JELLY_WHITE_GOJI', 1000, { state: 'CUT' }),
    makeBatch('COMP_PEAR_FRESH', 420),
    makeBatch('COMP_PEACH_GUM', 350, { state: 'BLANCHED' }),
    makeBatch('COMP_BASIL_SEED', 250),
  );
}

function applied(snapshot: StockSnapshot, movements: readonly StockMovement[]): StockSnapshot {
  return { batches: snapshot.batches, movements: [...snapshot.movements, ...movements] };
}

// ------------------------------------------------------------------- tests

describe('the ledger', () => {
  it('computes what is left by summing movements, with no counter anywhere', () => {
    const tea = makeBatch('COMP_TEA_RED', 5000);
    const ledger = [
      ...tea.movements,
      { ...tea.movements[0]!, id: 'M2', qty_delta: -125, reason: 'SALE' as const },
      { ...tea.movements[0]!, id: 'M3', qty_delta: -125, reason: 'SALE' as const },
    ];

    expect(batchRemaining(tea.batch.id, ledger)).toBe(4750);
    // Nothing on the batch row itself changed.
    expect(tea.batch.qty_made).toBe(5000);
  });

  it('counts a batch with no movements as empty, not as its qty_made', () => {
    const tea = makeBatch('COMP_TEA_RED', 5000);
    expect(batchRemaining(tea.batch.id, [])).toBe(0);
  });
});

describe('sellable states', () => {
  it('is READY, CUT and BLANCHED — and nothing else', () => {
    expect([...sellableStates].sort()).toEqual(['BLANCHED', 'CUT', 'READY']);
    for (const state of ['STEEPING', 'SOAKING', 'SLAB', 'EXPIRED', 'DISCARDED'] as BatchState[]) {
      expect(isSellable(state)).toBe(false);
    }
  });

  it('ignores unsellable batches when adding up a component', () => {
    const snapshot = snapshotOf(
      makeBatch('COMP_TEA_RED', 5000, { state: 'STEEPING' }),
      makeBatch('COMP_TEA_RED', 2000, { state: 'READY' }),
    );
    expect(componentRemaining(snapshot, 'COMP_TEA_RED')).toBe(2000);
  });
});

describe('availableCups', () => {
  it('1. tamarind at full stock makes 33 cups, limited by the jelly', () => {
    // red tea 5000/125 = 40, concentrate 3000/50 = 60, jelly 1000/30 = 33.3
    const result = availableCups(catalog, fullDay(), 'VAR_TAMARIND_ICED');

    expect(result).toEqual({ cups: 33, limitingComponentId: 'COMP_JELLY_CHRYS' });
  });

  it('2. fresh pear at 420 g caps iced pear at 20 cups', () => {
    // 420/21 = 20, against tea 40, concentrate 60 and jelly 33.
    const result = availableCups(catalog, fullDay(), 'VAR_PEAR_ICED');

    expect(result).toEqual({ cups: 20, limitingComponentId: 'COMP_PEAR_FRESH' });
  });

  it('3. hot pear is not limited by jelly at all, and is limited by peach gum', () => {
    const noJelly = snapshotOf(
      makeBatch('COMP_TEA_WHITE', 4000),
      makeBatch('COMP_CONC_PEAR', 3000),
      makeBatch('COMP_PEAR_FRESH', 420),
      makeBatch('COMP_PEACH_GUM', 350, { state: 'BLANCHED' }),
    );

    // Not a gram of jelly in the shop, and hot pear is still sellable.
    expect(componentRemaining(noJelly, 'COMP_JELLY_WHITE_GOJI')).toBe(0);
    expect(availableCups(catalog, noJelly, 'VAR_PEAR_HOT')).toEqual({
      cups: 17, // peach gum 350/20
      limitingComponentId: 'COMP_PEACH_GUM',
    });

    // Iced pear, which does take jelly, is sold out on the same stock.
    expect(availableCups(catalog, noJelly, 'VAR_PEAR_ICED')).toEqual({
      cups: 0,
      limitingComponentId: 'COMP_JELLY_WHITE_GOJI',
    });
  });

  it('3b. peach gum binds hot pear before fresh pear does', () => {
    const result = availableCups(catalog, fullDay(), 'VAR_PEAR_HOT');
    expect(result).toEqual({ cups: 17, limitingComponentId: 'COMP_PEACH_GUM' });
  });

  it('4. basil seed at zero leaves tamarind sellable and the modifier unavailable', () => {
    const noBasil = snapshotOf(
      makeBatch('COMP_TEA_RED', 5000),
      makeBatch('COMP_CONC_TAMARIND', 3000),
      makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
      makeBatch('COMP_BASIL_SEED', 0),
    );

    expect(availableCups(catalog, noBasil, 'VAR_TAMARIND_ICED').cups).toBe(33);
    expect(modifierAvailable(catalog, noBasil, 'MOD_BASIL_SEED')).toBe(false);
    // Salted plum has no component to run out of.
    expect(modifierAvailable(catalog, noBasil, 'MOD_SALTED_PLUM')).toBe(true);
  });

  it('never lets an untracked component sell out a drink', () => {
    // The garnish is in both pear BOMs and is never batch tracked.
    const noGarnishBatches = fullDay();
    expect(componentRemaining(noGarnishBatches, 'COMP_CHRYS_GARNISH')).toBe(0);
    expect(availableCups(catalog, noGarnishBatches, 'VAR_PEAR_ICED').cups).toBe(20);
  });

  it('reports zero rather than a negative when a batch has been stretched', () => {
    const stretched = snapshotOf(makeBatch('COMP_TEA_RED', -500));
    expect(availableCups(catalog, stretched, 'VAR_TAMARIND_ICED')).toEqual({
      cups: 0,
      limitingComponentId: 'COMP_TEA_RED',
    });
  });

  it('adds two batches of one component together', () => {
    const twoTeas = snapshotOf(
      makeBatch('COMP_TEA_RED', 2500),
      makeBatch('COMP_TEA_RED', 2500),
      makeBatch('COMP_CONC_TAMARIND', 3000),
      makeBatch('COMP_JELLY_CHRYS', 5000, { state: 'CUT' }),
    );
    // 5000 ml of tea between two piles = 40 cups.
    expect(availableCups(catalog, twoTeas, 'VAR_TAMARIND_ICED')).toEqual({
      cups: 40,
      limitingComponentId: 'COMP_TEA_RED',
    });
  });
});

describe('FEFO', () => {
  it('5. drains the batch that expires first, then spills into the next', () => {
    const older = makeBatch('COMP_TEA_RED', 300, { expiresAt: '2026-09-23T12:00:00.000Z' });
    const newer = makeBatch('COMP_TEA_RED', 5000, { expiresAt: '2026-09-26T00:00:00.000Z' });
    const snapshot = snapshotOf(
      older,
      newer,
      makeBatch('COMP_CONC_TAMARIND', 3000),
      makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
    );

    // 3 cups take 375 ml of tea; the older pile only holds 300.
    const plan = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 3 },
      NOW,
    );

    const teaMovements = plan.movements.filter((m) =>
      m.component_batch_id.startsWith('BATCH_COMP_TEA_RED'),
    );
    expect(teaMovements.map((m) => [m.component_batch_id, m.qty_delta])).toEqual([
      [older.batch.id, -300],
      [newer.batch.id, -75],
    ]);

    const after = applied(snapshot, plan.movements);
    expect(batchRemaining(older.batch.id, after.movements)).toBe(0);
    expect(batchRemaining(newer.batch.id, after.movements)).toBe(4925);
    expect(plan.shortfalls).toEqual([]);
  });

  it('orders by expiry, not by the order batches were made', () => {
    // Made first, but expires last.
    const madeFirst = makeBatch('COMP_TEA_RED', 1000, {
      madeAt: '2026-09-20T00:00:00.000Z',
      expiresAt: '2026-09-30T00:00:00.000Z',
    });
    const madeSecond = makeBatch('COMP_TEA_RED', 1000, {
      madeAt: '2026-09-22T00:00:00.000Z',
      expiresAt: '2026-09-24T00:00:00.000Z',
    });
    const snapshot = snapshotOf(
      madeFirst,
      madeSecond,
      makeBatch('COMP_CONC_TAMARIND', 3000),
      makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
    );

    const plan = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
      NOW,
    );

    const tea = plan.movements.find((m) => m.component_batch_id.startsWith('BATCH_COMP_TEA_RED'));
    expect(tea?.component_batch_id).toBe(madeSecond.batch.id);
  });

  it('shares one balance across the lines of a sale', () => {
    const tea = makeBatch('COMP_TEA_RED', 200, { expiresAt: '2026-09-23T12:00:00.000Z' });
    const spare = makeBatch('COMP_TEA_RED', 5000);
    const snapshot = snapshotOf(
      tea,
      spare,
      makeBatch('COMP_CONC_TAMARIND', 3000),
      makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
    );

    // Two separate lines of one cup each: the second must see the first.
    const plan = deductForSale(
      catalog,
      snapshot,
      [
        { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
        { saleLineId: 'LINE_2', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
      ],
      NOW,
    );

    const after = applied(snapshot, plan.movements);
    expect(batchRemaining(tea.batch.id, after.movements)).toBe(0);
    expect(batchRemaining(spare.batch.id, after.movements)).toBe(4950);
  });

  it('never deducts from an unsellable batch', () => {
    const slab = makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'SLAB' });
    const cut = makeBatch('COMP_JELLY_CHRYS', 500, { state: 'CUT' });
    const snapshot = snapshotOf(
      slab,
      cut,
      makeBatch('COMP_TEA_RED', 5000),
      makeBatch('COMP_CONC_TAMARIND', 3000),
    );

    const plan = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
      NOW,
    );

    const jelly = plan.movements.filter((m) => m.component_batch_id.startsWith('BATCH_COMP_JELLY'));
    expect(jelly.map((m) => m.component_batch_id)).toEqual([cut.batch.id]);
  });
});

describe('warn, never block', () => {
  it('lets the operator stretch the last batch, and records it as an override', () => {
    const tea = makeBatch('COMP_TEA_RED', 100);
    const snapshot = snapshotOf(
      tea,
      makeBatch('COMP_CONC_TAMARIND', 3000),
      makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
    );

    const plan = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
      NOW,
    );

    const tea1 = plan.movements.filter((m) => m.component_batch_id === tea.batch.id);
    expect(tea1.map((m) => [m.reason, m.qty_delta])).toEqual([
      ['SALE', -100],
      ['OVERRIDE', -25],
    ]);
    // The ledger now says the batch was poured 25 ml past what was recorded.
    expect(batchRemaining(tea.batch.id, applied(snapshot, plan.movements).movements)).toBe(-25);
  });

  it('reports a shortfall when there is no batch at all to deduct from', () => {
    const snapshot = snapshotOf(
      makeBatch('COMP_TEA_RED', 5000),
      makeBatch('COMP_CONC_TAMARIND', 3000),
      // No jelly batch exists.
    );

    const plan = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 2 },
      NOW,
    );

    expect(plan.shortfalls).toEqual([{ componentId: 'COMP_JELLY_CHRYS', qty: 60 }]);
    // The rest of the sale still deducted.
    expect(plan.movements.some((m) => m.component_batch_id.startsWith('BATCH_COMP_TEA_RED'))).toBe(
      true,
    );
  });
});

describe('modifiers and preparation', () => {
  it('deducts a modifier component on top of the BOM', () => {
    const snapshot = fullDay();
    const plan = deductForSaleLine(
      catalog,
      snapshot,
      {
        saleLineId: 'LINE_1',
        variantId: 'VAR_TAMARIND_ICED',
        qty: 1,
        modifierIds: ['MOD_BASIL_SEED'],
      },
      NOW,
    );

    const basil = plan.movements.filter((m) =>
      m.component_batch_id.startsWith('BATCH_COMP_BASIL_SEED'),
    );
    expect(basil.map((m) => m.qty_delta)).toEqual([-35]);
  });

  it('deducts the reduced concentrate for PREP_LESS_SWEET, and only the concentrate', () => {
    const snapshot = fullDay();
    const plan = deductForSaleLine(
      catalog,
      snapshot,
      {
        saleLineId: 'LINE_1',
        variantId: 'VAR_PEAR_ICED',
        qty: 1,
        modifierIds: ['PREP_LESS_SWEET'],
      },
      NOW,
    );

    const byComponent = Object.fromEntries(
      plan.movements.map((m) => [m.component_batch_id.replace(/_\d+$/, ''), m.qty_delta]),
    );
    expect(byComponent['BATCH_COMP_CONC_PEAR']).toBe(-35);
    expect(byComponent['BATCH_COMP_TEA_WHITE']).toBe(-100);
    expect(byComponent['BATCH_COMP_PEAR_FRESH']).toBe(-21);
  });

  it('still deducts the solids for PREP_NO_SOLIDS — they were portioned already', () => {
    const snapshot = fullDay();
    const plain = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'L', variantId: 'VAR_PEAR_ICED', qty: 1 },
      NOW,
    );
    const noSolids = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'L', variantId: 'VAR_PEAR_ICED', qty: 1, modifierIds: ['PREP_NO_SOLIDS'] },
      NOW,
    );

    expect(totalByComponent(noSolids.movements)).toEqual(totalByComponent(plain.movements));
  });

  it('checks a modifier against the cups being rung, not just one', () => {
    const almostGone = snapshotOf(makeBatch('COMP_BASIL_SEED', 50));
    expect(modifierAvailable(catalog, almostGone, 'MOD_BASIL_SEED', 1)).toBe(true);
    expect(modifierAvailable(catalog, almostGone, 'MOD_BASIL_SEED', 2)).toBe(false);
  });
});

describe('cutting a slab', () => {
  it('6. a SLAB contributes nothing, and the cut cubes do', async () => {
    const slab = makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'SLAB' });
    const snapshot = snapshotOf(
      slab,
      makeBatch('COMP_TEA_RED', 5000),
      makeBatch('COMP_CONC_TAMARIND', 3000),
    );

    // Uncut jelly in the tray: the drink is not sellable.
    expect(availableCups(catalog, snapshot, 'VAR_TAMARIND_ICED')).toEqual({
      cups: 0,
      limitingComponentId: 'COMP_JELLY_CHRYS',
    });

    const plan = cutSlab(catalog, slab.batch, 600, NOW);
    const after = {
      batches: [...snapshot.batches, plan.batch],
      movements: [...snapshot.movements, ...plan.movements],
    };

    // 600 g cut = 20 cups.
    expect(availableCups(catalog, after, 'VAR_TAMARIND_ICED')).toEqual({
      cups: 20,
      limitingComponentId: 'COMP_JELLY_CHRYS',
    });
  });

  it('leaves the uncut remainder on the longer clock', () => {
    const slab = makeBatch('COMP_JELLY_CHRYS', 1000, {
      state: 'SLAB',
      madeAt: '2026-09-22T00:00:00.000Z',
      expiresAt: '2026-09-25T00:00:00.000Z', // 72 h
    });

    const plan = cutSlab(catalog, slab.batch, 600, NOW);

    // The cut cubes are on a 24 h clock from the cut, not from the pour.
    expect(plan.batch.expires_at).toBe('2026-09-24T02:00:00.000Z');
    expect(plan.batch.parent_batch_id).toBe(slab.batch.id);
    // The slab row is untouched: 400 g still good until the 25th.
    expect(slab.batch.expires_at).toBe('2026-09-25T00:00:00.000Z');
    expect(batchRemaining(slab.batch.id, [...slab.movements, ...plan.movements])).toBe(400);
  });

  it('never gives cut cubes longer than the slab they came from', () => {
    const slab = makeBatch('COMP_JELLY_CHRYS', 1000, {
      state: 'SLAB',
      expiresAt: '2026-09-23T07:00:00.000Z', // five hours after NOW
    });

    const plan = cutSlab(catalog, slab.batch, 600, NOW);

    expect(plan.batch.expires_at).toBe('2026-09-23T07:00:00.000Z');
  });

  it('refuses to cut something that is not a slab', () => {
    const ready = makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' });
    expect(() => cutSlab(catalog, ready.batch, 100, NOW)).toThrow(/not a SLAB/);
    expect(() =>
      cutSlab(catalog, makeBatch('COMP_JELLY_CHRYS', 1, { state: 'SLAB' }).batch, 0, NOW),
    ).toThrow(/positive/);
  });
});

describe('expiry', () => {
  const component = () => catalog.components.get('COMP_JELLY_CHRYS')!;

  it('reads OK well before the date', () => {
    const batch = makeBatch('COMP_JELLY_CHRYS', 1000, {
      expiresAt: '2026-09-26T00:00:00.000Z',
    }).batch;
    expect(expiryStatus(batch, component(), NOW)).toBe('OK');
  });

  it('warns inside the last 12 hours', () => {
    const batch = makeBatch('COMP_JELLY_CHRYS', 1000, {
      expiresAt: '2026-09-23T08:00:00.000Z', // 6 h after NOW
    }).batch;
    expect(expiryStatus(batch, component(), NOW)).toBe('EXPIRING_SOON');
  });

  it('reads EXPIRED on and after the date', () => {
    const batch = makeBatch('COMP_JELLY_CHRYS', 1000, { expiresAt: NOW }).batch;
    expect(expiryStatus(batch, component(), NOW)).toBe('EXPIRED');
  });

  it('puts a CUT batch on the cut clock even if expires_at was never shortened', () => {
    // A batch cut at 02:00 but still carrying the slab's 72 h date.
    const batch = makeBatch('COMP_JELLY_CHRYS', 600, {
      state: 'CUT',
      madeAt: '2026-09-22T02:00:00.000Z',
      expiresAt: '2026-09-25T00:00:00.000Z',
    }).batch;

    // cut_shelf_life_hours is 24, so it actually died at 02:00 on the 23rd.
    expect(effectiveExpiry(batch, component())).toBe('2026-09-23T02:00:00.000Z');
    expect(expiryStatus(batch, component(), NOW)).toBe('EXPIRED');
  });
});

describe('voiding', () => {
  it('7. sell five cups, void, and every component is back where it started', () => {
    const snapshot = fullDay();
    const before = totalsByComponent(catalog, snapshot);

    const plan = deductForSale(
      catalog,
      snapshot,
      [
        { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 3 },
        {
          saleLineId: 'LINE_2',
          variantId: 'VAR_PEAR_ICED',
          qty: 2,
          modifierIds: ['MOD_PEACH_GUM'],
        },
      ],
      NOW,
    );

    const sold = applied(snapshot, plan.movements);
    expect(componentRemaining(sold, 'COMP_TEA_RED')).toBe(5000 - 375);
    expect(componentRemaining(sold, 'COMP_PEAR_FRESH')).toBe(420 - 42);
    expect(componentRemaining(sold, 'COMP_PEACH_GUM')).toBe(350 - 40);

    const reversals = reverseForSale(['LINE_1', 'LINE_2'], sold.movements, NOW);
    const voided = applied(sold, reversals);

    expect(totalsByComponent(catalog, voided)).toEqual(before);
    expect(reversals.every((m) => m.reason === 'VOID_REVERSAL')).toBe(true);
  });

  it('reverses an override too, so a stretched batch comes back as well', () => {
    const tea = makeBatch('COMP_TEA_RED', 100);
    const snapshot = snapshotOf(
      tea,
      makeBatch('COMP_CONC_TAMARIND', 3000),
      makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'CUT' }),
    );

    const plan = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
      NOW,
    );
    const sold = applied(snapshot, plan.movements);
    const voided = applied(sold, reverseForSale(['LINE_1'], sold.movements, NOW));

    expect(batchRemaining(tea.batch.id, voided.movements)).toBe(100);
  });

  it('cannot reverse a reversal', () => {
    const snapshot = fullDay();
    const plan = deductForSaleLine(
      catalog,
      snapshot,
      { saleLineId: 'LINE_1', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
      NOW,
    );
    const sold = applied(snapshot, plan.movements);
    const voided = applied(sold, reverseForSale(['LINE_1'], sold.movements, NOW));

    expect(reverseForSale(['LINE_1'], voided.movements, NOW)).toHaveLength(0);
  });

  it('leaves other sales alone', () => {
    const snapshot = fullDay();
    const plan = deductForSale(
      catalog,
      snapshot,
      [
        { saleLineId: 'LINE_KEEP', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
        { saleLineId: 'LINE_VOID', variantId: 'VAR_TAMARIND_ICED', qty: 1 },
      ],
      NOW,
    );
    const sold = applied(snapshot, plan.movements);
    const voided = applied(sold, reverseForSale(['LINE_VOID'], sold.movements, NOW));

    expect(componentRemaining(voided, 'COMP_TEA_RED')).toBe(5000 - 125);
  });
});

describe('the repository', () => {
  it('writes a sale, a cut and a void through Dexie', async () => {
    // A slab, uncut: the drink is not sellable yet.
    const slab = makeBatch('COMP_JELLY_CHRYS', 1000, { state: 'SLAB' });
    const tea = makeBatch('COMP_TEA_RED', 5000);
    const conc = makeBatch('COMP_CONC_TAMARIND', 3000);
    await db.component_batch.bulkAdd([slab.batch, tea.batch, conc.batch]);
    await db.stock_movement.bulkAdd([...slab.movements, ...tea.movements, ...conc.movements]);

    expect(availableCups(catalog, await loadStockSnapshot(db), 'VAR_TAMARIND_ICED').cups).toBe(0);

    await commitCut(catalog, slab.batch.id, 600, db, NOW);
    expect(availableCups(catalog, await loadStockSnapshot(db), 'VAR_TAMARIND_ICED').cups).toBe(20);

    const saleId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    await db.sale.add({
      id: saleId,
      created_at: NOW,
      business_date: '2026-09-23',
      operator_id: 'เจ้าของ',
      total_gross: 4000,
      total_discount: 0,
      total_net: 4000,
      total_cost: 684,
      payment_method: 'CASH',
      cash_received: 4000,
      cash_change: 0,
      is_voided: false,
      void_reason: null,
      device_id: 'test',
      synced_at: null,
    });
    await db.sale_line.add({
      id: lineId,
      sale_id: saleId,
      variant_id: 'VAR_TAMARIND_ICED',
      qty: 2,
      unit_price: 4000,
      line_discount: 0,
      discount_reason: null,
      unit_cost: 684,
      synced_at: null,
    });

    await commitSaleStock(
      catalog,
      [{ saleLineId: lineId, variantId: 'VAR_TAMARIND_ICED', qty: 2 }],
      db,
      NOW,
    );

    let snapshot = await loadStockSnapshot(db);
    expect(componentRemaining(snapshot, 'COMP_TEA_RED')).toBe(4750);
    expect(componentRemaining(snapshot, 'COMP_JELLY_CHRYS')).toBe(540);

    await voidSale(saleId, 'ลูกค้าเปลี่ยนใจ', db, NOW);

    snapshot = await loadStockSnapshot(db);
    expect(componentRemaining(snapshot, 'COMP_TEA_RED')).toBe(5000);
    expect(componentRemaining(snapshot, 'COMP_JELLY_CHRYS')).toBe(600);
    expect((await db.sale.get(saleId))?.is_voided).toBe(true);
  });

  it('refuses to void the same sale twice', async () => {
    const saleId = crypto.randomUUID();
    await db.sale.add({
      id: saleId,
      created_at: NOW,
      business_date: '2026-09-23',
      operator_id: 'เจ้าของ',
      total_gross: 4000,
      total_discount: 0,
      total_net: 4000,
      total_cost: 684,
      payment_method: 'CASH',
      cash_received: 4000,
      cash_change: 0,
      is_voided: false,
      void_reason: null,
      device_id: 'test',
      synced_at: null,
    });

    await voidSale(saleId, 'ผิดรายการ', db, NOW);
    await expect(voidSale(saleId, 'again', db, NOW)).rejects.toThrow(/already voided/);
  });
});

// --------------------------------------------------------------- helpers

function totalByComponent(movements: readonly StockMovement[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const movement of movements) {
    const key = movement.component_batch_id.replace(/_\d+$/, '');
    totals[key] = (totals[key] ?? 0) + movement.qty_delta;
  }
  return totals;
}

function totalsByComponent(catalog: CostCatalog, snapshot: StockSnapshot): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const component of catalog.components.values()) {
    totals[component.id] = componentRemaining(snapshot, component.id);
  }
  return totals;
}
