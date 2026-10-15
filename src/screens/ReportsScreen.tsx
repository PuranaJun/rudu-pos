import { useState } from 'react';
import DaySummaryScreen from './DaySummaryScreen.tsx';
import AnnualRevenueCard from '../components/AnnualRevenueCard.tsx';
import PeriodReportView from './reports/PeriodReportView.tsx';
import { ChoiceChip } from '../components/Button.tsx';
import { TextField } from '../components/form.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { formatTHB } from '../lib/money.ts';
import { bangkokDate, bangkokWeekday, businessDay } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import { useClosedDays, useCostCatalog, usePeriodReport, useSettings } from '../db/hooks.ts';
import { findSaleByOrderNo, loadReceipt, type Receipt } from '../db/sale-repo.ts';
import ReceiptSheet from '../components/ReceiptSheet.tsx';
import { Button } from '../components/Button.tsx';
import { parseNumber } from '../lib/number.ts';
import { PERIOD_PRESET_TH, presetRange, type PeriodPreset } from '../domain/period-report.ts';

const PRESETS: readonly PeriodPreset[] = ['LAST_7', 'LAST_30', 'THIS_MONTH', 'LAST_MONTH'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const [foundBill, setFoundBill] = useState<{
    receipt: Receipt;
    voidReason: string | null;
  } | null>(null);
  const [preset, setPreset] = useState<PeriodPreset | 'CUSTOM'>('LAST_7');
  const [today] = useState(() => bangkokDate(nowIso()));
  // Any stretch of days: one festival week against another, one market's run.
  const [from, setFrom] = useState(() => presetRange('LAST_7', today).from);
  const [to, setTo] = useState(today);
  const customOk = DATE.test(from) && DATE.test(to) && from <= to;
  const range =
    preset !== 'CUSTOM'
      ? presetRange(preset, today)
      : customOk
        ? { from, to }
        : presetRange('LAST_7', today);
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
            <ChoiceChip
              selected={preset === 'CUSTOM'}
              onClick={() => setPreset('CUSTOM')}
              className="col-span-2"
            >
              เลือกวันเอง
            </ChoiceChip>
          </div>
          {preset === 'CUSTOM' ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField label="ตั้งแต่" value={from} onChange={setFrom} type="date" />
              <TextField label="ถึง" value={to} onChange={setTo} type="date" />
            </div>
          ) : null}
          {preset === 'CUSTOM' && !customOk ? (
            <p role="alert" className="bg-today mt-2 rounded-xl px-4 py-2 text-lg font-bold">
              วันเริ่มต้องไม่หลังวันสุดท้าย
            </p>
          ) : (
            <p className="text-ink-soft pt-2 text-base font-bold tabular-nums">
              {businessDay(range.from)} – {businessDay(range.to)}
            </p>
          )}
          {report && (preset !== 'CUSTOM' || customOk) ? (
            <PeriodReportView report={report} />
          ) : null}
        </section>

        <FindBill today={today} onFound={setFoundBill} />

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

      {foundBill ? (
        <ReceiptSheet
          receipt={foundBill.receipt}
          voidReason={foundBill.voidReason}
          back={{ label: 'กลับไปรายงาน', onClick: () => setFoundBill(null) }}
        />
      ) : null}

      {open ? (
        <DaySummaryScreen
          sessionId={open}
          back={{ label: 'กลับไปรายงาน', onClick: () => setOpen(null) }}
        />
      ) : null}
    </Screen>
  );
}

/**
 * A bill from any day, by the order number on the customer's receipt: for the
 * customer who comes back about yesterday's drink. Order numbers start at 1
 * each day, so the day is asked for too.
 */
function FindBill({
  today,
  onFound,
}: {
  today: string;
  onFound: (bill: { receipt: Receipt; voidReason: string | null }) => void;
}) {
  const catalog = useCostCatalog();
  const settings = useSettings();
  const [date, setDate] = useState(today);
  const [orderNo, setOrderNo] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  function find() {
    const number = parseNumber(orderNo);
    if (!catalog || !settings) return;
    if (number === null || !Number.isInteger(number) || number < 1) {
      setProblem('ใส่เลขบิล เช่น 12');
      return;
    }
    findSaleByOrderNo(date, number)
      .then((sale) =>
        sale ? loadReceipt(catalog, sale.id, settings.brandingLineTh) : Promise.resolve(null),
      )
      .then((found) => {
        if (!found) {
          setProblem(`ไม่พบบิล #${number} วันที่ ${businessDay(date)}`);
          return;
        }
        setProblem(null);
        onFound(found);
      })
      .catch((cause: unknown) => setProblem(`ค้นหาไม่สำเร็จ: ${String(cause)}`));
  }

  return (
    <section aria-label="ค้นหาบิล" className="pt-6">
      <h2 className="border-line border-b pb-1 text-xl font-bold">ค้นหาบิล</h2>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="วันที่" value={date} onChange={setDate} type="date" />
        <TextField label="เลขบิล" value={orderNo} onChange={setOrderNo} inputMode="numeric" />
      </div>
      <Button variant="secondary" onClick={find} className="mt-3 w-full">
        ค้นหา
      </Button>
      {problem ? (
        <p role="alert" className="bg-today mt-2 rounded-xl px-4 py-2 text-lg font-bold">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
