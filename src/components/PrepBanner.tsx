import type { PrepReminder } from '../domain/production.ts';

interface Props {
  reminders: readonly PrepReminder[];
  onTap: () => void;
  /** Where the tap goes, in words. */
  actionLabel?: string;
}

/**
 * "เริ่มแช่ชาแดงก่อน 21:00" — a banner, drawn when the screen is, never a
 * notification. Nothing is scheduled to show it (CLAUDE.md §1). Tapping it
 * goes to the production screen, where the batch gets recorded.
 *
 * Yellow is also used for notices that do nothing when tapped, so this one
 * says it goes somewhere: "ไปผลิต ›" on the right and a hard edge beneath.
 */
export default function PrepBanner({ reminders, onTap, actionLabel = 'ไปผลิต ›' }: Props) {
  if (reminders.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label="เตือนเตรียมของพรุ่งนี้"
      className="bg-today text-ink border-ink min-h-touch-lg flex w-full items-center gap-3 border-b-2 px-4 py-2 text-left"
    >
      <span className="min-w-0 flex-1">
        {reminders.map((reminder) => (
          <span key={reminder.component.id} className="block text-xl leading-snug font-bold">
            เริ่ม{verbFor(reminder)}
            {reminder.component.name_th} ก่อน {reminder.startBy}
            {reminder.late ? ' — เลยเวลาแล้ว' : ''}
          </span>
        ))}
      </span>
      <span aria-hidden="true" className="shrink-0 text-xl font-bold">
        {actionLabel}
      </span>
    </button>
  );
}

/** Steeping and soaking are "แช่"; anything else is simply "ทำ". */
function verbFor(reminder: PrepReminder): string {
  const lifecycle = reminder.component.lifecycle;
  return lifecycle === 'STEEP' || lifecycle === 'SOAK_BLANCH' ? 'แช่' : 'ทำ';
}
