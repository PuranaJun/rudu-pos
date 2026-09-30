import { createContext, useContext } from 'react';

/**
 * Nothing typed into a settings form is lost without being asked.
 *
 * The form that is open registers whether it has unsaved changes and how to
 * save them. Anything that would take the operator away from it — back, a
 * different tab, a row that opens another editor — goes through `leave`: with
 * nothing unsaved it goes straight away; otherwise the operator chooses to
 * save, throw the changes away, or keep editing.
 */
export interface OpenEditor {
  dirty: boolean;
  /** Resolves true once saved; false when there is something to fix first. */
  save: () => Promise<boolean>;
}

export interface LeaveGuard {
  leave: (go: () => void) => void;
  register: (editor: OpenEditor | null) => void;
}

/** Outside a provider there is nothing to guard: leaving just goes. */
export const LeaveGuardContext = createContext<LeaveGuard>({
  leave: (go) => go(),
  register: () => {},
});

export function useLeaveGuard(): LeaveGuard {
  return useContext(LeaveGuardContext);
}
