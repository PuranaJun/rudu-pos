/**
 * Cash into and out of the drawer that is not a sale — pure.
 *
 * The drawer has to add up at close (CLAUDE.md §14: variance under ฿20). Ice
 * is bought by the bag every day (§6.6), often with cash from the till; change
 * runs short and is topped up from home; the owner takes money out. Each is a
 * row here, so it is accounted for instead of turning up as variance.
 *
 * Money only. What the cash bought is costed where it is used — ice is part
 * of every cup's packaging cost — so a pay-out never counts as an expense on
 * top of that.
 */
import type { CashMovement, CashMovementReason, CashSession } from '../db/types.ts';
import type { Satang } from '../lib/money.ts';

/** The reasons offered for each direction, most common first. */
export const OUT_REASONS: readonly CashMovementReason[] = ['ICE', 'SUPPLIES', 'OWNER', 'OTHER'];
export const IN_REASONS: readonly CashMovementReason[] = ['CHANGE', 'OWNER', 'OTHER'];

export function reasonTh(reason: CashMovementReason, direction: 'IN' | 'OUT'): string {
  switch (reason) {
    case 'ICE':
      return 'ซื้อน้ำแข็ง';
    case 'SUPPLIES':
      return 'ซื้อของใช้ร้าน';
    case 'CHANGE':
      return 'เติมเงินทอน';
    case 'OWNER':
      return direction === 'OUT' ? 'เจ้าของเอาออก' : 'เจ้าของใส่เพิ่ม';
    case 'OTHER':
      return 'อื่นๆ';
  }
}

/** Amounts offered as one tap, in satang. Anything else is typed. */
export const QUICK_AMOUNTS: readonly Satang[] = [2_000, 4_000, 5_000, 10_000, 50_000];

/** This session's movements that still stand, oldest first. */
export function liveMovements(
  session: CashSession,
  movements: readonly CashMovement[],
): CashMovement[] {
  return movements
    .filter((movement) => movement.cash_session_id === session.id && movement.voided_at === null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export interface DrawerMovementTotals {
  /** Satang put in. */
  paidIn: Satang;
  /** Satang taken out. */
  paidOut: Satang;
}

export function movementTotals(
  session: CashSession,
  movements: readonly CashMovement[],
): DrawerMovementTotals {
  let paidIn = 0;
  let paidOut = 0;
  for (const movement of liveMovements(session, movements)) {
    if (movement.direction === 'IN') paidIn += movement.amount;
    else paidOut += movement.amount;
  }
  return { paidIn, paidOut };
}

/** Why a movement cannot be recorded as typed. Empty: it can. */
export function checkMovement(amount: Satang | null, note: string): string[] {
  const problems: string[] = [];
  if (amount === null || !Number.isInteger(amount) || amount <= 0) {
    problems.push('ใส่จำนวนเงินมากกว่า 0');
  }
  if (note.length > 200) problems.push('หมายเหตุยาวเกินไป');
  return problems;
}
