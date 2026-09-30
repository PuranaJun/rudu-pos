/**
 * What a button looks like says what it does, the same way on every screen.
 *
 * - `primary`   green — go: pay, save, open the day, commit.
 * - `secondary` white with a dark edge — move around: back, cancel, open.
 * - `danger`    red — cannot be undone: void a bill, replace the data.
 * - `warning`   yellow — carry on past a warning: sell a sold-out drink.
 * - `cash`      white with a green edge — a note handed over; the family of
 *               the green พอดี beside it.
 * - `qr`        navy — PromptPay, so it is never mistaken for cash.
 *
 * A *choice* (a chip that stays pressed) is not an action: selected is an ink
 * fill with a ✓, and ink fill is never used for an action. Colour is never
 * the only signal — red and green are the same brightness, so the label and
 * the ✓ carry the meaning in direct sun.
 *
 * Plain functions in their own module so class strings can be shared with
 * elements that are not `<Button>` (a file input's label, say).
 */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'cash' | 'qr';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';
export type ChoiceTone = 'neutral' | 'keep' | 'discard';

// Height, width, radius and type. Side padding is separate (PAD) so a
// narrow button can ask for less without two padding classes fighting.
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-touch min-w-touch rounded-xl text-xl',
  md: 'min-h-touch-lg min-w-touch-lg rounded-2xl text-xl',
  lg: 'min-h-touch-lg min-w-touch-lg rounded-2xl text-2xl',
  xl: 'min-h-touch-lg min-w-touch-lg rounded-2xl py-4 text-3xl',
};

const PAD: Record<ButtonSize, string> = { sm: 'px-4', md: 'px-4', lg: 'px-5', xl: 'px-5' };

/** Layout that is not the look: `tight` for a narrow button whose label must fit. */
export interface ButtonFit {
  tight?: boolean | undefined;
}

function pad(size: ButtonSize, fit: ButtonFit): string {
  return fit.tight ? 'px-1' : PAD[size];
}

// Dark fills lighten when pressed; light ones darken. Either way the press is
// visible in sunlight, and nothing moves under the thumb (see index.css).
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'press-light bg-brand-2 border-brand-2 text-white',
  secondary: 'bg-white border-ink-soft text-ink',
  danger: 'press-light bg-expired border-expired text-white',
  warning: 'bg-today border-ink text-ink',
  cash: 'bg-white border-brand-2 text-ink',
  qr: 'press-light bg-qr border-qr text-white',
};

const BASE = 'border-2 font-bold leading-tight';
const DISABLED = 'disabled:bg-paper-sunk disabled:border-paper-sunk disabled:text-ink-soft';

export function buttonClass(
  variant: ButtonVariant,
  size: ButtonSize = 'md',
  fit: ButtonFit = {},
): string {
  return `${BASE} ${SIZE[size]} ${pad(size, fit)} ${VARIANT[variant]} ${DISABLED}`;
}

const SELECTED: Record<ChoiceTone, string> = {
  neutral: 'press-light bg-ink border-ink text-white',
  keep: 'press-light bg-brand-2 border-brand-2 text-white',
  discard: 'press-light bg-expired border-expired text-white',
};

/** A chip that stays pressed. The ✓ that goes with it is added by `ChoiceChip`. */
export function choiceClass(
  selected: boolean,
  tone: ChoiceTone = 'neutral',
  size: ButtonSize = 'sm',
  fit: ButtonFit = {},
): string {
  const look = selected ? SELECTED[tone] : 'bg-white border-ink-soft text-ink';
  return `${BASE} ${SIZE[size]} ${pad(size, fit)} ${look} ${DISABLED}`;
}
