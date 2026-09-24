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

/** Day and time without the year, for batch expiry: `26 ก.ย. 07:00`. */
export function bangkokShort(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: BANGKOK,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The open-day heading: weekday, day and month in Bangkok. */
export function bangkokWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString('th-TH', {
    timeZone: BANGKOK,
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
}

export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

/**
 * A Bangkok wall-clock time (`HH:mm`) on a Bangkok date (`YYYY-MM-DD`), as a
 * UTC ISO string. Thailand keeps no daylight saving, so +07:00 always holds.
 */
export function bangkokAt(date: string, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00+07:00`).toISOString();
}

/**
 * The value for an `<input type="datetime-local">`, in Bangkok time whatever
 * timezone the device happens to be set to.
 */
export function toBangkokInput(iso: string): string {
  return new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 16);
}

/** The inverse of toBangkokInput. Null for an empty or half-typed value. */
export function fromBangkokInput(value: string): string | null {
  const at = Date.parse(`${value}:00+07:00`);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/**
 * A span for a countdown: `2 วัน`, `6 ชม.`, `40 นาที`. Rounded down for time
 * left and up for time to wait, so it never promises more than there is.
 */
export function formatSpan(ms: number, round: 'down' | 'up' = 'down'): string {
  const fit = round === 'up' ? Math.ceil : Math.floor;
  const hours = ms / 3_600_000;
  if (hours >= 24) return `${fit(hours / 24)} วัน`;
  if (hours >= 1) return `${fit(hours)} ชม.`;
  return `${Math.max(1, fit(ms / 60_000))} นาที`;
}
