import type { ReactNode } from 'react';
import { formatTHB } from '../../lib/money.ts';
import { formatQty } from '../../lib/quantity.ts';
import { wastePct, type PeriodReport } from '../../domain/period-report.ts';

/** Waste over this share of what left the shelf is the line to stay under (CLAUDE.md §7). */
const WASTE_TARGET = 0.1;
/** The business plan assumes about one paid topping in three cups. */
const ATTACH_PLAN = 1 / 3;

/**
 * A week's or a month's numbers, read on a phone in the sun.
 *
 * The headline figures are plain numbers. Everything compared is a list of
 * labelled bars in one colour, the number printed beside each — no hover, no
 * legend to decode, no colour that means anything on its own. Where a bar is
 * judged against a line (waste, topping take-up), the line is drawn and named,
 * and over the waste line says so in words as well as in red.
 */
export default function PeriodReportView({ report }: { report: PeriodReport }) {
  const { totals } = report;

  if (totals.saleCount === 0) {
    return <p className="py-6 text-lg font-bold">ยังไม่มีการขายในช่วงนี้</p>;
  }

  const bestUnits = Math.max(...report.bestSellers.map((b) => b.units));
  const wasted = report.waste.filter((entry) => entry.wasted > 0);
  const bestDay = Math.max(...report.byWeekday.map((d) => d.perDay));
  const busiestHour = Math.max(...report.byHour.map((h) => h.cups));

  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 pt-3">
        <Figure label="ยอดขาย" value={baht(totals.revenue)} />
        <Figure label="แก้ว" value={String(totals.units)} />
        <Figure label="กำไรขั้นต้น" value={baht(totals.grossProfit)} />
        <Figure label="ของเสีย" value={baht(report.wasteCost)} />
        <Figure
          label="เฉลี่ยต่อวัน"
          value={baht(report.revenuePerDay)}
          detail={`${report.tradingDays} วันที่ออกขาย`}
        />
        <Figure
          label="เฉลี่ยต่อบิล"
          value={baht(report.revenuePerBill)}
          detail={`${report.cupsPerBill.toFixed(1)} แก้ว · ${totals.saleCount} บิล`}
        />
      </dl>

      <Section title="ขายดี">
        {report.bestSellers.map((entry) => (
          <Bar
            key={entry.variantId}
            label={entry.name}
            value={`${entry.units} แก้ว · ${formatTHB(entry.revenue)}`}
            fraction={entry.units / bestUnits}
          />
        ))}
      </Section>

      <Section title="วันไหนขายดี" note="ยอดเฉลี่ยต่อวันที่ออกขาย">
        {report.byWeekday.map((day) => (
          <Bar
            key={day.weekday}
            label={day.days === 0 ? day.label : `${day.label} (${day.days} วัน)`}
            value={day.days === 0 ? 'ไม่ได้ขาย' : `${formatTHB(day.perDay)}/วัน`}
            fraction={bestDay === 0 ? 0 : day.perDay / bestDay}
          />
        ))}
      </Section>

      <Section title="ช่วงเวลาที่ขาย" note="แก้วรวมในแต่ละชั่วโมง">
        {report.byHour.map((hour) => (
          <Bar
            key={hour.hour}
            label={`${String(hour.hour).padStart(2, '0')}:00`}
            value={`${hour.cups} แก้ว`}
            fraction={busiestHour === 0 ? 0 : hour.cups / busiestHour}
          />
        ))}
      </Section>

      {report.attach.length > 0 ? (
        <Section title="ท็อปปิ้งที่ขาย" note="เส้นดำ = แผนที่คิดไว้ 1 ใน 3 แก้ว">
          {report.attach.map((entry) => (
            <Bar
              key={entry.modifierId}
              label={entry.name}
              value={percent(entry.attached / entry.eligible)}
              fraction={entry.attached / entry.eligible}
              target={ATTACH_PLAN}
              detail={`${entry.attached} จาก ${entry.eligible} แก้ว`}
            />
          ))}
        </Section>
      ) : null}

      {report.waste.length > 0 ? (
        <Section title="ของเสีย %" note="ทิ้ง ÷ (ขาย + ทิ้ง) · เส้นดำ = เป้าไม่เกิน 10%">
          {wasted.map((entry) => {
            const pct = wastePct(entry);
            const over = pct > WASTE_TARGET;
            return (
              <Bar
                key={entry.componentId}
                label={entry.name}
                value={percent(pct)}
                fraction={pct}
                tone={over ? 'over' : 'normal'}
                target={WASTE_TARGET}
                detail={`ทิ้ง ${formatQty(entry.wasted, entry.unit)}`}
                badge={over ? 'เกินเป้า' : undefined}
              />
            );
          })}
          {wasted.length < report.waste.length ? (
            <li className="text-ink-soft py-2 text-lg font-bold">
              {wasted.length === 0 ? 'ไม่มีของเสียเลย' : 'ส่วนประกอบอื่นไม่มีของเสีย'}
            </li>
          ) : null}
        </Section>
      ) : null}

      <Section title="บิล">
        <Split label="กลับบ้าน" count={report.orderTypes.TAKEAWAY} />
        <Split label="ทานที่ร้าน" count={report.orderTypes.DINE_IN} />
        <Split label="เงินสด" count={report.payments.CASH} />
        <Split label="พร้อมเพย์" count={report.payments.PROMPTPAY} />
      </Section>
    </div>
  );
}

