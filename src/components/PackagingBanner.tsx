import type { PackagingStock } from '../domain/packaging.ts';

/**
 * "แก้วพลาสติก 16 oz หมด · ฝา เหลือ 40" — drawn with the screen when a counted
 * item is out or at its reorder point, never a notification, and never in the
 * way of a sale: packaging warns, it does not stop anything (CLAUDE.md §6.6).
 * Tapping it goes to สั่งของ.
 */
export default function PackagingBanner({
  warnings,
  onTap,
}: {
  warnings: readonly PackagingStock[];
  onTap: () => void;
}) {
  if (warnings.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label="ของใช้ใกล้หมด"
      className="bg-today text-ink border-ink min-h-touch-lg flex w-full items-center gap-3 border-b-2 px-4 py-2 text-left"
    >
      <span className="min-w-0 flex-1 text-xl leading-snug font-bold">
        <span aria-hidden="true">⚠ </span>
        {warnings
          .map((entry) =>
            entry.level === 'OUT'
              ? `${entry.item.name_th} หมด`
              : `${entry.item.name_th} เหลือ ${entry.remaining}`,
          )
          .join(' · ')}
      </span>
      <span aria-hidden="true" className="shrink-0 text-xl font-bold">
        สั่งของ ›
      </span>
    </button>
  );
}
