/**
 * Recording what was made (CLAUDE.md §6.3).
 *
 * Pure. Every clock on a batch comes from its component row — lead time,
 * shelf life, lifecycle — so a recipe change after the taste tests is a
 * settings edit, not a code change (CLAUDE.md §2.1.7, §12).
 *
 * One rule for all of them: **shelf life runs from when the batch is ready.**
 * Cold brew's 72 hours start when the bag is lifted, not when the water went
 * in; peach gum's start when it is blanched, not when it went in to soak.
 */
import { addHours, bangkokAt, bangkokDate } from '../lib/datetime.ts';
import { newId } from '../lib/id.ts';
import type { BatchState, Component, ComponentBatch, Lifecycle } from '../db/types.ts';
import type { CostCatalog } from './cost.ts';
import { shelfStatus, type ShelfStatus } from './open-day.ts';
import {
  batchRemaining,
  effectiveExpiry,
  isSellable,
  stateAt,
  type StockSnapshot,
} from './stock.ts';

/** For components that do not go off. Far enough away never to warn. */
const NEVER = '9999-12-31T23:59:59.999Z';

/** Where a fresh batch starts. Everything after is its own recorded step. */
export function initialState(lifecycle: Lifecycle): BatchState {
  switch (lifecycle) {
    case 'STEEP':
      return 'STEEPING';
    case 'SOAK_BLANCH':
      return 'SOAKING';
    case 'SLAB_CUT':
      return 'SLAB';
    case 'SIMPLE':
      return 'READY';
  }
}

/**
 * How much of its source a batch of this size uses: 1,000 g of white-tea
 * jelly takes 500 ml of white tea. Null for a component made from scratch.
 */
export function sourceQtyFor(component: Component, qty: number): number | null {
  if (component.source_component_id === null || component.source_qty_per_unit === null) {
    return null;
  }
  return qty * component.source_qty_per_unit;
}

export interface BatchInput {
  qty: number;
  madeAt: string;
  /** Required when the component is made out of another one. */
  sourceBatchId?: string | null;
  note?: string | null;
}

/** The state and clocks a batch made at `madeAt` would start with. */
export function clocksFor(
  component: Component,
  madeAt: string,
): Pick<ComponentBatch, 'state' | 'ready_at' | 'expires_at'> {
  const readyAt = addHours(madeAt, component.lead_time_hours);
  return {
    state: initialState(component.lifecycle),
    ready_at: readyAt,
    expires_at: expiryFrom(component, readyAt),
  };
}

/** A new batch, with its state and clocks set from the catalog. */
export function planBatch(component: Component, input: BatchInput): ComponentBatch {
  if (!component.is_batch_tracked) {
    throw new Error(`${component.id} is not batch tracked`);
  }
  if (!(input.qty > 0)) throw new Error('a batch must have a positive quantity');
  if (component.source_component_id !== null && !input.sourceBatchId) {
    // Without it the source silently over-reports and the shop runs out
    // mid-service (CLAUDE.md §2.1.3).
    throw new Error(
      `${component.id} is made from ${component.source_component_id}: pick the batch`,
    );
  }

  const clocks = clocksFor(component, input.madeAt);

  return {
    id: newId(),
    component_id: component.id,
    made_at: input.madeAt,
    qty_made: input.qty,
    ...clocks,
    parent_batch_id: input.sourceBatchId ?? null,
    note: input.note ?? null,
    synced_at: null,
  };
}

/**
 * Soaked peach gum, blanched and chilled: sellable from now, on a clock that
 * starts now. An explicit step — only the operator knows when it happened.
 */
export function blanched(
  batch: ComponentBatch,
  component: Component,
  now: string,
): Pick<ComponentBatch, 'state' | 'ready_at' | 'expires_at'> {
  if (batch.state !== 'SOAKING')
    throw new Error(`batch ${batch.id} is ${batch.state}, not SOAKING`);
  return { state: 'BLANCHED', ready_at: now, expires_at: expiryFrom(component, now) };
}

export interface SourceOption {
  batch: ComponentBatch;
  remaining: number;
  /** False when this batch holds less than the new batch needs. A warning, not a refusal. */
  enough: boolean;
}

/**
 * The batches a new batch could be made out of: ready, in date, not empty,
 * soonest expiry first so the default is the one that should be used up.
 */
