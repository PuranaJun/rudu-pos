/**
 * A plausible morning's stock, for development only.
 *
 * Reached from the DEV-build reseed and nowhere else — a production build has
 * no path to it. It exists so open day and the sell screen can be exercised
 * before the production-batch screen does this for real: both jellies are
 * left as uncut slabs, the pear is on its last day, and the white-tea jelly
 * takes its 500 ml out of the white tea the way a real batch would.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import { recordBatch } from './stock-repo.ts';
import type { BatchState, ComponentBatch } from './types.ts';
import { newId, nowIso } from '../lib/id.ts';

interface SampleBatch {
  componentId: string;
  qty: number;
  state: BatchState;
  /** How long ago it was made. */
  ageHours: number;
  shelfLifeHours: number;
}

const SAMPLE: SampleBatch[] = [
  { componentId: 'COMP_TEA_RED', qty: 5000, state: 'READY', ageHours: 12, shelfLifeHours: 72 },
  { componentId: 'COMP_TEA_WHITE', qty: 4000, state: 'READY', ageHours: 14, shelfLifeHours: 72 },
  {
    componentId: 'COMP_CONC_TAMARIND',
    qty: 3000,
    state: 'READY',
    ageHours: 36,
    shelfLifeHours: 168,
  },
  { componentId: 'COMP_CONC_PEAR', qty: 3000, state: 'READY', ageHours: 36, shelfLifeHours: 168 },
  { componentId: 'COMP_JELLY_CHRYS', qty: 1000, state: 'SLAB', ageHours: 12, shelfLifeHours: 72 },
  { componentId: 'COMP_PEAR_FRESH', qty: 420, state: 'READY', ageHours: 16, shelfLifeHours: 24 },
  { componentId: 'COMP_PEACH_GUM', qty: 350, state: 'BLANCHED', ageHours: 20, shelfLifeHours: 72 },
  { componentId: 'COMP_BASIL_SEED', qty: 250, state: 'READY', ageHours: 1, shelfLifeHours: 24 },
];

export async function stockSampleDay(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  const at = Date.parse(now);
  const iso = (hoursFromNow: number) => new Date(at + hoursFromNow * 3_600_000).toISOString();

  const batch = (sample: SampleBatch): ComponentBatch => ({
    id: newId(),
    component_id: sample.componentId,
    made_at: iso(-sample.ageHours),
    qty_made: sample.qty,
    state: sample.state,
    ready_at: iso(-sample.ageHours),
    expires_at: iso(sample.shelfLifeHours - sample.ageHours),
    parent_batch_id: null,
    note: 'ตัวอย่าง',
    synced_at: null,
  });

  let whiteTeaId: string | null = null;
  for (const sample of SAMPLE) {
    const row = batch(sample);
    if (sample.componentId === 'COMP_TEA_WHITE') whiteTeaId = row.id;
    await recordBatch(row, null, db, row.made_at);
  }

  // The white-tea jelly is made out of the white tea (CLAUDE.md §2.1.3).
  const jelly = {
    ...batch({
      componentId: 'COMP_JELLY_WHITE_GOJI',
      qty: 1000,
      state: 'SLAB',
      ageHours: 12,
      shelfLifeHours: 72,
    }),
    parent_batch_id: whiteTeaId,
  };
  await recordBatch(
    jelly,
    whiteTeaId ? { batchId: whiteTeaId, qty: 500 } : null,
    db,
    jelly.made_at,
  );
}
