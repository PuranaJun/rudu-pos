/**
 * The handful of fields the settings screens are built from.
 *
 * Settings are edited at home, not mid-pour, but the phone is the same and
 * so are the rules: 48px targets, high contrast, a visible label on every
 * field. Values are held as the text typed, and only turned into numbers on
 * save — a half-typed "1." is not an error until the operator says it is done.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ChoiceChip } from './Button.tsx';
import { choiceClass } from './button.ts';
import { ScreenBody, ScreenFooter, type BackTo } from './Screen.tsx';
import { useLeaveGuard } from './leave-guard.ts';

const INPUT =
  'border-ink-soft min-h-touch w-full min-w-0 rounded-xl border-2 bg-white px-3 text-xl font-bold';

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
      <span className="border-ink-soft field-focus flex items-center rounded-xl border-2 bg-white px-3">
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
          <ChoiceChip key={option} selected={value === option} onClick={() => onChange(option)}>
            {text}
          </ChoiceChip>
        ))}
      </div>
    </div>
  );
}

/** On or off, said in words beside the ✓ — never by colour alone. */
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
      className={`${choiceClass(value)} mt-3 flex w-full items-center justify-between gap-3 text-left`}
    >
      <span>{label}</span>
      <span className="shrink-0">
        {value ? (
          <>
            <span aria-hidden="true">✓ </span>เปิด
          </>
        ) : (
          'ปิด'
        )}
      </span>
    </button>
  );
}

/**
 * One thing being edited: its fields, and save and back in thumb reach at the
 * bottom of the screen.
 *
 * Whatever needs saying about the save is said next to the button that did
 * it — what is wrong, in red, or that it is saved — never at the foot of a
 * form four screens long. Leaving with unsaved changes asks first (see
 * leave-guard.ts), and บันทึก cannot be pressed twice while a save is on its
 * way, so a double tap never creates a thing twice.
 */
export function Editor({
  title,
  problems,
  onSave,
  back,
  dirty,
  justSaved,
  children,
}: {
  title: string;
  problems: readonly string[];
  /** Resolves true once saved; false when there is something to fix. */
  onSave: () => Promise<boolean>;
  back: BackTo;
  dirty: boolean;
  justSaved: boolean;
  children: ReactNode;
}) {
  const guard = useLeaveGuard();
  const [saving, setSaving] = useState(false);

  function save(): Promise<boolean> {
    if (saving) return Promise.resolve(false);
    setSaving(true);
    return onSave().finally(() => setSaving(false));
  }

  // Every render: the guard always holds this form's latest state.
  useEffect(() => {
    guard.register({ dirty, save });
  });
  useEffect(() => () => guard.register(null), [guard]);

  return (
    <>
      <ScreenBody>
        <section aria-label={title}>
          <h2 className="pt-3 text-2xl font-bold">{title}</h2>
          {children}
        </section>
      </ScreenBody>

      <ScreenFooter
        back={{ label: back.label, onClick: () => guard.leave(back.onClick) }}
        primary={{ label: 'บันทึก', onClick: () => void save(), disabled: saving }}
      >
        {problems.length > 0 ? (
          <ul
            role="alert"
            className="bg-expired mb-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : justSaved ? (
          <p role="status" className="bg-paper-sunk mb-3 rounded-xl px-4 py-2 text-lg font-bold">
            <span aria-hidden="true">✓ </span>บันทึกแล้ว
          </p>
        ) : dirty ? (
          <p className="text-ink-soft mb-3 text-lg font-bold">ยังไม่ได้บันทึก</p>
        ) : null}
      </ScreenFooter>
    </>
  );
}

/** A list and the way out of it, for a settings section that is not a form. */
export function ListPage({ exit, children }: { exit: BackTo; children: ReactNode }) {
  return (
    <>
      <ScreenBody>{children}</ScreenBody>
      <ScreenFooter back={exit} />
    </>
  );
}

/** A tappable row in a settings list. The › says it opens something. */
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
        className="min-h-touch-lg flex w-full items-center justify-between gap-3 py-2 text-left"
      >
        <span className={`min-w-0 text-xl font-bold ${muted ? 'text-ink-soft line-through' : ''}`}>
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {detail ? <span className="text-lg font-bold tabular-nums">{detail}</span> : null}
          <span aria-hidden="true" className="text-3xl font-bold">
            ›
          </span>
        </span>
      </button>
    </li>
  );
}
