/**
 * Pairing by link: the shop phone shares rudu-pos.pages.dev/#pair=KEY, and the
 * device that opens it lands on the pairing screen with the key filled in.
 */
import { formatKey } from './key.ts';

/** The link that pairs another device in one tap: the key rides in the address. */
export function pairLink(key: string): string {
  return `${location.origin}/#pair=${formatKey(key)}`;
}

/** The key from a pairing link, once, then gone from the address bar. */
export function pairKeyFromAddress(): string | null {
  const match = /^#pair=([A-Za-z0-9-]+)$/.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return match[1] ?? null;
}
