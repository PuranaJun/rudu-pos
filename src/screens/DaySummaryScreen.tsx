import { formatTHB } from '../lib/money.ts';
import { formatQty } from '../lib/quantity.ts';
import { bangkokWeekday } from '../lib/datetime.ts';
import { discountLabel } from '../domain/promotions.ts';
import { useDaySummary, useSyncState } from '../db/hooks.ts';
import BackupFileButton from '../components/BackupFileButton.tsx';
import { useExpectedCashShown, useOwnerLock } from '../nav/owner-lock.ts';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import type { Satang } from '../lib/money.ts';

interface Props {
  sessionId: string;
  /** To open day straight after a close; to the list when opened from reports. */
  back: BackTo;
  /**
   * Straight after a close: offer the day's backup, one tap — on a phone
   * without sync, where this is the routine that keeps the records alive
   * (CLAUDE.md §13).
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
export default function DaySummaryScreen({ sessionId, back, promptBackup = false }: Props) {
  const summary = useDaySummary(sessionId);
  // The staff close the day: they see the cups, the takings, what was thrown
  // away and the drawer — never what any of it cost.
  const costs = useOwnerLock().open;
  const cashShown = useExpectedCashShown();
  // A shop phone that syncs sends the day to the cloud on its own; the file
  // is for a phone that holds the only copy (CLAUDE.md §13).
  const sync = useSyncState();
  const offerBackup = promptBackup && sync !== undefined && sync.mode !== 'SHOP';

  if (!summary) {
    // Loading: the title and the way out are there from the first frame.
    return (
      <Screen title="สรุปวัน">
        <ScreenBody>
          <p className="py-6 text-lg font-bold">กำลังโหลด…</p>
        </ScreenBody>
        <ScreenFooter back={back} />
      </Screen>
    );
  }

  const { totals, breakeven, cash } = summary;
  const dayDate = new Date(`${summary.businessDate}T12:00:00+07:00`).toISOString();

  return (
    <Screen title="สรุปวัน" subtitle={bangkokWeekday(dayDate)}>
      <ScreenBody>
        <div
          role="status"
          aria-label="จุดคุ้มทุน"
          className={`mt-3 rounded-xl px-4 py-3 ${breakeven.past ? 'bg-brand-2 text-white' : 'bg-today'}`}
        >
          <p className="text-2xl font-bold">
            {breakeven.past ? 'ผ่านจุดคุ้มทุน' : 'ยังไม่ถึงจุดคุ้มทุน'}
          </p>
          {costs ? (
            <>
              <p className="text-lg font-bold">
                {breakeven.cups}/{breakeven.cupsTarget} แก้ว · กำไรขั้นต้น{' '}
                {formatTHB(breakeven.grossProfit)} จาก {formatTHB(breakeven.fixedCost)}
              </p>
              <p className="text-lg font-bold">หลังหักของเสีย {formatTHB(breakeven.afterWaste)}</p>
            </>
          ) : (
            <p className="text-lg font-bold">
              {breakeven.cups}/{breakeven.cupsTarget} แก้ว
            </p>
          )}
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-2">
          <Figure label="ยอดขาย" value={formatTHB(totals.revenue)} />
          <Figure label="แก้ว" value={String(totals.units)} />
          {costs ? (
            <>
              <Figure label="ต้นทุน" value={formatTHB(totals.cogs)} />
              <Figure label="กำไรขั้นต้น" value={formatTHB(totals.grossProfit)} />
              <Figure
                label="ของเสีย"
                value={formatTHB(summary.wasteCost)}
                loud={summary.wasteCost > 0}
              />
            </>
          ) : (
            <Figure
              label="ของเสีย"
              value={summary.waste.length === 0 ? 'ไม่มี' : `${summary.waste.length} อย่าง`}
              loud={summary.waste.length > 0}
            />
          )}
          <Figure
            label="เงินสด"
            value={cash ? (cashShown ? varianceLabel(cash.variance) : 'นับแล้ว') : '—'}
            loud={cashShown && cash !== null && cash.variance !== 0}
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

        <Section title="ทานที่ไหน">
          <Row label="กลับบ้าน" value={`${summary.ordersByType.TAKEAWAY} บิล`} />
          <Row label="ทานที่ร้าน" value={`${summary.ordersByType.DINE_IN} บิล`} />
        </Section>

        <Section title="ส่วนลด">
          {totals.discountsByReason.length === 0 ? (
            <Row label="ไม่มี" value="" />
          ) : (
            totals.discountsByReason.map((discount) => (
              <Row
                key={`${discount.reason}:${discount.label ?? ''}`}
                label={discountLabel(discount)}
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
                label={costs ? `${line.name} ${formatQty(line.qty, line.unit)}` : line.name}
                value={costs ? formatTHB(line.cost) : formatQty(line.qty, line.unit)}
              />
            ))
          )}
        </Section>

        {cash ? (
          <Section title="เงินสด">
            <Row label="เงินทอนเริ่มต้น" value={formatTHB(cash.openingFloat)} />
            {summary.drawerMovements.map((movement) => (
              <Row
                key={movement.id}
                label={`${movement.label}${movement.note ? ` · ${movement.note}` : ''}`}
                value={`${movement.direction === 'OUT' ? '−' : '+'}${formatTHB(movement.amount)}`}
              />
            ))}
            {cashShown ? <Row label="ควรมี" value={formatTHB(cash.expected)} /> : null}
            <Row label="นับได้" value={formatTHB(cash.counted)} />
            {cashShown ? <Row label="ผลต่าง" value={varianceLabel(cash.variance)} /> : null}
          </Section>
        ) : null}
      </ScreenBody>

      <ScreenFooter back={back}>
        {offerBackup ? (
          <div className="mb-3">
            <BackupFileButton label="สำรองข้อมูลวันนี้" backLabel="กลับไปสรุปวัน" />
          </div>
        ) : null}
      </ScreenFooter>
    </Screen>
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
