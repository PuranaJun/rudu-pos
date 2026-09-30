import { useState } from 'react';
import ShelfBadge from '../components/ShelfBadge.tsx';
import { ChoiceChip } from '../components/Button.tsx';
import { buttonClass } from '../components/button.ts';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { formatTHB, toSatang } from '../lib/money.ts';
import { formatQty, unitLabel } from '../lib/quantity.ts';
import { bangkokShort } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import {
  THB_DENOMINATIONS,
  WASTE_REASONS,
  WASTE_REASON_TH,
  closingLines,
  countedFromDenominations,
  wasteCost,
  type CloseDecision,
  type CloseLine,
  type Decision,
} from '../domain/close-day.ts';
import { useCart, useCostCatalog, useExpectedCash, useStockSnapshot } from '../db/hooks.ts';
import { closeDay } from '../db/close-repo.ts';
import type { CashSession, WasteReason } from '../db/types.ts';

interface Props {
  session: CashSession;
  /** Leave without closing — nothing has been written yet. */
  back: BackTo;
  onClosed: (sessionId: string) => void;
}

/** What the operator changed on a line. Anything absent keeps the default. */
interface Override {
  counted?: string;
  decision?: Decision;
  reason?: WasteReason;
}

/**
 * Close day (CLAUDE.md §6.4). Waste is where this shop loses money, so this
 * gets the same care as the sell screen:
 *
 * - every line is already decided the way it usually goes — same-day things
 *   discarded, everything in date kept — so an ordinary evening is one tap;
 * - what a discard costs is shown on the button that makes it, in baht,
 *   while the operator is deciding, not in a report next week;
 * - the drawer is counted either as a total or note by note, and whatever
 *   the difference, it is recorded and the day still closes.
 *
 * Nothing is written until ปิดร้าน, and then all of it at once.
 */
