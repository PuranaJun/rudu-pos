/**
 * Backup and restore (CLAUDE.md §13).
 *
 * This phone holds the only copy of the business's records, and iOS can still
 * evict a web app's storage. A backup is every row of every table, as JSON,
 * read in one transaction so it is a single consistent moment — never half a
 * sale. A restore replaces the whole database in one transaction, so a phone
 * that dies halfway through keeps what it had rather than half of each.
 */
import type { RuduPosDB } from './database.ts';
import { asRemoteWrites, db as defaultDb, SYNCED_TABLES } from './database.ts';
import { DEVICE_ID_KEY } from './device.ts';
import { STORAGE_NOTE_KEY } from './storage-note.ts';
import { ensureSeeded } from './seed.ts';
import { loadCostCatalog } from './catalog.ts';
import type { Sale, SaleLine } from './types.ts';
import { salesCsv, salesCsvFilename } from '../domain/sales-csv.ts';
import { legacySalePatches } from '../domain/queue.ts';
import { bangkokDate } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';

export const BACKUP_FORMAT = 'rudu-pos-backup';
export const LAST_BACKUP_KEY = 'last_backup_at';

/**
 * Settings that belong to this phone rather than to the business. A restore
 * onto a new phone keeps the new phone's own — otherwise its sales would be
 * signed with the old phone's id.
 */
const DEVICE_SETTINGS = [DEVICE_ID_KEY, STORAGE_NOTE_KEY];

/**
 * Sync settings — the shop key among them — never go into a backup file. A
 * backup travels through LINE and iCloud; the shop key would let whoever
 * holds the file write to the shop's cloud records. They belong to the phone.
 */
function isSyncSetting(key: string): boolean {
  return key.startsWith('sync_');
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  /** The database schema version it was taken from. */
  schema_version: number;
  exported_at: string;
  tables: Record<string, unknown[]>;
}

/** A backup the app will not restore, with the reason in Thai for the screen. */
export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

