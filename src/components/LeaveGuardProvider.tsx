import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { LeaveGuardContext, type LeaveGuard, type OpenEditor } from './leave-guard.ts';

/**
 * Holds the open editor and, when leaving it would drop changes, asks.
 *
 * The question sits at the bottom of the screen, in thumb reach, and keeping
 * the work is the easy answer: บันทึก is the big green one, แก้ต่อ stays put,
 * and throwing the changes away is red and on its own line.
 */
export default function LeaveGuardProvider({ children }: { children: ReactNode }) {
  // A ref, not state: the editor re-registers on every render, and nothing
  // needs to redraw because of it.
  const editor = useRef<OpenEditor | null>(null);
  const [pending, setPending] = useState<{ go: () => void } | null>(null);
  const [saving, setSaving] = useState(false);

  const guard = useMemo<LeaveGuard>(
    () => ({
      leave(go) {
        if (editor.current?.dirty) setPending({ go });
        else go();
      },
      register(next) {
        editor.current = next;
      },
    }),
    [],
  );

  function discard() {
    const go = pending?.go;
    setPending(null);
    go?.();
  }

  function saveAndGo() {
    const open = editor.current;
    const go = pending?.go;
    if (!open || !go || saving) return;
    setSaving(true);
    open
      .save()
      .then((saved) => {
        setPending(null);
        // Not saved: stay, so what needs fixing is on screen.
        if (saved) go();
      })
      .finally(() => setSaving(false));
  }

  return (
    <LeaveGuardContext.Provider value={guard}>
      {children}
      {pending ? (
        <div className="bg-ink/50 fixed inset-0 z-40 flex flex-col justify-end">
          <div
            role="alertdialog"
            aria-label="มีการแก้ที่ยังไม่บันทึก"
            className="safe-bottom safe-x rounded-t-2xl bg-white"
          >
            <div className="px-4 pt-4">
              <p className="text-2xl font-bold">มีการแก้ที่ยังไม่บันทึก</p>
              <p className="text-lg font-bold">บันทึกก่อนไปไหม?</p>
              <div className="mt-3 flex gap-3">
                <Button variant="secondary" onClick={() => setPending(null)} className="flex-1">
                  แก้ต่อ
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={saving}
                  onClick={saveAndGo}
                  className="flex-[1.6]"
                >
                  บันทึก
                </Button>
              </div>
              <Button variant="danger" onClick={discard} className="mt-3 w-full">
                ทิ้งการแก้ไข
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </LeaveGuardContext.Provider>
  );
}
