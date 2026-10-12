/**
 * The sync server (CLAUDE.md §8): a Cloudflare Pages Function in front of one
 * D1 database. Deliberately dumb — it stores every row the shop phone sends
 * as JSON under (table, id), last write wins, and hands them back in the
 * order they arrived. It knows nothing about sales or stock, so a new table
 * in the app needs no change here.
 *
 * Two keys, and the server — not the app's screens — tells them apart:
 * - the **shop key** stays on the shop phone. It sends, fetches and changes
 *   the keys. Never stored: only its SHA-256.
 * - the **view key** is the one shared with other devices. It can only fetch.
 *   Kept as it is, because a replacement shop phone has to be able to read it
 *   back to share again — and it opens nothing that writes.
 * Every call but the very first `setup` must carry one or the other.
 *
 * Kept to a handful of queries a request: the free plan allows 50.
 */
import { generateKey, hashKey, normalizeKey } from '../src/sync/key.ts';

/** The part of Cloudflare's D1 binding used here — and all a test double needs. */
export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<unknown[]>;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Env {
  DB?: D1Like;
  /**
   * A password the owner sets privately in the Cloudflare dashboard. Without
   * it, whoever reached /setup first after the database was linked would hold
   * the shop's keys.
   */
  SYNC_SETUP_CODE?: string;
}

