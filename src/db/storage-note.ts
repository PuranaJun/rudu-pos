/**
 * The one-time note when the phone will not promise to keep the data.
 *
 * Stored as a setting so it survives relaunches: shown until the operator
 * says they have read it, then never again. A later grant clears a note that
 * was never read — there is nothing left to warn about.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { StorageDurability } from '../lib/storage.ts';

export const STORAGE_NOTE_KEY = 'storage_persist_note';

export async function recordStorageDurability(
  result: StorageDurability,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.transaction('rw', [db.setting], async () => {
    const existing = await db.setting.get(STORAGE_NOTE_KEY);
    if (result === 'granted') {
      if (existing?.value === 'PENDING') await db.setting.delete(STORAGE_NOTE_KEY);
      return;
    }
    if (!existing)
      await db.setting.put({ key: STORAGE_NOTE_KEY, value: 'PENDING', synced_at: null });
  });
}

export async function dismissStorageNote(db: RuduPosDB = defaultDb): Promise<void> {
  await db.setting.put({ key: STORAGE_NOTE_KEY, value: 'SEEN', synced_at: null });
}
