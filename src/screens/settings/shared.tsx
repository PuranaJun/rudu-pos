/** "Add another" at the foot of a settings list. */
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-ink min-h-touch-lg mt-4 w-full rounded-2xl border-2 border-dashed text-xl font-bold"
    >
      + {label}
    </button>
  );
}

/** Shown under the fields once a save has landed. */
export function Saved({ show }: { show: boolean }) {
  return show ? (
    <p role="status" className="mt-3 text-lg font-bold">
      บันทึกแล้ว
    </p>
  ) : null;
}
