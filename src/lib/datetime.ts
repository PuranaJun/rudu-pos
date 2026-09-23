const BANGKOK = 'Asia/Bangkok';

/** Dates are stored as ISO-8601 UTC and displayed in Asia/Bangkok (CLAUDE.md §13). */
export function formatBangkok(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: BANGKOK,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * The Asia/Bangkok calendar date as `YYYY-MM-DD`. Reports must never key off
 * the UTC date; a 23:30 Bangkok sale is 16:30 UTC the same day, but a 06:00
 * Bangkok sale is the *previous* UTC day.
 */
export function bangkokDate(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/** Clock time in Asia/Bangkok, for the sales list. */
export function bangkokTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('th-TH', {
    timeZone: BANGKOK,
    hour: '2-digit',
    minute: '2-digit',
  });
}
