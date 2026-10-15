/**
 * Online sync, the phone's side (CLAUDE.md §8).
 *
 * The shop phone is the only one that writes. It sends what changed; a
 * view-only device fetches it. Last write wins per row, and there is nothing
 * to merge because only one device ever writes.
 *
 * Never on the sell path, never awaited by a sale, never on a loop:
 * - a change schedules one send, a little after the last change (one-shot);
 * - opening the app, or coming back online, sends (shop) or fetches (viewer);
 * - and there is a button.
 * With no signal it does nothing and loses nothing: unsent rows stay marked
 * until a send gets through.
 */
import type { RuduPosDB, SyncedTable } from '../db/database.ts';
import {
  asRemoteWrites,
  db as defaultDb,
  setLocalChangeListener,
  SYNCED_TABLES,
} from '../db/database.ts';
import { DEVICE_ID_KEY } from '../db/device.ts';
import { STORAGE_NOTE_KEY } from '../db/storage-note.ts';
import { LAST_BACKUP_KEY } from '../db/backup.ts';
import { ORDER_TYPE_KEY } from '../db/settings-repo.ts';
import { OWNER_PIN_KEY } from '../db/owner-pin.ts';
import type { SettingValue } from '../db/types.ts';
import { nowIso } from '../lib/id.ts';
import { normalizeKey } from './key.ts';

export type SyncMode = 'SHOP' | 'VIEWER';

export const SYNC_KEY = 'sync_key';
/** On the shop phone only: the read-only key it hands out to viewers. */
export const SYNC_VIEW_KEY = 'sync_view_key';
export const SYNC_MODE = 'sync_mode';
export const SYNC_CURSOR = 'sync_cursor';
export const SYNC_LAST_SENT = 'sync_last_sent_at';
export const SYNC_LAST_FETCHED = 'sync_last_fetched_at';
export const SYNC_ERROR = 'sync_error';
/**
 * The synced tables this phone knew when it last fetched. A row for a table
 * an older build did not know is skipped — but the cursor moves past it all
 * the same, so after the update it would never come again. When the build
 * knows a table the list does not, the cursor starts over once.
 */
export const SYNC_KNOWN_TABLES = 'sync_known_tables';

/** Settings that belong to this phone, never to the shop: never sent, never taken. */
export const LOCAL_SETTINGS: readonly string[] = [
  DEVICE_ID_KEY,
  STORAGE_NOTE_KEY,
  LAST_BACKUP_KEY,
  ORDER_TYPE_KEY,
  // The owner's own phone, view-only, sees everything without it.
  OWNER_PIN_KEY,
  SYNC_KEY,
  SYNC_VIEW_KEY,
  SYNC_MODE,
  SYNC_CURSOR,
  SYNC_LAST_SENT,
  SYNC_LAST_FETCHED,
  SYNC_ERROR,
  SYNC_KNOWN_TABLES,
];

/** Rows per request: well under the server's 500, and the free plan's limits. */
const BATCH = 400;
/** How long after the last change the send goes. One-shot, reset by each change. */
export const SEND_DELAY_MS = 15_000;
const TIMEOUT_MS = 20_000;

export interface SyncState {
  mode: SyncMode | null;
  /** The key this device holds: the shop key on the shop phone, the view key elsewhere. */
  key: string | null;
  /** Shop phone only: the read-only key to share. */
  viewKey: string | null;
  lastSent: string | null;
  lastFetched: string | null;
  error: string | null;
}

type Fetch = typeof fetch;

async function setting(db: RuduPosDB, key: string): Promise<SettingValue | undefined> {
  return (await db.setting.get(key))?.value;
}

/** This phone's own bookkeeping, written without counting as a change to send. */
async function remember(db: RuduPosDB, values: Record<string, SettingValue>): Promise<void> {
  await asRemoteWrites(() =>
    db.transaction('rw', db.setting, async () => {
      for (const [key, value] of Object.entries(values)) {
        await db.setting.put({ key, value, synced_at: null });
      }
    }),
  );
}

