import { useState } from 'react';
import DaySummaryScreen from './DaySummaryScreen.tsx';
import AnnualRevenueCard from '../components/AnnualRevenueCard.tsx';
import PeriodReportView from './reports/PeriodReportView.tsx';
import { ChoiceChip } from '../components/Button.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { formatTHB } from '../lib/money.ts';
import { bangkokDate, bangkokWeekday, businessDay } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import { useClosedDays, usePeriodReport } from '../db/hooks.ts';
import { PERIOD_PRESET_TH, presetRange, type PeriodPreset } from '../domain/period-report.ts';

const PRESETS: readonly PeriodPreset[] = ['LAST_7', 'LAST_30', 'THIS_MONTH', 'LAST_MONTH'];

/**
 * Reports (CLAUDE.md §7): a week's or a month's numbers — best sellers, the
 * market days worth keeping, the busy hours, topping take-up, waste against
 * its target — then the year against the VAT threshold, and every closed day,
 * each one opening its full summary.
 *
 * The bars are labelled lists, the number beside every one: read at arm's
 * length in the sun, not hovered over.
 */
export default function ReportsScreen({ back }: { back: BackTo }) {
  const days = useClosedDays();
  const [year] = useState(() => bangkokDate(nowIso()).slice(0, 4));
  const [open, setOpen] = useState<string | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>('LAST_7');
  const [today] = useState(() => bangkokDate(nowIso()));
  const range = presetRange(preset, today);
  const report = usePeriodReport(range);

  return (
    <Screen title="รายงาน">
      <ScreenBody>
        <section aria-label="ช่วงเวลา" className="pt-3">
          <div role="group" aria-label="ดูช่วง" className="grid grid-cols-2 gap-2">
            {PRESETS.map((id) => (
              <ChoiceChip key={id} selected={preset === id} onClick={() => setPreset(id)}>
                {PERIOD_PRESET_TH[id]}
              </ChoiceChip>
            ))}
          </div>
          <p className="text-ink-soft pt-2 text-base font-bold tabular-nums">
            {businessDay(range.from)} – {businessDay(range.to)}
          </p>
          {report ? <PeriodReportView report={report} /> : null}
        </section>

        <div className="pt-6">
          <AnnualRevenueCard year={year} />
        </div>

        <section aria-label="วันที่ปิดแล้ว" className="pt-5">
          <h2 className="border-line border-b pb-1 text-xl font-bold">วันที่ปิดแล้ว</h2>
          {days === undefined ? null : days.length === 0 ? (
            <p className="py-4 text-lg font-bold">ยังไม่มีวันที่ปิดร้าน</p>
          ) : (
            <ul>
              {days.map((day) => (
                <li key={day.sessionId} className="border-line border-b">
                  <button
                    type="button"
                    onClick={() => setOpen(day.sessionId)}
                    className="min-h-touch-lg flex w-full items-center gap-3 py-2 text-left"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-lg font-bold">
                          {bangkokWeekday(`${day.businessDate}T05:00:00.000Z`)}
                        </span>
                        <span className="text-xl font-bold tabular-nums">
                          {formatTHB(day.revenue)}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-x-3 text-base font-bold">
                        <span>{day.units} แก้ว</span>
                        <span className={day.wasteCost > 0 ? 'bg-today rounded-lg px-1' : ''}>
                          ของเสีย {formatTHB(day.wasteCost)}
                        </span>
                        {day.variance !== null && day.variance !== 0 ? (
                          <span className="bg-today rounded-lg px-1">
                            {day.variance < 0
                              ? `เงินขาด ${formatTHB(-day.variance)}`
                              : `เงินเกิน ${formatTHB(day.variance)}`}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {/* The row opens something: say so. */}
                    <span aria-hidden="true" className="text-3xl font-bold">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </ScreenBody>

      <ScreenFooter back={back} />

      {open ? (
        <DaySummaryScreen
          sessionId={open}
          back={{ label: 'กลับไปรายงาน', onClick: () => setOpen(null) }}
        />
      ) : null}
    </Screen>
  );
}
