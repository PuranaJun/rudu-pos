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
