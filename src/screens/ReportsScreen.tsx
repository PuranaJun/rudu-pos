import { useState } from 'react';
import DaySummaryScreen from './DaySummaryScreen.tsx';
import AnnualRevenueCard from '../components/AnnualRevenueCard.tsx';
import { formatTHB } from '../lib/money.ts';
import { bangkokDate, bangkokWeekday } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import { useClosedDays } from '../db/hooks.ts';

/**
 * Reports, Tier 1 only (CLAUDE.md §7): the year against the VAT threshold,
 * and every closed day, each one opening its full summary.
 *
 * Deliberately no charts. A list of days with their takings and waste
 * answers "how did last week go" faster than a plot would; the one visual
 * is the bar towards the threshold, where how close matters more than the
 * number. Days of the week, hours and attach rates are Tier 2, and wait.
 */
export default function ReportsScreen({ onClose }: { onClose: () => void }) {
  const days = useClosedDays();
  const [year] = useState(() => bangkokDate(nowIso()).slice(0, 4));
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div
      role="dialog"
      aria-label="รายงาน"
      className="safe-x text-ink fixed inset-0 z-30 flex flex-col bg-white"
    >
      <header className="safe-top border-line border-b px-4 pb-2">
        <h1 className="text-3xl font-bold">รายงาน</h1>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="pt-3">
          <AnnualRevenueCard year={year} />
        </div>

        <section aria-label="วันที่ปิดแล้ว" className="pt-5">
          <h2 className="border-line border-b pb-1 text-xl font-bold">วันที่ปิดแล้ว</h2>
          {days === undefined ? null : days.length === 0 ? (
            <p className="py-4 text-lg font-semibold">ยังไม่มีวันที่ปิดร้าน</p>
          ) : (
            <ul>
              {days.map((day) => (
                <li key={day.sessionId} className="border-line border-b">
                  <button
                    type="button"
                    onClick={() => setOpen(day.sessionId)}
                    className="min-h-touch-lg flex w-full flex-col py-2 text-left"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-lg font-bold">
                        {bangkokWeekday(`${day.businessDate}T05:00:00.000Z`)}
                      </span>
                      <span className="text-xl font-bold tabular-nums">
                        {formatTHB(day.revenue)}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-base font-semibold">
                      <span>{day.units} แก้ว</span>
                      <span className={day.wasteCost > 0 ? 'bg-today rounded px-1' : ''}>
                        ของเสีย {formatTHB(day.wasteCost)}
                      </span>
                      {day.variance !== null && day.variance !== 0 ? (
                        <span className="bg-today rounded px-1">
                          {day.variance < 0
                            ? `เงินขาด ${formatTHB(-day.variance)}`
                            : `เงินเกิน ${formatTHB(day.variance)}`}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="safe-bottom border-line border-t px-4 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="bg-ink min-h-touch-lg w-full rounded-2xl py-4 text-2xl font-bold text-white"
        >
          กลับ
        </button>
      </footer>

      {open ? (
        <DaySummaryScreen sessionId={open} doneLabel="กลับ" onDone={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
