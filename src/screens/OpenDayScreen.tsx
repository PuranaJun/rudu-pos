import { useState } from 'react';
import VersionStamp from '../components/VersionStamp.tsx';
import PrepBanner from '../components/PrepBanner.tsx';
import ProductionScreen from './ProductionScreen.tsx';
import { prepReminders } from '../domain/production.ts';
import { formatTHB, toSatang } from '../lib/money.ts';
import { formatQty, unitLabel } from '../lib/quantity.ts';
import { bangkokShort, bangkokWeekday } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import { unitPrice } from '../domain/cost.ts';
import {
  jellyToCut,
  missingComponents,
  stockOnHand,
  type BatchOnHand,
  type JellyToCut,
  type ShelfStatus,
} from '../domain/open-day.ts';
import { useCostCatalog, useLastOperator, useSettings, useStockSnapshot } from '../db/hooks.ts';
import { adjustBatch, commitCut } from '../db/stock-repo.ts';
import { openSession } from '../db/session-repo.ts';
import type { Component } from '../db/types.ts';

/**
 * Open day (CLAUDE.md §6.2).
 *
 * One screen, one button. On a day where nothing changed the operator taps
 * เปิดร้าน and is selling: the operator, the float and the batches are all
 * already right. The one thing that cannot be waved through is jelly still in
 * the tray — its drinks are not sellable until it is cut, and finding that out
 * from the first customer is too late.
 *
 * Nothing here polls or ticks. Shelf life is judged against the moment the
 * screen opened, which is close enough for a screen that lives a minute.
 */
