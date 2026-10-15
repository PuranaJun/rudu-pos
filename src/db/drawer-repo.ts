/**
 * Cash paid into and out of the drawer (domain/drawer.ts).
 *
 * Never on the sell path. Recorded from เมนู → ลิ้นชัก by whoever is at the
 * till — counting and handling the drawer is never behind the owner's PIN
 * (CLAUDE.md §6.7). A mistake is cancelled, not deleted.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type { CashMovement, CashMovementReason, CashSession } from './types.ts';
import { checkMovement } from '../domain/drawer.ts';
import type { Satang } from '../lib/money.ts';
import { newId, nowIso } from '../lib/id.ts';
import { CatalogError } from './catalog-repo.ts';

export interface NewCashMovement {
  direction: 'IN' | 'OUT';
  amount: Satang | null;
  reason: CashMovementReason;
  note: string;
}

export async function recordCashMovement(
  session: CashSession,
  input: NewCashMovement,
  db: RuduPosDB = defaultDb,
  at: string = nowIso(),
): Promise<CashMovement> {
  const problems = checkMovement(input.amount, input.note.trim());
  if (problems.length > 0) throw new CatalogError(problems);

  return db.transaction('rw', [db.cash_session, db.cash_movement], async () => {
    const current = await db.cash_session.get(session.id);
    if (!current || current.closed_at !== null) throw new CatalogError(['ปิดร้านไปแล้ว']);
    const movement: CashMovement = {
      id: newId(),
      cash_session_id: session.id,
      created_at: at,
      direction: input.direction,
      amount: input.amount!,
      reason: input.reason,
      note: input.note.trim() || null,
      operator_id: session.operator_id,
      voided_at: null,
      synced_at: null,
    };
    await db.cash_movement.add(movement);
    return movement;
  });
}

/** Take back one recorded by mistake, while its day is still open. */
export async function voidCashMovement(
  id: string,
  db: RuduPosDB = defaultDb,
  at: string = nowIso(),
): Promise<void> {
  await db.transaction('rw', [db.cash_session, db.cash_movement], async () => {
    const movement = await db.cash_movement.get(id);
    if (!movement || movement.voided_at !== null) return;
    const session = await db.cash_session.get(movement.cash_session_id);
    if (!session || session.closed_at !== null) throw new CatalogError(['ปิดร้านไปแล้ว']);
    await db.cash_movement.update(id, { voided_at: at });
  });
}

/** Every movement of a session, cancelled ones included. */
export async function sessionMovements(
  sessionId: string,
  db: RuduPosDB = defaultDb,
): Promise<CashMovement[]> {
  return db.cash_movement.where('cash_session_id').equals(sessionId).toArray();
}
