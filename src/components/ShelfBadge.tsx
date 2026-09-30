import { bangkokShort } from '../lib/datetime.ts';
import type { ShelfStatus } from '../domain/open-day.ts';

const SHELF_STYLE: Record<ShelfStatus, string> = {
  EXPIRED: 'bg-expired text-white',
  TODAY: 'bg-today text-ink',
  OK: 'bg-paper-sunk text-ink',
};

/**
 * Shelf life as a filled block, not a tinted word: tinted text disappears in
 * direct sun. Red once gone, amber on its last day, a quiet grey block while
 * it is fine. Filled and edgeless whatever the state: a label, never mistaken
 * for a button beside the ones that are.
 */
export default function ShelfBadge({
  status,
  expiresAt,
}: {
  status: ShelfStatus;
  expiresAt: string;
}) {
  const label = {
    EXPIRED: `หมดอายุแล้ว ${bangkokShort(expiresAt)}`,
    TODAY: `หมดอายุวันนี้ ${bangkokShort(expiresAt)}`,
    OK: `ถึง ${bangkokShort(expiresAt)}`,
  }[status];

  return (
    <span className={`rounded-lg px-3 py-1 text-base font-bold ${SHELF_STYLE[status]}`}>
      {label}
    </span>
  );
}
