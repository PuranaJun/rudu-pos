/**
 * The owner's PIN: staff sell, the owner sees what things cost.
 *
 * With a PIN set, the shop phone keeps settings, reports, purchasing, the
 * backup file and every cost and profit figure behind it. Selling never asks
 * for it. It is a curtain, not a safe: the phone still holds the costs, as it
 * must to work out COGS offline, and a backup file still contains them.
 *
 * The PIN belongs to this phone. It is never synced — the owner's own
 * view-only phone sees everything — and never goes into a backup file. There
 * is no reset: the owner chose that, so staff have no way round it either.
 *
 * Stored as a random salt and SHA-256 of salt and PIN, never the PIN itself.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';

export const OWNER_PIN_KEY = 'owner_pin';
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

/** Digits only, four to eight of them. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function digest(salt: string, pin: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return hex(new Uint8Array(hash));
}

/** What is stored for a PIN: `salt:hash`. `salt` is for tests. */
export async function pinRecord(
  pin: string,
  salt: string = hex(crypto.getRandomValues(new Uint8Array(16))),
): Promise<string> {
  return `${salt}:${await digest(salt, pin)}`;
}

/** True when `pin` is the one `record` was made from. */
export async function pinMatches(record: string, pin: string): Promise<boolean> {
  const [salt, hash] = record.split(':');
  if (!salt || !hash || !isValidPin(pin)) return false;
  return (await digest(salt, pin)) === hash;
}

/** The stored record, or null when the phone has no PIN. */
export async function loadOwnerPin(db: RuduPosDB = defaultDb): Promise<string | null> {
  const value = (await db.setting.get(OWNER_PIN_KEY))?.value;
  return typeof value === 'string' ? value : null;
}

export async function setOwnerPin(pin: string, db: RuduPosDB = defaultDb): Promise<void> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4–8 digits');
  await db.setting.put({ key: OWNER_PIN_KEY, value: await pinRecord(pin), synced_at: null });
}

export async function clearOwnerPin(db: RuduPosDB = defaultDb): Promise<void> {
  await db.setting.delete(OWNER_PIN_KEY);
}