export default function CloseDayScreen({ session, back, onClosed }: Props) {
  const catalog = useCostCatalog();
  const stock = useStockSnapshot();
  const cart = useCart();
  const expected = useExpectedCash(session);

  const [now] = useState(nowIso);
  const [step, setStep] = useState<'STOCK' | 'CASH'>('STOCK');
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [cashMode, setCashMode] = useState<'TOTAL' | 'NOTES'>('TOTAL');
  const [totalText, setTotalText] = useState('');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!catalog || !stock || !cart || expected === undefined) {
    return (
      <Screen title="ปิดร้าน" subtitle="ขั้นที่ 1 จาก 2 · ของที่เหลือ">
        <ScreenBody>
          <p className="py-6 text-lg font-bold">กำลังโหลด…</p>
        </ScreenBody>
        <ScreenFooter back={back} />
      </Screen>
    );
  }

  const lines = closingLines(catalog, stock, now);
  const rows = lines.map((line) => resolve(line, overrides[line.batch.id]));
  const totalWaste = rows.reduce((sum, row) => sum + row.waste, 0);
  const stockValid = rows.every((row) => row.valid);

  // Two batches of one component need telling apart; one does not.
  const perComponent = new Map<string, number>();
  for (const line of lines) {
    perComponent.set(line.component.id, (perComponent.get(line.component.id) ?? 0) + 1);
  }

  const counted = countedCash(cashMode, totalText, notes);
  const variance = counted === null ? null : counted - expected;
  const cashSales = expected - session.opening_float;

  const change = (batchId: string, patch: Override) =>
    setOverrides((current) => ({ ...current, [batchId]: { ...current[batchId], ...patch } }));

  function close() {
    if (busy || counted === null || !stockValid) return;
    setBusy(true);
    setError(null);

    const decisions: CloseDecision[] = rows.map((row) => ({
      batchId: row.line.batch.id,
      counted: row.counted,
      decision: row.decision,
      reason: row.reason,
    }));

    closeDay(
      { sessionId: session.id, decisions, countedCash: counted, note: note.trim() || null },
      catalog!,
    )
      .then(() => onClosed(session.id))
      .catch((cause: unknown) => {
        setBusy(false);
        setError(`ปิดร้านไม่สำเร็จ: ${String(cause)}`);
      });
  }

  return (
    <Screen
      title="ปิดร้าน"
      subtitle={step === 'STOCK' ? 'ขั้นที่ 1 จาก 2 · ของที่เหลือ' : 'ขั้นที่ 2 จาก 2 · นับเงิน'}
    >
      <ScreenBody>
        {step === 'STOCK' ? (
          lines.length === 0 ? (
            <p className="py-6 text-lg font-bold">ไม่มีของเหลือ</p>
          ) : (
            <ul aria-label="ของที่เหลือ">
              {rows.map((row) => {
                const { line } = row;
                const name =
                  (perComponent.get(line.component.id) ?? 0) > 1
                    ? `${line.component.name_th} · ทำ ${bangkokShort(line.batch.made_at)}`
                    : line.component.name_th;

                return (
                  <li key={line.batch.id} className="border-line border-b py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xl leading-snug font-bold">
                          {name}
                          {line.batch.state === 'CUT' ? ' (ตัดแล้ว)' : ''}
                          {line.batch.state === 'SLAB' ? ' (ยังไม่ตัด)' : ''}
                        </p>
                        <div className="mt-1">
                          <ShelfBadge status={line.status} expiresAt={line.batch.expires_at} />
                        </div>
                      </div>

                      {editing === line.batch.id ? (
                        <label className="border-ink-soft field-focus flex w-32 shrink-0 items-center rounded-xl border-2 px-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            aria-label={`เหลือจริง ${name}`}
                            value={overrides[line.batch.id]?.counted ?? String(row.counted)}
                            onChange={(event) =>
                              change(line.batch.id, { counted: event.target.value })
                            }
                            onBlur={() => setEditing(null)}
                            autoFocus
                            className="min-h-touch w-full min-w-0 bg-transparent text-xl font-bold tabular-nums outline-none"
                          />
                          <span className="text-lg font-bold">
                            {unitLabel(line.component.unit)}
                          </span>
                        </label>
                      ) : (
                        // A number that edits says so: "แก้" beside it.
                        <button
                          type="button"
                          aria-label={`แก้จำนวน ${name}`}
                          onClick={() => setEditing(line.batch.id)}
                          className={`${buttonClass('secondary', 'sm')} shrink-0 tabular-nums`}
                        >
                          {row.valid ? formatQty(row.counted, line.component.unit) : '—'}
                          <span className="text-ink-soft text-lg"> แก้</span>
                        </button>
                      )}
                    </div>

                    <div
                      className="mt-2 flex gap-2"
                      role="group"
                      aria-label={`${name} เก็บหรือทิ้ง`}
                    >
                      <ChoiceChip
                        selected={row.decision === 'CARRY'}
                        tone="keep"
                        size="md"
                        onClick={() => change(line.batch.id, { decision: 'CARRY' })}
                        className="flex-1"
                      >
                        เก็บไว้
                      </ChoiceChip>
                      <ChoiceChip
                        selected={row.decision === 'DISCARD'}
                        tone="discard"
                        size="md"
                        onClick={() => change(line.batch.id, { decision: 'DISCARD' })}
                        className="flex-1"
                      >
                        ทิ้ง {formatTHB(row.valid ? wasteCost(line.component, row.counted) : 0)}
                      </ChoiceChip>
                    </div>

                    {row.decision === 'DISCARD' ? (
                      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="เหตุผล">
                        {WASTE_REASONS.map((reason) => (
                          <ChoiceChip
                            key={reason}
                            selected={row.reason === reason}
                            onClick={() => change(line.batch.id, { reason })}
                          >
                            {WASTE_REASON_TH[reason]}
                          </ChoiceChip>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <section aria-label="นับเงิน" className="pt-4">
            <dl className="text-lg font-bold">
              <div className="flex justify-between">
                <dt>เงินทอนเริ่มต้น</dt>
                <dd className="tabular-nums">{formatTHB(session.opening_float)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>ขายเงินสด</dt>
                <dd className="tabular-nums">{formatTHB(cashSales)}</dd>
              </div>
              <div className="flex items-baseline justify-between text-2xl font-bold">
                <dt>ควรมี</dt>
                <dd className="tabular-nums">{formatTHB(expected)}</dd>
              </div>
            </dl>

            <div className="mt-4 flex gap-2" role="group" aria-label="วิธีนับ">
              {(
                [
                  ['TOTAL', 'ยอดรวม'],
                  ['NOTES', 'นับทีละใบ'],
                ] as const
              ).map(([mode, label]) => (
                <ChoiceChip
                  key={mode}
                  selected={cashMode === mode}
                  size="md"
                  onClick={() => setCashMode(mode)}
                  className="flex-1"
                >
                  {label}
                </ChoiceChip>
              ))}
            </div>

            {cashMode === 'TOTAL' ? (
              <label className="border-ink-soft field-focus mt-3 flex items-center rounded-xl border-2 px-3">
                <span className="text-2xl font-bold">฿</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label="เงินที่นับได้ (บาท)"
                  value={totalText}
                  onChange={(event) => setTotalText(event.target.value)}
                  className="min-h-touch-lg w-full min-w-0 bg-transparent text-3xl font-bold tabular-nums outline-none"
                />
              </label>
            ) : (
              <ul className="mt-3">
                {THB_DENOMINATIONS.map((denomination) => {
                  const count = Number(notes[denomination] ?? '');
                  return (
                    <li key={denomination} className="flex items-center gap-3 py-1">
                      <span className="w-20 text-xl font-bold tabular-nums">
                        {formatTHB(denomination)}
                      </span>
                      <span className="text-lg font-bold">×</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`จำนวน ${formatTHB(denomination)}`}
                        value={notes[denomination] ?? ''}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [denomination]: event.target.value,
                          }))
                        }
                        className="border-ink-soft min-h-touch w-20 rounded-xl border-2 px-2 text-xl font-bold tabular-nums"
                      />
                      <span className="ml-auto text-lg font-bold tabular-nums">
                        {Number.isFinite(count) && count > 0 ? formatTHB(count * denomination) : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <div
              role="status"
              aria-label="ผลต่าง"
              className={`mt-4 rounded-xl px-4 py-3 ${
                variance === null
                  ? 'border-ink-soft border-2 border-dashed'
                  : variance === 0
                    ? 'bg-brand-2 text-white'
                    : 'bg-today'
              }`}
            >
              <p className="text-lg font-bold">
                นับได้ {counted === null ? '—' : formatTHB(counted)}
              </p>
              <p className="text-3xl font-bold">
                {variance === null
                  ? 'ยังไม่ได้นับ'
                  : variance === 0
                    ? 'ตรง'
                    : variance < 0
                      ? `ขาด ${formatTHB(-variance)}`
                      : `เกิน ${formatTHB(variance)}`}
              </p>
            </div>

            <label className="mt-4 block">
              <span className="text-lg font-bold">หมายเหตุ</span>
              <input
                type="text"
                aria-label="หมายเหตุ"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className="border-ink-soft min-h-touch mt-1 w-full rounded-xl border-2 px-3 text-lg"
              />
            </label>

            {cart.length > 0 ? (
              <p role="alert" className="bg-today mt-4 rounded-xl px-4 py-3 text-lg font-bold">
                ยังมี {cart.length} รายการค้างในตะกร้า — จะยังอยู่ตอนเปิดร้านครั้งหน้า
              </p>
            ) : null}
          </section>
        )}
      </ScreenBody>

      {step === 'STOCK' ? (
        <ScreenFooter
          back={back}
          primary={{
            label: 'ต่อไป: นับเงิน',
            disabled: !stockValid,
            onClick: () => {
              setEditing(null);
              setStep('CASH');
            },
          }}
        >
          <p
            className={`mb-3 rounded-lg px-3 py-1 text-xl font-bold ${totalWaste > 0 ? 'bg-today' : ''}`}
          >
            ทิ้งรวม {formatTHB(totalWaste)}
          </p>
        </ScreenFooter>
      ) : (
        <ScreenFooter
          back={{ label: 'กลับไปขั้น 1', onClick: () => setStep('STOCK') }}
          primary={{ label: 'ยืนยันปิดร้าน', disabled: counted === null || busy, onClick: close }}
        >
          {error ? (
            <p
              role="alert"
              className="bg-expired mb-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
            >
              {error}
            </p>
          ) : null}
        </ScreenFooter>
      )}
    </Screen>
  );
}

interface Row {
  line: CloseLine;
  counted: number;
  valid: boolean;
  decision: Decision;
  reason: WasteReason;
  /** What discarding this costs, in satang. Zero when it is kept. */
  waste: number;
}

/** A line with the operator's changes applied over its defaults. */
function resolve(line: CloseLine, override: Override | undefined): Row {
  // The ledger's own figure unless the operator typed one: a default that
  // passed through a text box could pick up a rounding and write a spurious
  // adjustment.
  const typed = override?.counted;
  const counted = typed === undefined ? Math.max(0, line.remaining) : Number(typed);
  const valid =
    (typed === undefined || typed.trim() !== '') && Number.isFinite(counted) && counted >= 0;
  const decision = override?.decision ?? line.decision;

  return {
    line,
    counted,
    valid,
    decision,
    reason: override?.reason ?? line.reason,
    waste: decision === 'DISCARD' && valid ? wasteCost(line.component, counted) : 0,
  };
}

/** The drawer count, or null until something has been entered. */
function countedCash(
  mode: 'TOTAL' | 'NOTES',
  totalText: string,
  notes: Record<number, string>,
): number | null {
  if (mode === 'TOTAL') {
    const baht = Number(totalText);
    return totalText.trim() !== '' && Number.isFinite(baht) && baht >= 0 ? toSatang(baht) : null;
  }

  const counts = new Map<number, number>();
  let any = false;
  for (const denomination of THB_DENOMINATIONS) {
    const text = notes[denomination]?.trim() ?? '';
    if (text === '') continue;
    const count = Number(text);
    if (!Number.isInteger(count) || count < 0) return null;
    counts.set(denomination, count);
    any = true;
  }
  return any ? countedFromDenominations(counts) : null;
}
