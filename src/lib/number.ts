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

/** A number back into a field; blank for null. */
export function numberText(value: number | null): string {
  return value === null ? '' : String(value);
}
