import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { problemsOf } from './problems.ts';

/** "Add another" at the foot of a settings list: dashed, so it reads as "a new one goes here". */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-ink min-h-touch-lg mt-4 w-full rounded-2xl border-2 border-dashed bg-white text-xl font-bold"
    >
      + {label}
    </button>
  );
}

/**
 * Bring something that just opened at the foot of a long form fully into
 * view: on a phone it would otherwise open behind the footer, its buttons
 * out of reach until the operator thinks to scroll.
 */
function useReveal<T extends HTMLElement>(shown: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    // Optional call: not every browser engine (nor jsdom) has it.
    if (shown) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [shown]);
  return ref;
}

/**
 * Remove the thing being edited, at the very foot of its editor — far from
 * บันทึก, and asked twice. What it costs is said before it happens: nothing
 * already sold changes, and it can come back from ลบแล้ว. A refusal says what
 * still uses it (domain/removal.ts), right where the button was pressed.
 */
export function RemoveButton({
  name,
  onRemove,
  onRemoved,
}: {
  /** The thing's own name, e.g. "สาลี่ขาว". */
  name: string;
  onRemove: () => Promise<void>;
  onRemoved: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const ref = useReveal<HTMLDivElement>(asking || problems.length > 0);

  function remove() {
    if (busy) return;
    setBusy(true);
    onRemove()
      .then(onRemoved, (cause: unknown) => {
        setProblems(problemsOf(cause));
        setAsking(false);
      })
      .finally(() => setBusy(false));
  }

  return (
    <div ref={ref} className="border-line mt-8 border-t-2 pt-4 pb-2">
      {asking ? (
        <div
          role="group"
          aria-label={`ยืนยันลบ${name}`}
          className="border-expired rounded-xl border-2 p-3"
        >
          <p className="text-xl font-bold">ลบ{name}?</p>
          <p className="mt-1 text-lg font-bold">
            ยอดขายและรายงานที่ผ่านมายังเห็นชื่อนี้เหมือนเดิม · เอากลับมาได้ที่ “ลบแล้ว” ท้ายรายการ
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setAsking(false)} className="flex-1">
              ไม่ลบ
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy} className="flex-1">
              ลบ
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="danger"
          onClick={() => {
            setProblems([]);
            setAsking(true);
          }}
          className="w-full"
        >
          ลบ{name}
        </Button>
      )}
      {problems.length > 0 ? (
        <div
          role="alert"
          className="bg-expired mt-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
        >
          <p>ยังลบไม่ได้</p>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * What has been removed, folded away at the foot of a list. Each row comes
 * back with one tap — switched off where it can be, so it is looked over
 * before it reaches the sell screen again.
 */
export function RemovedList({
  rows,
  onRestore,
}: {
  rows: readonly { id: string; name: string }[];
  onRestore: (id: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useReveal<HTMLElement>(open);
  if (rows.length === 0) return null;

  return (
    <section ref={ref} aria-label="ลบแล้ว" className="mt-6">
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full"
      >
        {open ? 'ซ่อนที่ลบแล้ว' : `ลบแล้ว (${rows.length})`}
      </Button>
      {open ? (
        <ul className="mt-2">
          {rows.map((row) => (
            <li key={row.id} className="border-line flex items-center gap-3 border-b py-2">
              <span className="text-ink-soft min-w-0 flex-1 text-xl font-bold line-through">
                {row.name}
              </span>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`เอา${row.name}กลับมา`}
                onClick={() => void onRestore(row.id)}
              >
                เอากลับมา
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
