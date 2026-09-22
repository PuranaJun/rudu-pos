/** Client-generated row id. Every runtime row carries one (CLAUDE.md §8). */
export function newId(): string {
  return crypto.randomUUID();
}

/** Timestamps are stored as ISO-8601 UTC and only formatted for display. */
export function nowIso(): string {
  return new Date().toISOString();
}
