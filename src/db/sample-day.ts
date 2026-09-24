/**
 * A plausible morning's stock, for development only.
 *
 * Reached from the DEV-build reseed and nowhere else — a production build has
 * no path to it. Recorded through the same path as a real batch, so the
 * clocks come from the catalog and the white-tea jelly takes its tea out of
 * the white tea. Both jellies are left as uncut slabs for open day to catch,
 * and the fresh pear is on its last few hours.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import { blanchBatch, recordProduction } from './stock-repo.ts';
import { addHours } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';

/** Component, quantity, and how many hours ago it was made. In making order. */
const SAMPLE: Array<[string, number, number]> = [
  ['COMP_TEA_RED', 5000, 12],
  ['COMP_TEA_WHITE', 4000, 14],
  ['COMP_CONC_TAMARIND', 3000, 36],
  ['COMP_CONC_PEAR', 3000, 36],
  ['COMP_JELLY_CHRYS', 1000, 12],
  ['COMP_JELLY_WHITE_GOJI', 1000, 12],
  ['COMP_PEAR_FRESH', 420, 16],
  ['COMP_PEACH_GUM', 350, 20],
  ['COMP_BASIL_SEED', 250, 1],
];

export async function stockSampleDay(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  const made = new Map<string, string>();

  for (const [componentId, qty, ageHours] of SAMPLE) {
    const component = await db.component.get(componentId);
    if (!component) continue;

    const madeAt = addHours(now, -ageHours);
    const sourceBatchId = component.source_component_id
      ? (made.get(component.source_component_id) ?? null)
      : null;
    if (component.source_component_id && !sourceBatchId) continue;

    const batch = await recordProduction(
      component,
      { qty, madeAt, sourceBatchId, note: 'ตัวอย่าง' },
      db,
    );
    made.set(componentId, batch.id);

    // Peach gum came out of the blanching pot once its soak was done.
    if (batch.state === 'SOAKING') await blanchBatch(batch.id, db, batch.ready_at);
  }
}
