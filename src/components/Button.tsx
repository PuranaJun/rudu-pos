import type { ButtonHTMLAttributes } from 'react';
import {
  buttonClass,
  choiceClass,
  type ButtonSize,
  type ButtonVariant,
  type ChoiceTone,
} from './button.ts';

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

interface ButtonProps extends Native {
  variant: ButtonVariant;
  size?: ButtonSize | undefined;
  /** Less side padding, for a narrow button whose label must fit. */
  tight?: boolean | undefined;
  /**
   * Layout only — width, margin, flex, vertical padding. Never a colour,
   * a size or side padding: those come from the variant, and two classes
   * for one property do not reliably say which wins.
   */
  className?: string | undefined;
}

export function Button({
  variant,
  size = 'md',
  tight = false,
  className = '',
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={`${buttonClass(variant, size, { tight })} ${className}`}
      {...rest}
    />
  );
}

interface ChoiceProps extends Native {
  selected: boolean;
  tone?: ChoiceTone | undefined;
  size?: ButtonSize | undefined;
  /** `start` for a wide chip whose label reads as a line of text. */
  align?: 'center' | 'start' | undefined;
  className?: string | undefined;
}

/**
 * A choice that stays pressed. Selected shows a ✓ as well as the fill, so it
 * reads as chosen without relying on colour. The ✓ is hidden from screen
 * readers: `aria-pressed` already says it.
 */
export function ChoiceChip({
  selected,
  tone = 'neutral',
  size = 'sm',
  align = 'center',
  className = '',
  children,
  ...rest
}: ChoiceProps) {
  const alignment = align === 'start' ? 'justify-start text-left' : 'justify-center';
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`${choiceClass(selected, tone, size)} inline-flex items-center gap-1.5 ${alignment} ${className}`}
      {...rest}
    >
      {selected ? <span aria-hidden="true">✓</span> : null}
      <span>{children}</span>
    </button>
  );
}
