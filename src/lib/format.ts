const BANGKOK = 'Asia/Bangkok';

/** Money is persisted as an integer number of satang. Display as whole baht. */
export function formatBaht(satang: number): string {
  return `฿${Math.round(satang / 100).toLocaleString('th-TH')}`;
}

/** Dates are stored as ISO-8601 UTC and displayed in Asia/Bangkok. */
export function formatBangkok(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    timeZone: BANGKOK,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