export function sourceOptions(
  catalog: CostCatalog,
  snapshot: StockSnapshot,
  component: Component,
  qty: number,
  now: string,
): SourceOption[] {
  const sourceId = component.source_component_id;
  const source = sourceId ? catalog.components.get(sourceId) : undefined;
  if (!source) return [];

  const needed = sourceQtyFor(component, qty) ?? 0;

  return snapshot.batches
    .filter(
      (batch) =>
        batch.component_id === source.id &&
        isSellable(stateAt(batch, now)) &&
        shelfStatus(batch, source, now) !== 'EXPIRED',
    )
    .map((batch) => {
      const remaining = batchRemaining(batch.id, snapshot.movements);
      return { batch, remaining, enough: remaining >= needed };
    })
    .filter((option) => option.remaining > 0)
    .sort(
      (a, b) =>
        a.batch.expires_at.localeCompare(b.batch.expires_at) ||
        a.batch.made_at.localeCompare(b.batch.made_at),
    );
}

export interface BatchListEntry {
  batch: ComponentBatch;
  component: Component;
  /** The state now: a finished steep reads READY. */
  state: BatchState;
  remaining: number;
  /** Time until ready while steeping or soaking; null once it is. */
  readyInMs: number | null;
  /** Time until it goes off. Negative once it has. */
  leftMs: number;
  status: ShelfStatus;
}

/**
 * Everything made and not yet used up or thrown away, in menu order, the
 * batch to use first at the top of each component.
 */
export function batchList(
  catalog: CostCatalog,
  snapshot: StockSnapshot,
  now: string,
): BatchListEntry[] {
  const at = Date.parse(now);
  const entries: BatchListEntry[] = [];

  for (const batch of snapshot.batches) {
    const component = catalog.components.get(batch.component_id);
    if (!component || batch.state === 'DISCARDED' || batch.state === 'EXPIRED') continue;

    const remaining = batchRemaining(batch.id, snapshot.movements);
    if (remaining <= 0) continue;

    const state = stateAt(batch, now);
    const waiting = state === 'STEEPING' || state === 'SOAKING';

    entries.push({
      batch,
      component,
      state,
      remaining,
      readyInMs: waiting ? Math.max(0, Date.parse(batch.ready_at) - at) : null,
      leftMs: Date.parse(effectiveExpiry(batch, component)) - at,
      status: shelfStatus(batch, component, now),
    });
  }

  return entries.sort(
    (a, b) =>
      a.component.sort_order - b.component.sort_order ||
      a.batch.expires_at.localeCompare(b.batch.expires_at) ||
      a.batch.made_at.localeCompare(b.batch.made_at),
  );
}

export interface PrepReminder {
  component: Component;
  /** `HH:mm` in Bangkok, from the component row. */
  startBy: string;
  /** When a batch started on time would be ready: tomorrow morning. */
  readyBy: string;
  /** Past the start-by time already. Still worth starting; it just says so. */
  late: boolean;
}

/**
 * Components that need starting tonight to be ready tomorrow morning.
 *
 * "Tomorrow morning" is not a constant: it is tonight's start-by time plus
 * the component's lead time — 21:00 + 10 h steep = 07:00. A batch already
 * made covers it if it will be ready by then (or was started tonight, however
 * late), still be in date then, and has something left in it.
 *
 * Computed when the screen draws. Nothing is scheduled and nothing wakes the
 * phone to show it (CLAUDE.md §1).
 */
export function prepReminders(
  catalog: CostCatalog,
  snapshot: StockSnapshot,
  now: string,
): PrepReminder[] {
  const today = bangkokDate(now);
  const reminders: PrepReminder[] = [];

  const components = [...catalog.components.values()]
    .filter((component) => component.is_batch_tracked && isClockTime(component.prep_start_by))
    .sort((a, b) => a.sort_order - b.sort_order);

  for (const component of components) {
    const startBy = component.prep_start_by!;
    const deadline = bangkokAt(today, startBy);
    const readyBy = addHours(deadline, component.lead_time_hours);

    const covered = snapshot.batches.some(
      (batch) =>
        batch.component_id === component.id &&
        batch.state !== 'DISCARDED' &&
        batch.state !== 'EXPIRED' &&
        // Started late is still started: once tonight's batch is in, there is
        // nothing left for the banner to ask for.
        (batch.ready_at <= readyBy || batch.made_at >= deadline) &&
        effectiveExpiry(batch, component) > readyBy &&
        batchRemaining(batch.id, snapshot.movements) > 0,
    );

    if (!covered) reminders.push({ component, startBy, readyBy, late: now > deadline });
  }

  return reminders;
}

// ------------------------------------------------------------------ private

function expiryFrom(component: Component, from: string): string {
  return component.shelf_life_hours === null ? NEVER : addHours(from, component.shelf_life_hours);
}

function isClockTime(value: string | null): boolean {
  return value !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
