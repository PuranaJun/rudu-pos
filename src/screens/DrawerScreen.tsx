import { useState } from 'react';
import { Button, ChoiceChip } from '../components/Button.tsx';
import { Choice, NumberField, TextField } from '../components/form.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { useCashMovements, useExpectedCash } from '../db/hooks.ts';
import { recordCashMovement, voidCashMovement } from '../db/drawer-repo.ts';
import type { CashMovementReason, CashSession } from '../db/types.ts';
import {
  IN_REASONS,
  OUT_REASONS,
  QUICK_AMOUNTS,
  liveMovements,
  movementTotals,
  reasonTh,
} from '../domain/drawer.ts';
import { bangkokTime } from '../lib/datetime.ts';
import { bahtInput, formatTHB, parseBaht } from '../lib/money.ts';
import { problemsOf } from './settings/problems.ts';
import { useExpectedCashShown } from '../nav/owner-lock.ts';

type Direction = 'IN' | 'OUT';

const DIRECTIONS = [
  ['OUT', 'จ่ายออก'],
  ['IN', 'เอาเข้า'],
] as const;

/**
 * ลิ้นชัก — cash in and out of the drawer that is not a sale (domain/drawer.ts).
 *
 * The bag of ice paid from the till is the everyday case, so the screen opens
 * on จ่ายออก · ซื้อน้ำแข็ง and a one-tap amount: three taps and บันทึก. Off the
 * sell path, and not behind the owner's PIN — the drawer is the staff's to
 * keep straight (CLAUDE.md §6.7). A mistake is cancelled here, never deleted.
 */
export default function DrawerScreen({ session, back }: { session: CashSession; back: BackTo }) {
  const movements = useCashMovements(session);
  const expected = useExpectedCash(session);
  const cashShown = useExpectedCashShown();

  const [direction, setDirection] = useState<Direction>('OUT');
  const [reason, setReason] = useState<CashMovementReason>('ICE');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  // Phrases, each kept whole on a line: Thai has no spaces to break at, and a
  // phrase broken in two misreads at arm's length.
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const reasons = direction === 'OUT' ? OUT_REASONS : IN_REASONS;
  const live = movements ? liveMovements(session, movements) : [];
  const totals = movements ? movementTotals(session, movements) : { paidIn: 0, paidOut: 0 };

  function choose(next: Direction) {
    setDirection(next);
    setReason(next === 'OUT' ? OUT_REASONS[0]! : IN_REASONS[0]!);
    setSaved(null);
  }

  function save() {
    if (busy) return;
    setBusy(true);
    recordCashMovement(session, { direction, amount: parseBaht(amount), reason, note })
      .then((movement) => {
        setProblems([]);
        setAmount('');
        setNote('');
        setSaved([
          `${direction === 'OUT' ? 'จ่ายออก' : 'เอาเข้า'} ${formatTHB(movement.amount)}`,
          reasonTh(reason, direction),
        ]);
      })
      .catch((cause: unknown) => setProblems(problemsOf(cause)))
      .finally(() => setBusy(false));
  }

  return (
    <Screen
      title="ลิ้นชัก"
      subtitle={
        expected === undefined || !cashShown ? undefined : `ควรมีในลิ้นชัก ${formatTHB(expected)}`
      }
    >
      <ScreenBody>
        <p className="bg-paper-sunk mt-3 rounded-xl px-4 py-3 text-lg font-bold">
          <Phrases
            parts={[
              `เงินตั้งต้น ${formatTHB(session.opening_float)}`,
              `เอาเข้า ${formatTHB(totals.paidIn)}`,
              `จ่ายออก ${formatTHB(totals.paidOut)}`,
            ]}
          />
        </p>

        {live.length > 0 ? (
          <section aria-label="วันนี้" className="pt-4">
            <h2 className="border-line border-b pb-1 text-xl font-bold">วันนี้</h2>
            <ul>
              {live.map((movement) => {
                const label = reasonTh(movement.reason, movement.direction);
                const signed = `${movement.direction === 'OUT' ? '−' : '+'}${formatTHB(movement.amount)}`;
                return (
                  <li key={movement.id} className="border-line border-b py-2">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 text-lg font-bold">
                        {label}
                        <span className="text-ink-soft block text-base">
                          {bangkokTime(movement.created_at)}
                          {movement.note ? ` · ${movement.note}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xl font-bold tabular-nums">{signed}</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`ยกเลิก ${label} ${signed}`}
                        onClick={() => setCancelling(movement.id)}
                      >
                        ยกเลิก
                      </Button>
                    </div>
                    {cancelling === movement.id ? (
                      <div
                        role="group"
                        aria-label="ยืนยันยกเลิก"
                        className="border-expired mt-2 flex items-center gap-2 rounded-xl border-2 p-2"
                      >
                        <span className="min-w-0 flex-1 text-lg font-bold">บันทึกผิด ยกเลิก?</span>
                        <Button variant="secondary" size="sm" onClick={() => setCancelling(null)}>
                          ไม่
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => {
                            setCancelling(null);
                            voidCashMovement(movement.id).catch((cause: unknown) =>
                              setProblems(problemsOf(cause)),
                            );
                          }}
                        >
                          ยกเลิก
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section aria-label="บันทึกเงินเข้าออก" className="pt-6 pb-2">
          <Choice label="เงิน" value={direction} options={DIRECTIONS} onChange={choose} />
          <Choice
            label="เพื่อ"
            value={reason}
            options={reasons.map((entry) => [entry, reasonTh(entry, direction)] as const)}
            onChange={setReason}
          />
          <div className="mt-3" role="group" aria-label="จำนวนเร็ว">
            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((quick) => (
                <ChoiceChip
                  key={quick}
                  selected={parseBaht(amount) === quick}
                  onClick={() => setAmount(bahtInput(quick))}
                >
                  {formatTHB(quick)}
                </ChoiceChip>
              ))}
            </div>
          </div>
          <NumberField label="จำนวนเงิน" value={amount} onChange={setAmount} suffix="บาท" />
          <TextField label="หมายเหตุ (ถ้ามี)" value={note} onChange={setNote} />
        </section>
      </ScreenBody>

      <ScreenFooter back={back} primary={{ label: 'บันทึก', onClick: save, disabled: busy }}>
        {problems.length > 0 ? (
          <ul
            role="alert"
            className="bg-expired mb-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : saved ? (
          <p role="status" className="bg-paper-sunk mb-3 rounded-xl px-4 py-2 text-lg font-bold">
            <span aria-hidden="true">✓ </span>
            <Phrases parts={['บันทึกแล้ว', ...saved]} />
          </p>
        ) : null}
      </ScreenFooter>
    </Screen>
  );
}

/** Phrases joined by " · ", each one never broken across lines. */
function Phrases({ parts }: { parts: readonly string[] }) {
  return parts.map((part, index) => (
    <span key={part}>
      {index > 0 ? '\u00a0· ' : null}
      <span className="whitespace-nowrap">{part}</span>
    </span>
  ));
}
