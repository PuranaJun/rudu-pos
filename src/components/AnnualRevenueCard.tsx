import { formatTHB } from '../lib/money.ts';
import { revenueBand } from '../domain/reporting.ts';
import { useAnnualRevenue, useSettings } from '../db/hooks.ts';

interface Props {
  /** Bangkok calendar year, `YYYY`. */
  year: string;
  /** Show nothing until the year is inside the warning band. */
  onlyWhenNear?: boolean;
}

const BAND_STYLE = {
  OK: 'bg-paper-sunk',
  NEAR: 'bg-today',
  OVER: 'bg-expired text-white',
} as const;

/**
 * The year's takings against the VAT registration threshold (CLAUDE.md §5).
 *
 * A running total and a bar, nothing more: the shop is not VAT-registered and
 * this app does no tax arithmetic. Registering is a compliance event with
 * lead time, so the warning starts well before the line — how close is the
 * point, which is why this one is a bar and not only a number.
 */
export default function AnnualRevenueCard({ year, onlyWhenNear = false }: Props) {
  const total = useAnnualRevenue(year);
  const settings = useSettings();
  if (total === undefined || !settings) return null;

  const threshold = settings.annualRevenueThreshold;
  const band = revenueBand(total, threshold, settings.annualRevenueWarnRatio);
  if (onlyWhenNear && band === 'OK') return null;

  const share = Math.min(1, threshold > 0 ? total / threshold : 0);
  const buddhistYear = Number(year) + 543;

  return (
    <div
      role="status"
      aria-label="ยอดขายทั้งปี"
      className={`rounded-xl px-4 py-3 ${BAND_STYLE[band]}`}
    >
      <p className="text-lg font-bold">ยอดขายปี {buddhistYear}</p>
      <p className="text-3xl font-bold tabular-nums">{formatTHB(total)}</p>

      <div
        className="border-ink mt-2 h-4 w-full overflow-hidden rounded-full border-2 bg-white"
        aria-hidden="true"
      >
        <div className="bg-ink h-full" style={{ width: `${share * 100}%` }} />
      </div>

      <p className="mt-1 text-base font-bold">
        {band === 'OVER'
          ? `เกินเกณฑ์จดทะเบียน VAT ${formatTHB(threshold)} แล้ว — ต้องจดทะเบียน`
          : band === 'NEAR'
            ? `ใกล้เกณฑ์จดทะเบียน VAT ${formatTHB(threshold)} — อีก ${formatTHB(threshold - total)} เตรียมตัวล่วงหน้า`
            : `เกณฑ์จดทะเบียน VAT ${formatTHB(threshold)} · อีก ${formatTHB(threshold - total)}`}
      </p>
    </div>
  );
}