/** What one push may carry. The app sends less, in several requests. */
export const MAX_ROWS = 500;
const MAX_BODY = 1_500_000;
const PULL_LIMIT = 1_000;

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS records (
     tbl TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
     seq INTEGER NOT NULL, device_id TEXT, PRIMARY KEY (tbl, id))`,
  'CREATE INDEX IF NOT EXISTS records_seq ON records (seq, tbl, id)',
  "INSERT OR IGNORE INTO meta (k, v) VALUES ('seq', '0')",
];

let schemaReady: WeakSet<object> = new WeakSet();

/** For tests: forget which databases already have their tables. */
export function resetSchemaCache(): void {
  schemaReady = new WeakSet();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

async function database(env: Env): Promise<D1Like | Response> {
  const db = env.DB;
  if (!db) return json({ error: 'no-database' }, 503);
  if (!schemaReady.has(db)) {
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
    schemaReady.add(db);
  }
  return db;
}

type Role = 'shop' | 'viewer';

/** Which key the request carries, if either. */
async function roleOf(db: D1Like, request: Request): Promise<Role | null> {
  const header = request.headers.get('authorization') ?? '';
  const key = normalizeKey(header.replace(/^Bearer\s+/i, ''));
  if (!key) return null;
  const { results } = await db
    .prepare("SELECT k, v FROM meta WHERE k IN ('key_hash', 'view_key')")
    .all<{ k: string; v: string }>();
  const stored = new Map(results.map((row) => [row.k, row.v]));
  if (stored.get('key_hash') === (await hashKey(key))) return 'shop';
  if (stored.get('view_key') === key) return 'viewer';
  return null;
}

/** Null when allowed; otherwise the response that says why not. */
async function refuse(db: D1Like, request: Request, need: Role): Promise<Response | null> {
  const role = await roleOf(db, request);
  if (role === null) return json({ error: 'key' }, 401);
  if (need === 'shop' && role !== 'shop') return json({ error: 'read-only' }, 403);
  return null;
}

/**
 * First time only: make the shop key and the view key. Needs the setup
 * password the owner put in Cloudflare; refused once the keys exist.
 */
export async function handleSetup(env: Env, request: Request): Promise<Response> {
  const db = await database(env);
  if (db instanceof Response) return db;
  const expected = env.SYNC_SETUP_CODE?.trim() ?? '';
  if (expected === '') return json({ error: 'no-setup-code' }, 503);
  const given = (request.headers.get('x-setup-code') ?? '').trim();
  // Compared as hashes, so the time taken says nothing about the password.
  if ((await hashKey(given)) !== (await hashKey(expected))) {
    return json({ error: 'setup-code' }, 401);
  }

  const key = generateKey();
  const viewKey = generateKey();
  const hash = await hashKey(key);
  await db
    .prepare("INSERT INTO meta (k, v) VALUES ('key_hash', ?1) ON CONFLICT (k) DO NOTHING")
    .bind(hash)
    .run();
  // Two phones pressing at once: only the one whose hash landed gets the keys.
  const stored = await db.prepare("SELECT v FROM meta WHERE k = 'key_hash'").first<{ v: string }>();
  if (stored?.v !== hash) return json({ error: 'exists' }, 409);
  await db
    .prepare("INSERT INTO meta (k, v) VALUES ('view_key', ?1) ON CONFLICT (k) DO UPDATE SET v = ?1")
    .bind(viewKey)
    .run();
  return json({ key, viewKey });
}

/**
 * Which key is this, and how much is in the cloud. The shop key also gets the
 * view key back, so a replacement shop phone can share it again.
 */
export async function handleCheck(env: Env, request: Request): Promise<Response> {
  const db = await database(env);
  if (db instanceof Response) return db;
  const role = await roleOf(db, request);
  if (role === null) return json({ error: 'key' }, 401);
  const count = await db.prepare('SELECT COUNT(*) AS n FROM records').first<{ n: number }>();
  const view =
    role === 'shop'
      ? await db.prepare("SELECT v FROM meta WHERE k = 'view_key'").first<{ v: string }>()
      : null;
  return json({
    ok: true,
    role,
    records: count?.n ?? 0,
    ...(view ? { viewKey: view.v } : {}),
  });
}

/**
 * New keys, both of them, for when a phone that had one is lost. Shop key
 * only. Every viewer pairs again with the new view key.
 */
export async function handleRotate(env: Env, request: Request): Promise<Response> {
  const db = await database(env);
  if (db instanceof Response) return db;
  const refused = await refuse(db, request, 'shop');
  if (refused) return refused;
  const key = generateKey();
  const viewKey = generateKey();
  await db.batch([
    db.prepare("UPDATE meta SET v = ?1 WHERE k = 'key_hash'").bind(await hashKey(key)),
    db
      .prepare(
        "INSERT INTO meta (k, v) VALUES ('view_key', ?1) ON CONFLICT (k) DO UPDATE SET v = ?1",
      )
      .bind(viewKey),
  ]);
  return json({ key, viewKey });
}

interface PushBody {
  deviceId: string;
  rows: { tbl: string; id: string; data: unknown }[];
}

function validPush(body: unknown): body is PushBody {
  if (typeof body !== 'object' || body === null) return false;
  const { deviceId, rows } = body as Record<string, unknown>;
  return (
    typeof deviceId === 'string' &&
    Array.isArray(rows) &&
    rows.length <= MAX_ROWS &&
    rows.every(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as Record<string, unknown>)['tbl'] === 'string' &&
        typeof (row as Record<string, unknown>)['id'] === 'string' &&
        typeof (row as Record<string, unknown>)['data'] === 'object',
    )
  );
}

/**
 * Store a batch of rows. One transaction: the sequence number moves on by one
 * and every row in the batch takes it, so a reader sees all of a batch or
 * none of it. Last write wins per row (CLAUDE.md §8).
 */
export async function handlePush(env: Env, request: Request): Promise<Response> {
  const db = await database(env);
  if (db instanceof Response) return db;
  // Only the shop phone writes. A view key is refused here, by the server --
  // not merely hidden by a viewer's screens.
  const refused = await refuse(db, request, 'shop');
  if (refused) return refused;

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'too-large' }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad-json' }, 400);
  }
  if (!validPush(body)) return json({ error: 'bad-body' }, 400);
  if (body.rows.length === 0) return json({ ok: true, stored: 0 });

  await db.batch([
    db.prepare("UPDATE meta SET v = CAST(v AS INTEGER) + 1 WHERE k = 'seq'"),
    db
      .prepare(
        `INSERT INTO records (tbl, id, data, seq, device_id)
         SELECT json_extract(value, '$.tbl'), json_extract(value, '$.id'),
                json_extract(value, '$.data'),
                (SELECT CAST(v AS INTEGER) FROM meta WHERE k = 'seq'), ?2
         FROM json_each(?1) WHERE true
         ON CONFLICT (tbl, id) DO UPDATE SET
           data = excluded.data, seq = excluded.seq, device_id = excluded.device_id`,
      )
      .bind(JSON.stringify(body.rows), body.deviceId),
  ]);
  return json({ ok: true, stored: body.rows.length });
}

export interface PullCursor {
  seq: number;
  tbl: string;
  id: string;
}

/**
 * Rows after a cursor, in the order they arrived. The cursor is the last row
 * returned — (seq, table, id) — so a batch bigger than a page is never cut
 * in a way that skips or repeats a row.
 */
export async function handlePull(env: Env, request: Request): Promise<Response> {
  const db = await database(env);
  if (db instanceof Response) return db;
  const refused = await refuse(db, request, 'viewer');
  if (refused) return refused;

  const params = new URL(request.url).searchParams;
  const seq = Number(params.get('seq') ?? '0');
  const tbl = params.get('tbl') ?? '';
  const id = params.get('id') ?? '';
  if (!Number.isFinite(seq)) return json({ error: 'bad-cursor' }, 400);

  const { results } = await db
    .prepare(
      `SELECT tbl, id, data, seq FROM records
       WHERE seq > ?1 OR (seq = ?1 AND (tbl > ?2 OR (tbl = ?2 AND id > ?3)))
       ORDER BY seq, tbl, id LIMIT ?4`,
    )
    .bind(seq, tbl, id, PULL_LIMIT)
    .all<{ tbl: string; id: string; data: string; seq: number }>();

  const last = results.at(-1);
  return json({
    rows: results.map((row) => ({
      tbl: row.tbl,
      id: row.id,
      data: JSON.parse(row.data) as unknown,
    })),
    cursor: last ? { seq: last.seq, tbl: last.tbl, id: last.id } : { seq, tbl, id },
    more: results.length === PULL_LIMIT,
  });
}
