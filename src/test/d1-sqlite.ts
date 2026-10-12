/**
 * Cloudflare's D1 binding, played by Node's own SQLite in memory, so the sync
 * server's real SQL runs under test. Imported by name at run time: the app's
 * type-check knows nothing of Node, and does not need to.
 */
import type { D1Like, D1StatementLike } from '../../server/sync.ts';

interface SqliteStatement {
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
  run(...values: unknown[]): unknown;
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
}

export async function memoryD1(): Promise<D1Like> {
  const moduleName = 'node:sqlite';
  const { DatabaseSync } = (await import(/* @vite-ignore */ moduleName)) as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const db = new DatabaseSync(':memory:');

  type Statement = D1StatementLike & { sql: string; args: unknown[] };
  const statement = (sql: string, args: unknown[] = []): Statement => ({
    sql,
    args,
    bind: (...values: unknown[]) => statement(sql, values),
    first: async <T>() => (db.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T>() => ({ results: db.prepare(sql).all(...args) as T[] }),
    run: async () => db.prepare(sql).run(...args),
  });

  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        const results = (statements as Statement[]).map((s) => db.prepare(s.sql).run(...s.args));
        db.exec('COMMIT');
        return results;
      } catch (cause) {
        db.exec('ROLLBACK');
        throw cause;
      }
    },
  };
}
