import { create } from 'zustand';

/**
 * Where the operator is, beyond the home screen.
 *
 * Home is the sell screen while a day is open and the open-day screen when
 * it is not — the session decides that, not this store. Everything else is
 * one screen at a time, opened from the เมนู hub, and its back button goes
 * straight home. There is no stack: a stack is how an app ends up four
 * screens deep with nobody sure which "back" is which.
 *
 * Transient UI state only (CLAUDE.md §13), never persisted: after a crash
 * the app comes back on its home screen, which is the right place to be.
 */
export type Route = 'HUB' | 'SALES' | 'PRODUCTION' | 'REPORTS' | 'SETTINGS' | 'CLOSE_DAY';

interface NavState {
  /** null: the home screen. */
  route: Route | null;
  /** The day just closed, whose summary is showing until the operator leaves it. */
  closedSessionId: string | null;
  open: (route: Route) => void;
  home: () => void;
  dayClosed: (sessionId: string) => void;
  summaryDone: () => void;
}

const INITIAL = { route: null, closedSessionId: null } as const;

export const useNav = create<NavState>()((set) => ({
  ...INITIAL,
  open: (route) => set({ route }),
  home: () => set({ route: null }),
  dayClosed: (sessionId) => set({ route: null, closedSessionId: sessionId }),
  summaryDone: () => set({ closedSessionId: null }),
}));

/** Back to a fresh start — tests, and nothing else. */
export function resetNav(): void {
  useNav.setState(INITIAL);
}

/** What the way home is called, from wherever the operator is. */
export function homeLabel(sessionOpen: boolean): string {
  return sessionOpen ? 'กลับไปขาย' : 'กลับไปหน้าเปิดร้าน';
}