export async function loadSyncState(db: RuduPosDB = defaultDb): Promise<SyncState> {
  const text = async (key: string) => {
    const value = await setting(db, key);
    return typeof value === 'string' ? value : null;
  };
  const mode = await text(SYNC_MODE);
  return {
    mode: mode === 'SHOP' || mode === 'VIEWER' ? mode : null,
    key: await text(SYNC_KEY),
    viewKey: await text(SYNC_VIEW_KEY),
    lastSent: await text(SYNC_LAST_SENT),
    lastFetched: await text(SYNC_LAST_FETCHED),
    error: await text(SYNC_ERROR),
  };
}

/** How many rows are waiting to be sent. Indexed, so cheap enough to show live. */
export async function pendingCount(db: RuduPosDB = defaultDb): Promise<number> {
  let total = 0;
  for (const name of SYNCED_TABLES) {
    if (name === 'setting') {
      const dirty = await db.setting.where('sync_dirty').equals(1).toArray();
      total += dirty.filter((row) => !LOCAL_SETTINGS.includes(row.key)).length;
    } else {
      total += await db.table(name).where('sync_dirty').equals(1).count();
    }
  }
  return total;
}

function request(fetchImpl: Fetch, path: string, key: string | null, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (key) headers['authorization'] = `Bearer ${key}`;
  const signal =
    typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(TIMEOUT_MS)
      : undefined;
  return fetchImpl(`/api/sync/${path}`, { ...init, headers, ...(signal ? { signal } : {}) });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A row as it goes to the cloud: without this phone's bookkeeping. */
function outgoing(row: Record<string, unknown>): Record<string, unknown> {
  const { sync_dirty: _dirty, ...rest } = row;
  void _dirty;
  return rest;
}

let sending: Promise<number> | null = null;

/**
 * Send every row that changed. One at a time: a second call while a send is
 * on its way joins it rather than sending the same rows twice. A row that
 * changed again while it was in the air stays marked, and goes next time.
 */
export function sendChanges(
  db: RuduPosDB = defaultDb,
  fetchImpl: Fetch = fetch,
  now: () => string = nowIso,
): Promise<number> {
  sending ??= (async () => {
    try {
      const state = await loadSyncState(db);
      if (state.mode !== 'SHOP' || !state.key) return 0;
      const deviceId = String((await setting(db, DEVICE_ID_KEY)) ?? 'unknown');
      let sent = 0;
      for (let round = 0; round < 1_000; round++) {
        const batch = await collect(db, BATCH);
        if (batch.length === 0) break;
        const response = await request(fetchImpl, 'push', state.key, {
          method: 'POST',
          body: JSON.stringify({
            deviceId,
            rows: batch.map((entry) => ({
              tbl: entry.table,
              id: String(entry.id),
              data: outgoing(entry.row),
            })),
          }),
        });
        if (!response.ok) throw new Error(`ส่งไม่สำเร็จ (${response.status})`);
        await markSent(db, batch, now());
        sent += batch.length;
      }
      await remember(db, { [SYNC_LAST_SENT]: now(), [SYNC_ERROR]: null });
      return sent;
    } catch (cause) {
      await remember(db, { [SYNC_ERROR]: describe(cause) });
      return 0;
    } finally {
      sending = null;
    }
  })();
  return sending;
}

interface Pending {
  table: SyncedTable;
  id: unknown;
  rev: number | undefined;
  row: Record<string, unknown>;
}

async function collect(db: RuduPosDB, limit: number): Promise<Pending[]> {
  const out: Pending[] = [];
  for (const name of SYNCED_TABLES) {
    if (out.length >= limit) break;
    const table = db.table(name);
    const key = table.schema.primKey.keyPath as string;
    const rows = (await table
      .where('sync_dirty')
      .equals(1)
      .limit(limit - out.length)
      .toArray()) as Record<string, unknown>[];
    for (const row of rows) {
      if (name === 'setting' && LOCAL_SETTINGS.includes(String(row[key]))) {
        // This phone's own: never sent. Unmark it so it is not read again.
        await asRemoteWrites(() => table.update(row[key] as string, { sync_dirty: undefined }));
        continue;
      }
      out.push({ table: name, id: row[key], rev: row['sync_rev'] as number | undefined, row });
    }
  }
  return out;
}

async function markSent(db: RuduPosDB, batch: readonly Pending[], at: string): Promise<void> {
  await db.transaction(
    'rw',
    [...new Set(batch.map((entry) => db.table(entry.table)))],
    async () => {
      for (const entry of batch) {
        const table = db.table(entry.table);
        const current = (await table.get(entry.id as string)) as { sync_rev?: number } | undefined;
        // Changed again while it was being sent: leave it marked for next time.
        if (!current || current.sync_rev !== entry.rev) continue;
        await table.update(entry.id as string, { sync_dirty: undefined, synced_at: at });
      }
    },
  );
}

let fetching: Promise<number> | null = null;

/**
 * Take everything the cloud has that this device has not seen, page by page.
 * Written as rows from the cloud — never marked as changes to send back.
 */
export function fetchChanges(
  db: RuduPosDB = defaultDb,
  fetchImpl: Fetch = fetch,
  now: () => string = nowIso,
): Promise<number> {
  fetching ??= (async () => {
    try {
      const state = await loadSyncState(db);
      if (!state.key) return 0;
      const stored = await setting(db, SYNC_CURSOR);
      let cursor = (typeof stored === 'string' ? JSON.parse(stored) : null) as {
        seq: number;
        tbl: string;
        id: string;
      } | null;
      // A table new to this build may have rows the cursor already went past
      // under an older one: take everything again, once. Rows are written by
      // id, so taking one twice changes nothing.
      const known = await setting(db, SYNC_KNOWN_TABLES);
      const knownList = Array.isArray(known) ? known.map(String) : [];
      if (SYNCED_TABLES.some((table) => !knownList.includes(table))) {
        cursor = null;
        await remember(db, { [SYNC_KNOWN_TABLES]: [...SYNCED_TABLES], [SYNC_CURSOR]: null });
      }
      cursor ??= { seq: 0, tbl: '', id: '' };
      let taken = 0;
      for (let page = 0; page < 10_000; page++) {
        const query = new URLSearchParams({
          seq: String(cursor.seq),
          tbl: cursor.tbl,
          id: cursor.id,
        });
        const response = await request(fetchImpl, `pull?${query}`, state.key);
        if (!response.ok) throw new Error(`รับข้อมูลไม่สำเร็จ (${response.status})`);
        const body = (await response.json()) as {
          rows: { tbl: string; id: string; data: Record<string, unknown> }[];
          cursor: { seq: number; tbl: string; id: string };
          more: boolean;
        };
        await apply(db, body.rows);
        cursor = body.cursor;
        taken += body.rows.length;
        await remember(db, { [SYNC_CURSOR]: JSON.stringify(cursor) });
        if (!body.more) break;
      }
      await remember(db, { [SYNC_LAST_FETCHED]: now(), [SYNC_ERROR]: null });
      return taken;
    } catch (cause) {
      await remember(db, { [SYNC_ERROR]: describe(cause) });
      return 0;
    } finally {
      fetching = null;
    }
  })();
  return fetching;
}

async function apply(
  db: RuduPosDB,
  rows: readonly { tbl: string; id: string; data: Record<string, unknown> }[],
): Promise<void> {
  const byTable = new Map<SyncedTable, Record<string, unknown>[]>();
  for (const row of rows) {
    if (!(SYNCED_TABLES as readonly string[]).includes(row.tbl)) continue;
    const table = row.tbl as SyncedTable;
    if (table === 'setting' && LOCAL_SETTINGS.includes(String(row.data['key']))) continue;
    const list = byTable.get(table) ?? [];
    list.push(outgoing(row.data));
    byTable.set(table, list);
  }
  if (byTable.size === 0) return;
  await asRemoteWrites(() =>
    db.transaction(
      'rw',
      [...byTable.keys()].map((name) => db.table(name)),
      async () => {
        for (const [name, list] of byTable) await db.table(name).bulkPut(list);
      },
    ),
  );
}

// ------------------------------------------------------------ pairing

export type SetupResult =
  'ok' | 'exists' | 'no-database' | 'no-setup-code' | 'wrong-setup-code' | 'offline';

/**
 * Make this the shop phone, with brand-new keys. Needs the setup password the
 * owner put in Cloudflare. Everything on the phone goes up.
 */
export async function startAsShop(
  setupCode: string,
  db: RuduPosDB = defaultDb,
  fetchImpl: Fetch = fetch,
): Promise<SetupResult> {
  let response: Response;
  try {
    response = await request(fetchImpl, 'setup', null, {
      method: 'POST',
      headers: { 'x-setup-code': setupCode.trim() },
    });
  } catch {
    return 'offline';
  }
  if (response.status === 409) return 'exists';
  if (response.status === 401) return 'wrong-setup-code';
  if (response.status === 503) {
    const { error } = (await response.json().catch(() => ({}))) as { error?: string };
    return error === 'no-setup-code' ? 'no-setup-code' : 'no-database';
  }
  if (!response.ok) return 'offline';
  const { key, viewKey } = (await response.json()) as { key: string; viewKey: string };
  await remember(db, { [SYNC_KEY]: key, [SYNC_VIEW_KEY]: viewKey, [SYNC_MODE]: 'SHOP' });
  void sendChanges(db, fetchImpl);
  return 'ok';
}

export type JoinResult = 'ok' | 'bad-key' | 'wrong-key' | 'view-key' | 'has-sales' | 'offline';

/**
 * Join with the shop's key: as a view-only device, or as the shop phone on a
 * new phone — which takes everything the cloud has first, and is refused on a
 * phone that already has sales of its own, rather than mixing two shops.
 */
export async function joinWithKey(
  input: string,
  mode: SyncMode,
  db: RuduPosDB = defaultDb,
  fetchImpl: Fetch = fetch,
): Promise<JoinResult> {
  const key = normalizeKey(input);
  if (!key) return 'bad-key';
  if (mode === 'SHOP' && (await db.sale.count()) > 0) return 'has-sales';
  let response: Response;
  try {
    response = await request(fetchImpl, 'check', key);
  } catch {
    return 'offline';
  }
  if (response.status === 401) return 'wrong-key';
  if (!response.ok) return 'offline';
  const { role, viewKey } = (await response.json()) as {
    role: 'shop' | 'viewer';
    viewKey?: string;
  };
  // Taking over as the shop phone needs the shop key: the view key only reads.
  if (mode === 'SHOP' && role !== 'shop') return 'view-key';

  await remember(db, {
    [SYNC_KEY]: key,
    [SYNC_VIEW_KEY]: mode === 'SHOP' ? (viewKey ?? null) : null,
    [SYNC_MODE]: mode,
    [SYNC_CURSOR]: null,
  });
  await fetchChanges(db, fetchImpl);
  if (mode === 'SHOP') {
    // What this phone made before joining (its own seed) is the cloud's now.
    for (const name of SYNCED_TABLES) {
      const table = db.table(name);
      await asRemoteWrites(() =>
        table.where('sync_dirty').equals(1).modify({ sync_dirty: undefined }),
      );
    }
  }
  return 'ok';
}

/** A new key for the shop. Every view-only device has to pair again. */
export async function rotateKey(
  db: RuduPosDB = defaultDb,
  fetchImpl: Fetch = fetch,
): Promise<boolean> {
  const state = await loadSyncState(db);
  if (state.mode !== 'SHOP' || !state.key) return false;
  try {
    const response = await request(fetchImpl, 'rotate', state.key, { method: 'POST' });
    if (!response.ok) return false;
    const { key, viewKey } = (await response.json()) as { key: string; viewKey: string };
    await remember(db, { [SYNC_KEY]: key, [SYNC_VIEW_KEY]: viewKey });
    return true;
  } catch {
    return false;
  }
}

/** Stop syncing on this device. The cloud keeps its copy. */
export async function stopSync(db: RuduPosDB = defaultDb): Promise<void> {
  await remember(db, {
    [SYNC_KEY]: null,
    [SYNC_VIEW_KEY]: null,
    [SYNC_MODE]: null,
    [SYNC_CURSOR]: null,
    [SYNC_ERROR]: null,
  });
}

// ------------------------------------------------------------ triggers

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Wire the triggers once, at launch. Nothing here runs on a loop: a change
 * arms one send a little later (re-armed by the next change), and opening
 * the app or getting signal back does one round.
 */
export function startSync(db: RuduPosDB = defaultDb, fetchImpl: Fetch = fetch): void {
  const round = () => {
    void loadSyncState(db).then((state) => {
      if (state.mode === 'SHOP') void sendChanges(db, fetchImpl);
      if (state.mode === 'VIEWER') void fetchChanges(db, fetchImpl);
    });
  };

  setLocalChangeListener(() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (typeof navigator === 'undefined' || navigator.onLine) void sendChanges(db, fetchImpl);
    }, SEND_DELAY_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') round();
  });
  window.addEventListener('online', round);
  round();
}
