import type { PrepReminder } from '../domain/production.ts';

interface Props {
  reminders: readonly PrepReminder[];
  onTap: () => void;
}

/**
 * "เริ่มแช่ชาแดงก่อน 21:00" — a banner, drawn when the screen is, never a
 * notification. Nothing is scheduled to show it (CLAUDE.md §1). Tapping it
 * goes to the production screen, where the batch gets recorded.
 */
export default function PrepBanner({ reminders, onTap }: Props) {
  if (reminders.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onTap}
      aria-label="เตือนเตรียมของพรุ่งนี้"
      className="bg-today text-ink w-full px-4 py-2 text-left"
    >
      {reminders.map((reminder) => (
        <span key={reminder.component.id} className="block text-lg leading-snug font-bold">
          เริ่ม{verbFor(reminder)}
          {reminder.component.name_th} ก่อน {reminder.startBy}
          {reminder.late ? ' — เลยเวลาแล้ว' : ''}
        </span>
      ))}
    </button>
  );
}

/** Steeping and soaking are "แช่"; anything else is simply "ทำ". */
function verbFor(reminder: PrepReminder): string {
  const lifecycle = reminder.component.lifecycle;
  return lifecycle === 'STEEP' || lifecycle === 'SOAK_BLANCH' ? 'แช่' : 'ทำ';
}
