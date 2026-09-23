import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';

export const DEVICE_ID_KEY = 'device_id';

/**
 * A stable id for this install, so a sale can say which phone rang it once a
 * second operator ever exists (CLAUDE.md §12).
 *
 * Provisioned at startup rather than lazily on read: a live query runs in a
 * read-only transaction and cannot write, and a sale is not the moment to
 * discover that.
 */
export async function ensureDeviceId(db: RuduPosDB = defaultDb): Promise<string> {
  const existing = await db.setting.get(DEVICE_ID_KEY);
  if (typeof existing?.value === 'string') return existing.value;

  const id = crypto.randomUUID();
  await db.setting.put({ key: DEVICE_ID_KEY, value: id, synced_at: null });
  return id;
}