/** Headline money, to the baht: a report is read for its size, not its satang. */
function baht(satang: number): string {
  return formatTHB(Math.round(satang / 100) * 100);
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function Figure({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="bg-paper-sunk rounded-xl px-3 py-2">
      <dt className="text-base font-bold">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
      {detail ? <dd className="text-base font-bold tabular-nums">{detail}</dd> : null}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="pt-6">
      <h2 className="border-line border-b pb-1 text-xl font-bold">{title}</h2>
      {note ? <p className="text-ink-soft pt-1 text-base font-bold">{note}</p> : null}
      <ul>{children}</ul>
    </section>
  );
}

/**
 * One labelled bar. The number is text beside it, so the bar only has to show
 * proportion: the track is the full width, the bar starts square at the left
 * and ends rounded. A target is a thin ink line across the track, named once
 * in the section's note rather than under every bar.
 */
function Bar({
  label,
  value,
  fraction,
  tone = 'normal',
  target,
  detail,
  badge,
}: {
  label: string;
  value: string;
  fraction: number;
  tone?: 'normal' | 'over';
  target?: number;
  detail?: string;
  /** A state worth saying in words, not only in red: "เกินเป้า". */
  badge?: string | undefined;
}) {
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-bold">{label}</span>
        <span className="shrink-0 text-lg font-bold tabular-nums">{value}</span>
      </div>
      <div aria-hidden="true" className="bg-paper-sunk relative mt-1 h-3 rounded-full">
        <div
          className={`h-full rounded-r ${tone === 'over' ? 'bg-expired' : 'bg-brand-2'}`}
          style={{ width }}
        />
        {target !== undefined ? (
          <div
            className="bg-ink absolute -top-1 -bottom-1 w-0.5"
            style={{ left: `${target * 100}%` }}
          />
        ) : null}
      </div>
      {detail || badge ? (
        <div className="mt-1 flex items-center justify-between gap-3">
          <span className="text-base font-bold tabular-nums">{detail}</span>
          {badge ? (
            <span className="bg-expired rounded-lg px-2 text-base font-bold text-white">
              <span aria-hidden="true">⚠ </span>
              {badge}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function Split({ label, count }: { label: string; count: number }) {
  return (
    <li className="flex justify-between py-1 text-lg font-bold">
      <span>{label}</span>
      <span className="tabular-nums">{count} บิล</span>
    </li>
  );
}