/** Every row of every table, as one consistent moment. */
export async function exportBackup(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<BackupFile> {
  return db.transaction('r', db.tables, async () => {
    const tables: Record<string, unknown[]> = {};
    for (const table of db.tables) {
      const rows = await table.toArray();
      tables[table.name] =
        table.name === 'setting'
          ? (rows as { key: string }[]).filter((row) => !isSyncSetting(row.key))
          : rows;
    }
    return { format: BACKUP_FORMAT, schema_version: db.verno, exported_at: now, tables };
  });
}

/** `rudu-backup-2026-09-25.json`, dated in Bangkok. */
export function backupFilename(now: string): string {
  return `rudu-backup-${bangkokDate(now)}.json`;
}

/** The backup as a file, ready to hand to the share sheet. */
export async function backupAsFile(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<File> {
  const backup = await exportBackup(db, now);
  return new File([JSON.stringify(backup)], backupFilename(now), { type: 'application/json' });
}

const STALE_AFTER_MS = 2 * 86_400_000;

/**
 * True when the last backup is old enough to nag about — or there has never
 * been one. A day's missed backup is normal; two is how records get lost.
 */
export function backupIsStale(lastBackupAt: string | null, nowMs: number): boolean {
  return lastBackupAt === null || nowMs - Date.parse(lastBackupAt) > STALE_AFTER_MS;
}

/** Remember that a backup left the phone, to show when the last one was. */
export async function markBackedUp(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<void> {
  await db.setting.put({ key: LAST_BACKUP_KEY, value: now, synced_at: null });
}

/**
 * Read a backup file and check it is one, before anything is touched. Every
 * failure says what is wrong in words the operator can act on.
 */
export function parseBackup(text: string, db: RuduPosDB = defaultDb): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูล หรือไฟล์เสีย');
  }

  if (!isRecord(data) || data['format'] !== BACKUP_FORMAT || !isRecord(data['tables'])) {
    throw new BackupError('ไฟล์นี้ไม่ใช่ไฟล์สำรองข้อมูลของฤดูชา');
  }
  if (typeof data['schema_version'] !== 'number' || typeof data['exported_at'] !== 'string') {
    throw new BackupError('ไฟล์สำรองข้อมูลไม่ครบ');
  }
  if (data['schema_version'] > db.verno) {
    // Restoring it here would silently drop whatever the newer app added.
    throw new BackupError('ไฟล์นี้มาจากแอปเวอร์ชันใหม่กว่า — อัปเดตแอปก่อนแล้วค่อยกู้คืน');
  }

  const known = new Map(db.tables.map((table) => [table.name, table]));
  for (const [name, rows] of Object.entries(data['tables'])) {
    const table = known.get(name);
    if (!table) throw new BackupError(`ไฟล์สำรองข้อมูลมีตารางที่ไม่รู้จัก: ${name}`);
    const key = table.schema.primKey.keyPath;
    if (
      !Array.isArray(rows) ||
      rows.some((row) => !isRecord(row) || typeof key !== 'string' || row[key] === undefined)
    ) {
      throw new BackupError(`ข้อมูลในตาราง ${name} เสีย`);
    }
  }

  return data as unknown as BackupFile;
}

export interface BackupSummary {
  exportedAt: string;
  sales: number;
  days: number;
  batches: number;
}

/** What a backup holds, for the confirmation before it replaces anything. */
export function describeBackup(backup: BackupFile): BackupSummary {
  const count = (name: string) => backup.tables[name]?.length ?? 0;
  return {
    exportedAt: backup.exported_at,
    sales: count('sale'),
    days: count('cash_session'),
    batches: count('component_batch'),
  };
}

/**
 * Replace everything on this phone with a backup. One transaction: it all
 * lands or none of it does. This phone's own device settings are kept, and an
 * older backup's catalog is brought up to the current shape afterwards, the
 * same way an old install would be.
 */
export async function restoreBackup(backup: BackupFile, db: RuduPosDB = defaultDb): Promise<void> {
  // Rows go back exactly as they were saved — sync flags included — rather
  // than as fresh changes, which would push last week's version of a row over
  // the cloud's newer one.
  await asRemoteWrites(() =>
    db.transaction('rw', db.tables, async () => {
      const keep = (await db.setting.toArray()).filter(
        (row) => DEVICE_SETTINGS.includes(row.key) || isSyncSetting(row.key),
      );

      for (const table of db.tables) {
        await table.clear();
        const incoming = backup.tables[table.name];
        // A file from before sync keys were left out may still carry one: it
        // belongs to the phone that made the file, never to this one.
        const rows =
          table.name === 'setting'
            ? incoming?.filter((row) => !isSyncSetting(String((row as { key?: unknown }).key)))
            : incoming;
        if (!rows || rows.length === 0) continue;
        // A backup from before sync existed has never been sent anywhere.
        const synced = (SYNCED_TABLES as readonly string[]).includes(table.name);
        await table.bulkAdd(
          (synced
            ? rows.map((row) =>
                (row as { sync_rev?: number }).sync_rev === undefined
                  ? { ...(row as object), sync_dirty: 1, sync_rev: 1 }
                  : row,
              )
            : rows) as never[],
        );
      }

      for (const row of keep) await db.setting.put(row);

      // A backup from before order numbers: shaped the way the upgrade shapes
      // an old install.
      for (const patch of legacySalePatches(await db.sale.toArray())) {
        await db.sale.update(patch.id, patch.changes);
      }
    }),
  );

  await ensureSeeded(db);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ------------------------------------------------------------------ sales CSV

/** Every year there are sales in, newest first, and always the current one. */
export async function loadSalesYears(
  db: RuduPosDB = defaultDb,
  now: string = nowIso(),
): Promise<string[]> {
  const dates = (await db.sale.orderBy('business_date').uniqueKeys()) as string[];
  const years = new Set(dates.map((date) => date.slice(0, 4)));
  years.add(bangkokDate(now).slice(0, 4));
  return [...years].sort().reverse();
}

/** A year's sales, and their lines, for the filing figures and the CSV. */
export async function loadSalesForYear(
  year: string,
  db: RuduPosDB = defaultDb,
): Promise<{ sales: Sale[]; lines: SaleLine[] }> {
  const sales = await db.sale
    .where('business_date')
    .between(`${year}-01-01`, `${year}-12-31`, true, true)
    .toArray();
  const lines = await db.sale_line
    .where('sale_id')
    .anyOf(sales.map((sale) => sale.id))
    .toArray();
  return { sales, lines };
}

/** The year's sales as a CSV file, ready for the share sheet. */
export async function salesCsvFile(year: string, db: RuduPosDB = defaultDb): Promise<File> {
  const [{ sales, lines }, catalog] = await Promise.all([
    loadSalesForYear(year, db),
    loadCostCatalog(db),
  ]);
  return new File([salesCsv(catalog, sales, lines, year)], salesCsvFilename(year), {
    type: 'text/csv',
  });
}
