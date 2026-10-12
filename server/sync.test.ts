// @vitest-environment node
/**
 * The sync server against real SQLite — Node's own, behind the same small
 * interface as Cloudflare's D1 binding — so the SQL that runs in the cloud is
 * the SQL that is tested here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  handleCheck,
  handlePull,
  handlePush,
  handleRotate,
  handleSetup,
  resetSchemaCache,
  type Env,
} from './sync.ts';
import { memoryD1 } from '../src/test/d1-sqlite.ts';

let env: Env;
beforeEach(async () => {
  resetSchemaCache();
  env = { DB: await memoryD1() };
});

const call = (path: string, key: string | null, init: RequestInit = {}) =>
  new Request(`https://rudu-pos.pages.dev/api/sync/${path}`, {
    ...init,
    headers: key ? { authorization: `Bearer ${key}` } : {},
  });

async function keys(): Promise<{ key: string; viewKey: string }> {
  return (await (await handleSetup(env)).json()) as { key: string; viewKey: string };
}

async function setup(): Promise<string> {
  return (await keys()).key;
}

async function push(key: string, rows: { tbl: string; id: string; data: unknown }[]) {
  return handlePush(
    env,
    call('push', key, { method: 'POST', body: JSON.stringify({ deviceId: 'shop', rows }) }),
  );
}

async function pull(key: string, cursor = { seq: 0, tbl: '', id: '' }) {
  const query = new URLSearchParams({ seq: String(cursor.seq), tbl: cursor.tbl, id: cursor.id });
  const response = await handlePull(env, call(`pull?${query}`, key));
  return (await response.json()) as {
    rows: { tbl: string; id: string; data: Record<string, unknown> }[];
    cursor: { seq: number; tbl: string; id: string };
    more: boolean;
  };
}

describe('the key', () => {
  it('is made once, and only once', async () => {
    const key = await setup();
    expect(key).toMatch(/^[A-HJ-NP-Z2-9]{20}$/);
    expect((await handleSetup(env)).status).toBe(409);
  });

  it('opens the door, and nothing else does', async () => {
    const key = await setup();
    expect((await handleCheck(env, call('check', key))).status).toBe(200);
    expect((await handleCheck(env, call('check', 'K7QM2XRPH9TDW4NC8FJV'))).status).toBe(401);
    expect((await handleCheck(env, call('check', null))).status).toBe(401);
    expect((await push('K7QM2XRPH9TDW4NC8FJV', [])).status).toBe(401);
  });

  it('can be replaced, and the old one stops working', async () => {
    const old = await setup();
    const fresh = (
      (await (await handleRotate(env, call('rotate', old, { method: 'POST' }))).json()) as {
        key: string;
      }
    ).key;
    expect((await handleCheck(env, call('check', old))).status).toBe(401);
    expect((await handleCheck(env, call('check', fresh))).status).toBe(200);
  });

  it('says so plainly when the database is not linked yet', async () => {
    expect((await handleSetup({})).status).toBe(503);
  });
});

describe('the view key', () => {
  it('reads, and only reads — the server refuses it anything that writes', async () => {
    const { key, viewKey } = await keys();
    expect(viewKey).not.toBe(key);
    await push(key, [{ tbl: 'sale', id: 'S1', data: { id: 'S1' } }]);

    const check = (await (await handleCheck(env, call('check', viewKey))).json()) as Record<
      string,
      unknown
    >;
    expect(check).toMatchObject({ ok: true, role: 'viewer' });
    expect(check['viewKey']).toBeUndefined();
    expect((await pull(viewKey)).rows).toHaveLength(1);

    expect(
      (await push(viewKey, [{ tbl: 'sale', id: 'S1', data: { id: 'S1', total_net: 0 } }])).status,
    ).toBe(403);
    expect((await handleRotate(env, call('rotate', viewKey, { method: 'POST' }))).status).toBe(403);
    expect((await pull(key)).rows[0]?.data).toEqual({ id: 'S1' });
  });

  it('is handed back to the shop key, and replaced along with it', async () => {
    const { key, viewKey } = await keys();
    const check = (await (await handleCheck(env, call('check', key))).json()) as Record<
      string,
      unknown
    >;
    expect(check).toMatchObject({ role: 'shop', viewKey });

    const fresh = (await (
      await handleRotate(env, call('rotate', key, { method: 'POST' }))
    ).json()) as {
      key: string;
      viewKey: string;
    };
    expect((await handleCheck(env, call('check', viewKey))).status).toBe(401);
    expect((await handleCheck(env, call('check', fresh.viewKey))).status).toBe(200);
  });
});

describe('push and pull', () => {
  it('hands back what was stored, and a changed row comes round again, once, with its new value', async () => {
    const key = await setup();
    await push(key, [
      { tbl: 'sale', id: 'S1', data: { id: 'S1', total_net: 4000 } },
      { tbl: 'sale_line', id: 'L1', data: { id: 'L1', qty: 1 } },
    ]);
    const first = await pull(key);
    // In arrival order, then by table: `sale` sorts before `sale_line`.
    expect(first.rows.map((r) => r.id)).toEqual(['S1', 'L1']);
    expect(first.more).toBe(false);

    // The sale is voided on the phone: the same row again, later.
    await push(key, [
      { tbl: 'sale', id: 'S1', data: { id: 'S1', total_net: 4000, is_voided: true } },
    ]);
    const next = await pull(key, first.cursor);
    expect(next.rows).toEqual([
      { tbl: 'sale', id: 'S1', data: { id: 'S1', total_net: 4000, is_voided: true } },
    ]);
    expect((await pull(key, next.cursor)).rows).toEqual([]);
  });

  it('pages through more rows than fit in one reply without skipping or repeating any', async () => {
    const key = await setup();
    for (let batch = 0; batch < 3; batch++) {
      await push(
        key,
        Array.from({ length: 500 }, (_, i) => ({
          tbl: 'stock_movement',
          id: `M${batch}-${String(i).padStart(3, '0')}`,
          data: { i },
        })),
      );
    }
    const seen: string[] = [];
    let cursor = { seq: 0, tbl: '', id: '' };
    for (;;) {
      const page = await pull(key, cursor);
      seen.push(...page.rows.map((r) => r.id));
      cursor = page.cursor;
      if (!page.more) break;
    }
    expect(seen).toHaveLength(1500);
    expect(new Set(seen).size).toBe(1500);
  });

  it('refuses a batch that is too big or is not a batch', async () => {
    const key = await setup();
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ tbl: 't', id: String(i), data: {} }));
    expect((await push(key, tooMany)).status).toBe(400);
    const bad = await handlePush(env, call('push', key, { method: 'POST', body: '{not json' }));
    expect(bad.status).toBe(400);
  });
});
