/**
 * A plausible morning's stock, for development only.
 *
 * Reached from the DEV-build reseed and nowhere else — a production build has
 * no path to it. One batch of every component on the menu, at its usual size,
 * recorded through the same path as a real batch: the clocks come from the
 * catalog, and a jelly takes its tea out of the tea. Steeps were started long
 * enough ago to be ready; jellies are left as uncut slabs for open day to
 * catch.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import { blanchBatch, recordProduction } from './stock-repo.ts';
import { addHours } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';

export async function stockSampleDay(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  const components = (await db.component.toArray())
    .filter((component) => component.is_batch_tracked && component.is_active)
    // Made before whatever is made out of it: the tea before its jelly.
    .sort(
      (a, b) =>
        Number(a.source_component_id !== null) - Number(b.source_component_id !== null) ||
        a.sort_order - b.sort_order,
    );
  const made = new Map<string, string>();

  for (const component of components) {
    if (component.default_batch_qty === null) continue;

    // Ready an hour ago, and well inside even a same-day shelf life.
    const madeAt = addHours(now, -(component.lead_time_hours + 1));
    const sourceBatchId = component.source_component_id
      ? (made.get(component.source_component_id) ?? null)
      : null;
    if (component.source_component_id && !sourceBatchId) continue;

    const batch = await recordProduction(
      component,
      { qty: component.default_batch_qty, madeAt, sourceBatchId, note: 'ตัวอย่าง' },
      db,
    );
    made.set(component.id, batch.id);

    if (batch.state === 'SOAKING') await blanchBatch(batch.id, db, batch.ready_at);
  }
}
