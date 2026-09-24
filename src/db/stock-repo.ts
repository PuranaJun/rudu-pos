/**
 * The thin Dexie layer over the stock engine.
 *
 * Every function here does one thing: read rows, hand them to a pure function
 * in src/domain/stock.ts, write what comes back. All the movements for a sale
 * land in a single transaction, so a phone that dies mid-write leaves the
 * ledger consistent rather than half-deducted (CLAUDE.md §6.1).
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { Component, ComponentBatch, StockMovement } from './types.ts';
import type { RecipeCatalog } from '../domain/recipe.ts';
import { adjustmentMovement } from '../domain/open-day.ts';
import { blanched, planBatch, sourceQtyFor, type BatchInput } from '../domain/production.ts';
import {
  batchRemaining,
  cutSlab,
  deductForSale,
  productionMovement,
  reverseForSale,
  stockAt,
  type DeductionPlan,
  type SaleLineDeduction,
  type StockSnapshot,
} from '../domain/stock.ts';
import { nowIso } from '../lib/id.ts';

/**
 * Batches and their ledger as they stand at `now`. Read once, then ask the
 * engine as often as needed. A steep that has run its time reads READY here
 * whether or not the stored row has caught up yet.
 */
export async function loadStockSnapshot(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<StockSnapshot> {
  const [batches, movements] = await Promise.all([
    db.component_batch.toArray(),
    db.stock_movement.toArray(),
  ]);
  return stockAt({ batches, movements }, now);
}

/**
 * Deduct every component of a sale in one transaction.
 *
 * The snapshot is read inside the transaction so two sales rung in quick
 * succession cannot both deduct from the same opening balance.
 */
export async function commitSaleStock(
  catalog: RecipeCatalog,
  lines: readonly SaleLineDeduction[],
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<DeductionPlan> {
  return db.transaction('rw', [db.component_batch, db.stock_movement], async () => {
    const snapshot = await loadStockSnapshot(db, now);
    const plan = deductForSale(catalog, snapshot, lines, now);
    await db.stock_movement.bulkAdd(plan.movements);
    return plan;
  });
}

/**
 * Void a sale and put every component back.
 *
 * Refuses a second void rather than crediting stock twice. A voided sale is
 * never edited afterwards — it is re-rung as a new sale.
 */
export async function voidSale(
  saleId: string,
  reason: string,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<StockMovement[]> {
  return db.transaction('rw', [db.sale, db.sale_line, db.stock_movement], async () => {
    const sale = await db.sale.get(saleId);
    if (!sale) throw new Error(`sale ${saleId} not found`);
    if (sale.is_voided) throw new Error(`sale ${saleId} is already voided`);

    const lineIds = (await db.sale_line.where('sale_id').equals(saleId).toArray()).map(
      (line) => line.id,
    );
    const movements = await db.stock_movement.toArray();
    const reversals = reverseForSale(lineIds, movements, now);

    await db.stock_movement.bulkAdd(reversals);
    await db.sale.update(saleId, { is_voided: true, void_reason: reason });

    return reversals;
  });
}

/**
 * Record a production batch and its opening balance.
 *
 * `consumes` is how one component eats another — a white-tea jelly batch takes
 * 500 ml off an active white-tea batch and points at it as its parent
 * (CLAUDE.md §2.1.3). The quantity is the caller's to supply; the coupling is
 * not modelled in the catalog yet.
 */
export async function recordBatch(
  batch: ComponentBatch,
  consumes: { batchId: string; qty: number } | null = null,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  await db.transaction('rw', [db.component_batch, db.stock_movement], async () => {
    await db.component_batch.add(batch);

    const movements: StockMovement[] = [productionMovement(batch, now)];
    if (consumes) {
      movements.push({
        id: crypto.randomUUID(),
        sale_line_id: null,
        component_batch_id: consumes.batchId,
        qty_delta: -consumes.qty,
        reason: 'PRODUCTION',
        reverses_movement_id: null,
        created_at: now,
        synced_at: null,
      });
    }

    await db.stock_movement.bulkAdd(movements);
  });
}

/**
 * Cut a jelly slab: the cubes become a batch of their own on the same-day
 * clock, the uncut remainder keeps the slab's longer one.
 */
export async function commitCut(
  catalog: RecipeCatalog,
  slabBatchId: string,
  grams: number,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<ComponentBatch> {
  return db.transaction('rw', [db.component_batch, db.stock_movement], async () => {
    const slab = await db.component_batch.get(slabBatchId);
    if (!slab) throw new Error(`batch ${slabBatchId} not found`);

    const plan = cutSlab(catalog, slab, grams, now);
    await db.component_batch.add(plan.batch);
    await db.stock_movement.bulkAdd(plan.movements);

    return plan.batch;
  });
}

/**
 * Bring a batch to what the operator counted, as an ADJUSTMENT row. The
 * current balance is read inside the transaction so a sale rung a moment
 * earlier is not silently undone by a stale number on the screen.
 */
export async function adjustBatch(
  batchId: string,
  counted: number,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<StockMovement | null> {
  return db.transaction('rw', [db.component_batch, db.stock_movement], async () => {
    const batch = await db.component_batch.get(batchId);
    if (!batch) throw new Error(`batch ${batchId} not found`);

    const movements = await db.stock_movement.where('component_batch_id').equals(batchId).toArray();
    const movement = adjustmentMovement(batchId, batchRemaining(batchId, movements), counted, now);
    if (movement) await db.stock_movement.add(movement);

    return movement;
  });
}

/**
 * Record a production batch (CLAUDE.md §6.3). A component made out of another
 * takes its share from the chosen source batch in the same transaction — the
 * jelly and the 500 ml of white tea it used land together or not at all.
 *
 * A source batch holding less than is needed is taken below zero rather than
 * refused: the jelly exists, and the ledger should say where it came from.
 */
export async function recordProduction(
  component: Component,
  input: BatchInput,
  db: RuduPosDB = defaultDb,
): Promise<ComponentBatch> {
  const batch = planBatch(component, input);
  const sourceQty = sourceQtyFor(component, input.qty);

  await db.transaction('rw', [db.component_batch, db.stock_movement], async () => {
    let consumes: { batchId: string; qty: number } | null = null;

    if (sourceQty !== null && input.sourceBatchId) {
      const source = await db.component_batch.get(input.sourceBatchId);
      if (source?.component_id !== component.source_component_id) {
        throw new Error(`batch ${input.sourceBatchId} is not ${component.source_component_id}`);
      }
      consumes = { batchId: source.id, qty: sourceQty };
    }

    await recordBatch(batch, consumes, db, input.madeAt);
  });

  return batch;
}

/** Peach gum out of the blanching pot: sellable from now, on a fresh clock. */
export async function blanchBatch(
  batchId: string,
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  await db.transaction('rw', [db.component_batch, db.component], async () => {
    const batch = await db.component_batch.get(batchId);
    if (!batch) throw new Error(`batch ${batchId} not found`);
    const component = await db.component.get(batch.component_id);
    if (!component) throw new Error(`component ${batch.component_id} not found`);

    await db.component_batch.update(batchId, blanched(batch, component, now));
  });
}

/**
 * Store READY on steeps that have finished. Reads already treat them as ready;
 * this only brings the rows into line, so a backup or an export tells the
 * same story. Run at startup — never on a timer.
 */
export async function promoteReadyBatches(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<number> {
  return db.transaction('rw', [db.component_batch], async () => {
    const due = (await db.component_batch.where('state').equals('STEEPING').toArray()).filter(
      (batch) => batch.ready_at <= now,
    );
    for (const batch of due) await db.component_batch.update(batch.id, { state: 'READY' });
    return due.length;
  });
}
