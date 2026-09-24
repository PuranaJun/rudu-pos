/**
 * The handful of fields the settings screens are built from.
 *
 * Settings are edited at home, not mid-pour, but the phone is the same and
 * so are the rules: 48px targets, high contrast, a visible label on every
 * field. Values are held as the text typed, and only turned into numbers on
 * save — a half-typed "1." is not an error until the operator says it is done.
 */
import type { ReactNode } from 'react';

const INPUT =
  'border-line min-h-touch w-full min-w-0 rounded-xl border-2 bg-white px-3 text-xl font-bold';

export function TextField({
  label,
  value,
  onChange,
  multiline = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <label className="mt-3 block">
      <span className="text-lg font-bold">{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className={`${INPUT} py-2 text-lg font-bold`}
        />
      ) : (
        <input
          type="text"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={INPUT}
        />
      )}
      {hint ? <span className="text-ink-soft block text-base font-bold">{hint}</span> : null}
    </label>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  suffix,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  hint?: string;
}) {
  return (
    <label className="mt-3 block">
      <span className="text-lg font-bold">{label}</span>
      <span className="border-line flex items-center rounded-xl border-2 bg-white px-3">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-touch w-full min-w-0 bg-transparent text-xl font-bold tabular-nums outline-none"
        />
        {suffix ? <span className="shrink-0 text-lg font-bold">{suffix}</span> : null}
      </span>
      {hint ? <span className="text-ink-soft block text-base font-bold">{hint}</span> : null}
    </label>
  );
}

/** A handful of mutually exclusive options, as buttons rather than a dropdown. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="mt-3" role="group" aria-label={label}>
      <span className="text-lg font-bold">{label}</span>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`min-h-touch rounded-xl border-2 px-3 text-lg font-bold ${
              value === option ? 'bg-ink border-ink text-white' : 'border-line'
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={value}
      onClick={() => onChange(!value)}
      className={`min-h-touch mt-3 flex w-full items-center justify-between rounded-xl border-2 px-4 text-lg font-bold ${
        value ? 'bg-ink border-ink text-white' : 'border-line'
      }`}
    >
      <span>{label}</span>
      <span>{value ? 'เปิด' : 'ปิด'}</span>
    </button>
  );
}

/**
 * One thing being edited: its fields, what is wrong with them, and save and
 * back in thumb reach at the bottom.
 */
export function Editor({
  title,
  problems,
  onSave,
  onBack,
  children,
}: {
  title: string;
  problems: readonly string[];
  onSave: () => void;
  /** Absent when there is nothing to go back to. */
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="pb-4">
      <h2 className="pt-3 text-2xl font-bold">{title}</h2>
      {children}

      {problems.length > 0 ? (
        <ul
          role="alert"
          className="bg-expired mt-4 rounded-xl px-4 py-3 text-lg font-bold text-white"
        >
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="safe-bottom sticky bottom-0 mt-4 flex gap-2 bg-white pt-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="border-line min-h-touch-lg rounded-2xl border-2 px-5 text-xl font-bold"
          >
            กลับ
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSave}
          className="bg-brand-2 min-h-touch-lg flex-1 rounded-2xl text-2xl font-bold text-white"
        >
          บันทึก
        </button>
      </div>
    </section>
  );
}

/** A tappable row in a settings list. */
export function ListRow({
  title,
  detail,
  onOpen,
  muted = false,
}: {
  title: string;
  detail?: string;
  onOpen: () => void;
  muted?: boolean;
}) {
  return (
    <li className="border-line border-b">
      <button
        type="button"
        onClick={onOpen}
        className="min-h-touch-lg flex w-full items-baseline justify-between gap-3 py-2 text-left"
      >
        <span className={`text-xl font-bold ${muted ? 'text-ink-soft line-through' : ''}`}>
          {title}
        </span>
        {detail ? <span className="shrink-0 text-lg font-bold tabular-nums">{detail}</span> : null}
      </button>
    </li>
  );
}
