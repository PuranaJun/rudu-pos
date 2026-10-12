/**
 * The shop's sync key: the one secret between the shop phone, the cloud and
 * any device allowed to look (CLAUDE.md §8).
 *
 * Twenty characters, 100 bits, from an alphabet with no 0/O or 1/I to misread,
 * shown in groups of four so it can be typed once on a phone without a typo:
 * `K7QM-2XRP-H9TD-W4NC-8FJV`. Shared by the app and the server.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 20;

/** A new key. `bytes` is for tests; otherwise twenty random bytes from the platform. */
export function generateKey(
  bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(LENGTH)),
): string {
  // 256 is a multiple of 32, so taking the low five bits is unbiased.
  return [...bytes.slice(0, LENGTH)].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

/** Whatever was typed or pasted, as the bare key — or null if it cannot be one. */
export function normalizeKey(input: string): string | null {
  const key = input.toUpperCase().replace(/[\s-]/g, '');
  if (key.length !== LENGTH) return null;
  for (const char of key) if (!ALPHABET.includes(char)) return null;
  return key;
}

/** `K7QM-2XRP-H9TD-W4NC-8FJV`, for reading off one screen and typing into another. */
export function formatKey(key: string): string {
  return key.match(/.{1,4}/g)?.join('-') ?? key;
}

/** What the server keeps instead of the key: SHA-256, hex. */
export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