export default function OpenDayScreen() {
  const catalog = useCostCatalog();
  const stock = useStockSnapshot();
  const settings = useSettings();
  const lastOperator = useLastOperator();

  const [now] = useState(nowIso);
  const [operator, setOperator] = useState<string | null>(null);
  const [openingFloat, setOpeningFloat] = useState<number | null>(null);
  const [rainyDay, setRainyDay] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProduction, setShowProduction] = useState(false);

  if (!catalog || !stock || !settings || lastOperator === undefined) {
    return (
      <div className="text-ink flex h-full items-center justify-center bg-white">
        <p className="text-2xl font-bold">กำลังโหลด…</p>
      </div>
    );
  }

  const operators = settings.operators;
  const chosenOperator =
    operator ??
    (lastOperator !== null && operators.includes(lastOperator) ? lastOperator : operators[0]) ??
    '';
  const float = openingFloat ?? settings.openingFloat;

  const jelly = jellyToCut(catalog, stock, now);
  const mustCut = jelly.filter((entry) => entry.mustCut);
  const onHand = stockOnHand(catalog, stock, now);
  const missing = missingComponents(catalog, stock);
  const reminders = prepReminders(catalog, stock, now);

  const rainyVariant = settings.rainyDayVariantId
    ? catalog.variants.get(settings.rainyDayVariantId)
    : undefined;
  const rainyPrice = rainyVariant ? unitPrice(catalog, rainyVariant.id) : 0;

  const report = (what: string) => (cause: unknown) => setError(`${what}: ${String(cause)}`);

  function open() {
    if (opening || mustCut.length > 0) return;
    setOpening(true);
    // The live query on the open session takes the app to the sell screen.
    openSession({ operatorId: chosenOperator, openingFloat: float, rainyDay }).catch(
      (cause: unknown) => {
        setOpening(false);
        report('เปิดร้านไม่สำเร็จ')(cause);
      },
    );
  }

  return (
    <div className="safe-x text-ink flex h-full flex-col bg-white">
      <header className="safe-top border-line flex items-start justify-between gap-3 border-b px-4 pb-2">
        <div>
          <h1 className="text-3xl font-bold">เปิดร้าน</h1>
          <p className="text-ink-soft text-lg font-semibold">{bangkokWeekday(now)}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowProduction(true)}
          className="border-line min-h-touch rounded-xl border-2 px-4 text-lg font-bold"
        >
          ผลิต
        </button>
      </header>

      <PrepBanner reminders={reminders} onTap={() => setShowProduction(true)} />

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {jelly.length > 0 ? (
          <section aria-label="ตัดเยลลี่วันนี้" className="pt-4">
            <h2 className="text-2xl font-bold">ตัดเยลลี่วันนี้</h2>
            {jelly.map((entry) => (
              <JellyCard
                key={entry.component.id}
                entry={entry}
                onCut={(batchId, grams) =>
                  void commitCut(catalog, batchId, grams).catch(report('ตัดไม่สำเร็จ'))
                }
              />
            ))}
          </section>
        ) : null}

        <section aria-label="คนขายวันนี้" className="pt-4">
          <h2 className="text-2xl font-bold">คนขายวันนี้</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {operators.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={name === chosenOperator}
                onClick={() => setOperator(name)}
                className={`min-h-touch-lg rounded-xl border-2 px-5 text-xl font-bold ${
                  name === chosenOperator ? 'bg-ink border-ink text-white' : 'border-line'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </section>

        <section aria-label="เงินทอนเริ่มต้น" className="pt-4">
          <h2 className="text-2xl font-bold">เงินทอนเริ่มต้น</h2>
          <FloatEditor value={float} onChange={setOpeningFloat} />
        </section>

        {rainyVariant ? (
          <section aria-label="โปรวันฝนตก" className="pt-4">
            <button
              type="button"
              aria-pressed={rainyDay}
              onClick={() => setRainyDay((on) => !on)}
              className={`min-h-touch-lg flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left ${
                rainyDay ? 'bg-ink border-ink text-white' : 'border-line'
              }`}
            >
              <span>
                <span className="block text-xl font-bold">โปรวันฝนตก</span>
                <span className="block text-lg font-semibold">
                  {rainyVariant.name_th} {formatTHB(rainyPrice)} →{' '}
                  {formatTHB(rainyPrice - settings.rainyDayAmount)}
                </span>
              </span>
              <span className="shrink-0 text-xl font-bold">{rainyDay ? 'เปิด' : 'ปิด'}</span>
            </button>
          </section>
        ) : null}

        <section aria-label="ของที่มี" className="pt-4">
          <h2 className="text-2xl font-bold">ของที่มี</h2>

          {missing.length > 0 ? (
            <div className="bg-today mt-2 rounded-xl px-4 py-3">
              <p className="text-xl font-bold">ไม่มีของพร้อมขาย</p>
              <p className="text-lg font-semibold">
                {missing.map((component) => component.name_th).join(' · ')}
              </p>
            </div>
          ) : null}

          <ul>
            {onHand.map((entry) => (
              <li key={entry.component.id} className="border-line border-b py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xl font-bold">{entry.component.name_th}</p>
                  {entry.batches.length > 1 ? (
                    <p className="text-lg font-bold tabular-nums">
                      รวม {formatQty(entry.total, entry.component.unit)}
                    </p>
                  ) : null}
                </div>
                {entry.batches.map((batch) => (
                  <BatchRow
                    key={batch.batch.id}
                    component={entry.component}
                    entry={batch}
                    onAdjust={(counted) =>
                      void adjustBatch(batch.batch.id, counted).catch(report('แก้จำนวนไม่สำเร็จ'))
                    }
                  />
                ))}
              </li>
            ))}
          </ul>
        </section>

        {error ? (
          <p role="alert" className="pt-4 text-lg font-bold">
            {error}
          </p>
        ) : null}
      </main>

      <footer className="safe-bottom border-line border-t px-4 pt-3">
        {mustCut.length > 0 ? (
          <p className="mb-2 text-lg font-bold">
            ต้องตัด{mustCut.map((entry) => entry.component.name_th).join(' และ ')}ก่อนเปิดร้าน
          </p>
        ) : null}
        <button
          type="button"
          onClick={open}
          disabled={opening || mustCut.length > 0}
          className="bg-brand-2 disabled:bg-paper-sunk disabled:text-ink disabled:border-line min-h-touch-lg w-full rounded-2xl border-2 border-transparent py-4 text-2xl font-bold text-white"
        >
          เปิดร้าน
        </button>
        <div className="mt-1 flex justify-center">
          <VersionStamp />
        </div>
      </footer>

      {showProduction ? <ProductionScreen onClose={() => setShowProduction(false)} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- the float

/** The float as one big number. Accepting it is the เปิดร้าน tap itself. */
function FloatEditor({ value, onChange }: { value: number; onChange: (satang: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const baht = Number(editing);
  const valid = editing !== null && editing.trim() !== '' && Number.isFinite(baht) && baht >= 0;

  if (editing === null) {
    return (
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-4xl font-bold tabular-nums">{formatTHB(value)}</p>
        <button
          type="button"
          aria-label="แก้เงินทอนเริ่มต้น"
          onClick={() => setEditing(String(value / 100))}
          className="border-line min-h-touch rounded-xl border-2 px-5 text-xl font-bold"
        >
          แก้
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex gap-2">
      <label className="border-line flex min-w-0 flex-1 items-center rounded-xl border-2 px-3">
        <span className="text-2xl font-bold">฿</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="เงินทอนเริ่มต้น (บาท)"
          value={editing}
          onChange={(event) => setEditing(event.target.value)}
          autoFocus
          className="min-h-touch-lg w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums outline-none"
        />
      </label>
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          onChange(toSatang(baht));
          setEditing(null);
        }}
        className="bg-brand-2 min-h-touch-lg shrink-0 rounded-xl px-4 text-xl font-bold text-white disabled:opacity-40"
      >
        ตกลง
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- the jelly

function JellyCard({
  entry,
  onCut,
}: {
  entry: JellyToCut;
  onCut: (batchId: string, grams: number) => void;
}) {
  const drinks = entry.blockedVariants.map((variant) => variant.name_th).join(' · ');

  return (
    <div className="border-line mt-2 rounded-xl border-2 p-3">
      <p className="text-xl font-bold">{entry.component.name_th}</p>

      {entry.mustCut ? (
        // Said in words, not implied by a greyed button: the drink cannot be
        // sold until this is done.
        <p
          role="alert"
          className="bg-expired mt-2 rounded-lg px-3 py-2 text-lg font-bold text-white"
        >
          ยังไม่ได้ตัด — {drinks} ขายไม่ได้
        </p>
      ) : entry.cutRemaining > 0 ? (
        <p className="mt-2 text-lg font-bold">
          ตัดแล้ว {formatQty(entry.cutRemaining, entry.component.unit)} — {drinks} ขายได้
        </p>
      ) : null}

      {entry.slabs.map((slab) => (
        <SlabCutter
          // Remount when the slab shrinks, so the default is always "the rest of it".
          key={`${slab.batch.id}:${slab.remaining}`}
          component={entry.component}
          slab={slab}
          onCut={(grams) => onCut(slab.batch.id, grams)}
        />
      ))}
    </div>
  );
}

function SlabCutter({
  component,
  slab,
  onCut,
}: {
  component: Component;
  slab: BatchOnHand;
  onCut: (grams: number) => void;
}) {
  const [grams, setGrams] = useState(String(Math.round(slab.remaining)));
  const value = Number(grams);
  const valid = grams.trim() !== '' && Number.isFinite(value) && value > 0;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">
          ในถาด {formatQty(slab.remaining, component.unit)}
        </span>
        <ShelfBadge status={slab.status} expiresAt={slab.expiresAt} />
      </div>
      <div className="mt-2 flex gap-2">
        <label className="border-line flex min-w-0 flex-1 items-center rounded-xl border-2 px-3">
          <input
            type="text"
            inputMode="numeric"
            aria-label={`กรัมที่ตัด ${component.name_th}`}
            value={grams}
            onChange={(event) => setGrams(event.target.value)}
            className="min-h-touch-lg w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums outline-none"
          />
          <span className="text-xl font-bold">{unitLabel(component.unit)}</span>
        </label>
        <button
          type="button"
          disabled={!valid}
          onClick={() => onCut(value)}
          className="bg-brand min-h-touch-lg shrink-0 rounded-xl px-5 text-xl font-bold text-white disabled:opacity-40"
        >
          ตัด {valid ? formatQty(value, component.unit) : ''}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- the batches

function BatchRow({
  component,
  entry,
  onAdjust,
}: {
  component: Component;
  entry: BatchOnHand;
  onAdjust: (counted: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const value = Number(editing);
  const valid = editing !== null && editing.trim() !== '' && Number.isFinite(value) && value >= 0;

  if (editing !== null) {
    return (
      <div className="mt-2 flex gap-2">
        <label className="border-line flex min-w-0 flex-1 items-center rounded-xl border-2 px-3">
          <input
            type="text"
            inputMode="numeric"
            aria-label={`จำนวนที่เหลือ ${component.name_th}`}
            value={editing}
            onChange={(event) => setEditing(event.target.value)}
            autoFocus
            className="min-h-touch-lg w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums outline-none"
          />
          <span className="text-xl font-bold">{unitLabel(component.unit)}</span>
        </label>
        <button
          type="button"
          disabled={!valid}
          onClick={() => {
            onAdjust(value);
            setEditing(null);
          }}
          className="bg-brand-2 min-h-touch-lg shrink-0 rounded-xl px-4 text-xl font-bold text-white disabled:opacity-40"
        >
          บันทึก
        </button>
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="border-line min-h-touch-lg shrink-0 rounded-xl border-2 px-4 text-xl font-bold"
        >
          ยกเลิก
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <ShelfBadge status={entry.status} expiresAt={entry.expiresAt} />
      <button
        type="button"
        aria-label={`แก้จำนวน ${component.name_th}`}
        onClick={() => setEditing(String(Math.round(entry.remaining)))}
        className="border-line min-h-touch rounded-xl border-2 px-4 text-xl font-bold tabular-nums"
      >
        {formatQty(entry.remaining, component.unit)}
      </button>
    </div>
  );
}

const SHELF_STYLE: Record<ShelfStatus, string> = {
  EXPIRED: 'bg-expired text-white',
  TODAY: 'bg-today text-ink',
  OK: 'border-fresh text-fresh border-2',
};

function ShelfBadge({ status, expiresAt }: { status: ShelfStatus; expiresAt: string }) {
  const label = {
    EXPIRED: `หมดอายุแล้ว ${bangkokShort(expiresAt)}`,
    TODAY: `หมดอายุวันนี้ ${bangkokShort(expiresAt)}`,
    OK: `ถึง ${bangkokShort(expiresAt)}`,
  }[status];

  return (
    <span className={`rounded-lg px-3 py-1 text-base font-bold ${SHELF_STYLE[status]}`}>
      {label}
    </span>
  );
}
