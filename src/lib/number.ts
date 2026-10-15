/**
 * Numbers as typed into a settings field. Held as text while editing, so a
 * half-typed `1.` is not an error until the operator saves.
 */

/** Text as typed to a number, or null if it is not one. Blank is null too. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * A number back into a field or onto a list; blank for null. Rounded to 10
 * significant digits first, so float noise from arithmetic on a cost
 * (0.026000000000000002) reads as the 0.026 it is.
 */
export function numberText(value: number | null): string {
  return value === null ? '' : String(Number(value.toPrecision(10)));
}
