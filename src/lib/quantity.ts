import type { Unit } from '../db/types.ts';

const UNIT_TH: Record<Unit, string> = { ML: 'ml', G: 'g', PC: 'ชิ้น' };

/** A component quantity for display: `3,875 ml`. Whole units only. */
export function formatQty(qty: number, unit: Unit): string {
  return `${Math.round(qty).toLocaleString('th-TH')} ${UNIT_TH[unit]}`;
}

export function unitLabel(unit: Unit): string {
  return UNIT_TH[unit];
}
