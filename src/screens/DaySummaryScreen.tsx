import { formatTHB } from '../lib/money.ts';
import { formatQty } from '../lib/quantity.ts';
import { bangkokWeekday } from '../lib/datetime.ts';
import { DISCOUNT_REASON_TH } from '../domain/promotions.ts';
import { useDaySummary } from '../db/hooks.ts';
import { backupAsFile, markBackedUp } from '../db/backup.ts';
import ShareFileButton from '../components/ShareFileButton.tsx';
import type { Satang } from '../lib/money.ts';

interface Props {
  sessionId: string;
  onDone: () => void;
  /** เสร็จ straight after a close; กลับ when opened from the reports. */
  doneLabel?: string;
  /**
   * Straight after a close: offer the day's backup, one tap. This is the
   * routine that keeps the records alive (CLAUDE.md §13).
   */
  promptBackup?: boolean;
}

/**
 * The day, closed (CLAUDE.md §7 Tier 1).
 *
 * The first screenful answers the questions that matter without a scroll:
 * did the day cover its costs, what came in, what it cost, what was thrown
 * away, and whether the drawer is right. Waste sits beside profit, not under
 * it — it is where this shop actually loses money. The detail follows below.
 */
export default function DaySummaryScreen({
  sessionId,
  onDone,
  doneLabel = 'เสร็จ',
  promptBackup = false,
}: Props) {
  const summary = useDaySummary(sessionId);

  if (!summary) {
    return <div role="dialog" aria-label="สรุปวัน" className="fixed inset-0 z-30 bg-white" />;
  }

  const { totals, breakeven, cash } = summary;
  const dayDate = new Date(`${summary.businessDate}T12:00:00+07:00`).toISOString();

  return (
    <div
      role="dialog"
      aria-label="สรุปวัน"
      className="safe-x text-ink fixed inset-0 z-30 flex flex-col bg-white"
    >
      <header className="safe-top border-line border-b px-4 pb-2">
        <h1 className="text-3xl font-bold">สรุปวัน</h1>
        <p className="text-ink-soft text-lg font-bold">{bangkokWeekday(dayDate)}</p>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div
          role="status"
          aria-label="จุดคุ้มทุน"
          className={`mt-3 rounded-xl px-4 py-3 ${breakeven.past ? 'bg-brand-2 text-white' : 'bg-today'}`}
        >
          <p className="text-2xl font-bold">
            {breakeven.past ? 'ผ่านจุดคุ้มทุน' : 'ยังไม่ถึงจุดคุ้มทุน'}
          </p>
          <p className="text-lg font-bold">
            {breakeven.cups}/{breakeven.cupsTarget} แก้ว · กำไรขั้นต้น{' '}
            {formatTHB(breakeven.grossProfit)} จาก {formatTHB(breakeven.fixedCost)}
          </p>
          <p className="text-lg font-bold">หลังหักของเสีย {formatTHB(breakeven.afterWaste)}</p>
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Figure label="ยอดขาย" value={formatTHB(totals.revenue)} />
          <Figure label="แก้ว" value={String(totals.units)} />
          <Figure label="ต้นทุน" value={formatTHB(totals.cogs)} />
          <Figure label="กำไรขั้นต้น" value={formatTHB(totals.grossProfit)} />
          <Figure
            label="ของเสีย"
            value={formatTHB(summary.wasteCost)}
            loud={summary.wasteCost > 0}
          />
          <Figure
            label="เงินสด"
            value={cash ? varianceLabel(cash.variance) : '—'}
            loud={cash !== null && cash.variance !== 0}
          />
        </dl>

        <Section title="ขายตามเมนู">
          {summary.unitsByVariant.length === 0 ? (
            <Row label="ไม่มีการขาย" value="" />
          ) : (
            summary.unitsByVariant.map((line) => (
              <Row key={line.variantId} label={line.name} value={`${line.units}`} />
            ))
          )}
        </Section>

        <Section title="ส่วนลด">
          {totals.discountsByReason.length === 0 ? (
            <Row label="ไม่มี" value="" />
          ) : (
            totals.discountsByReason.map((discount) => (
              <Row
                key={discount.reason}
                label={DISCOUNT_REASON_TH[discount.reason]}
                value={formatTHB(discount.amount)}
              />
            ))
          )}
        </Section>

        <Section title="ของเสีย">
          {summary.waste.length === 0 ? (
            <Row label="ไม่มี" value="" />
          ) : (
            summary.waste.map((line) => (
              <Row
                key={line.componentId}
                label={`${line.name} ${formatQty(line.qty, line.unit)}`}
                value={formatTHB(line.cost)}
              />
            ))
          )}
        </Section>

        {cash ? (
          <Section title="เงินสด">
            <Row label="เงินทอนเริ่มต้น" value={formatTHB(cash.openingFloat)} />
            <Row label="ควรมี" value={formatTHB(cash.expected)} />
            <Row label="นับได้" value={formatTHB(cash.counted)} />
            <Row label="ผลต่าง" value={varianceLabel(cash.variance)} />
          </Section>
        ) : null}
      </main>

      <footer className="safe-bottom border-line border-t px-4 pt-3">
        {promptBackup ? (
          <div className="mb-2">
            <ShareFileButton
              label="สำรองข้อมูลวันนี้"
              build={() => backupAsFile()}
              onDone={() => void markBackedUp()}
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={onDone}
          className="bg-ink min-h-touch-lg w-full rounded-2xl py-4 text-2xl font-bold text-white"
        >
          {doneLabel}
        </button>
      </footer>
    </div>
  );
}

function varianceLabel(variance: Satang): string {
  if (variance === 0) return 'ตรง';
  return variance < 0 ? `ขาด ${formatTHB(-variance)}` : `เกิน ${formatTHB(variance)}`;
}

function Figure({ label, value, loud = false }: { label: string; value: string; loud?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2 ${loud ? 'bg-today' : 'bg-paper-sunk'}`}>
      <dt className="text-base font-bold">{label}</dt>
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="pt-5">
      <h2 className="border-line border-b pb-1 text-xl font-bold">{title}</h2>
      <dl>{children}</dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line flex items-baseline justify-between gap-3 border-b py-2 text-lg font-bold">
      <dt>{label}</dt>
      <dd className="font-bold tabular-nums">{value}</dd>
    </div>
  );
}
