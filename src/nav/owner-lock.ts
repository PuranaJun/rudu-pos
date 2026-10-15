/**
 * The owner lock: what the staff cannot see once the owner has set a PIN.
 *
 * Behind it: settings (every cost, recipe and price), reports, purchasing,
 * the backup file, and the cost, profit and waste-in-baht figures on the
 * screens the staff do use — the bills, closing the day and its summary.
 * Selling, the queue, production and counting the drawer never ask.
 *
 * Typing the PIN opens it until the operator goes home (back to selling or
 * to open day), or until the app has been away for over a minute — the phone
 * left unlocked in a pocket is the phone handed back to the staff.
 */
import { useOwnerPin } from '../db/hooks.ts';
import { useNav, type Route } from './nav-store.ts';

/** Screens that are the owner's entirely, by the name the PIN pad opens them with. */
export const OWNER_ROUTES: Readonly<Partial<Record<Route, string>>> = {
  SETTINGS: 'ตั้งค่า',
  REPORTS: 'รายงาน',
  PURCHASING: 'สั่งของ',
};

export interface OwnerLock {
  /** The stored PIN record; null with no PIN, undefined while loading. */
  pin: string | null | undefined;
  /** True only once the phone is known to have a PIN. */
  pinSet: boolean;
  /**
   * Costs and the owner's screens may be shown. False while loading: a cost
   * that flashes up before the lock arrives has still been seen.
   */
  open: boolean;
}

export function useOwnerLock(): OwnerLock {
  const pin = useOwnerPin();
  const unlocked = useNav((state) => state.ownerUnlocked);
  return { pin, pinSet: typeof pin === 'string', open: pin === null || unlocked };
}

const AWAY_MS = 60_000;

/**
 * Lock again when the app comes back after more than a minute away. Listens
 * for the page being hidden and shown — nothing ticks (CLAUDE.md §1). A
 * share sheet or a file picker that briefly hides the page does not lock it.
 */
export function lockWhenAway(doc: Document = document, now: () => number = Date.now): void {
  let hiddenAt: number | null = null;
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden') {
      hiddenAt = now();
      return;
    }
    if (hiddenAt !== null && now() - hiddenAt > AWAY_MS) useNav.getState().lockOwner();
    hiddenAt = null;
  });
}
