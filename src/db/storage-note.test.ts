import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { STORAGE_NOTE_KEY, dismissStorageNote, recordStorageDurability } from './storage-note.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-storage-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

const note = async () => (await db.setting.get(STORAGE_NOTE_KEY))?.value;

describe('the storage note', () => {
  it('is left for the operator when durable storage is refused, or cannot be asked for', async () => {
    await recordStorageDurability('denied', db);
    expect(await note()).toBe('PENDING');

    await db.setting.delete(STORAGE_NOTE_KEY);
    await recordStorageDurability('unsupported', db);
    expect(await note()).toBe('PENDING');
  });

  it('is shown once: after it is read, a later refusal does not bring it back', async () => {
    await recordStorageDurability('denied', db);
    await dismissStorageNote(db);
    await recordStorageDurability('denied', db);

    expect(await note()).toBe('SEEN');
  });

  it('is never left when storage is durable, and goes if it becomes durable before it is read', async () => {
    await recordStorageDurability('granted', db);
    expect(await note()).toBeUndefined();

    await recordStorageDurability('denied', db);
    await recordStorageDurability('granted', db);
    expect(await note()).toBeUndefined();
  });
});
