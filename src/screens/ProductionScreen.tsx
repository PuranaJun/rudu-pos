import { useState } from 'react';
import PrepBanner from '../components/PrepBanner.tsx';
import { Button, ChoiceChip } from '../components/Button.tsx';
import { buttonClass } from '../components/button.ts';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { formatQty, unitLabel } from '../lib/quantity.ts';
import { bangkokShort, formatSpan, fromBangkokInput, toBangkokInput } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import {
  batchList,
  clocksFor,
  prepReminders,
  sourceOptions,
  sourceQtyFor,
  type BatchListEntry,
} from '../domain/production.ts';
import type { CostCatalog } from '../domain/cost.ts';
import type { StockSnapshot } from '../domain/stock.ts';
import { useCostCatalog, useStockSnapshot } from '../db/hooks.ts';
import { blanchBatch, recordProduction } from '../db/stock-repo.ts';
import type { BatchState, Component } from '../db/types.ts';

const STATE_TH: Record<BatchState, string> = {
  STEEPING: 'กำลังแช่',
  SOAKING: 'กำลังแช่',
  BLANCHED: 'ลวกแล้ว',
  SLAB: 'ยังไม่ตัด',
  CUT: 'ตัดแล้ว',
  READY: 'พร้อม',
  EXPIRED: 'หมดอายุ',
  DISCARDED: 'ทิ้งแล้ว',
};

/**
 * Recording a production batch (CLAUDE.md §6.3) — mostly done the evening
 * before, at home, on the same phone. Pick what was made, confirm the amount
 * and the time, and the clocks work themselves out from the catalog.
 *
 * Opened over whichever home screen is showing; nothing about it is on the
 * path of a sale.
 */
export default function ProductionScreen({ back }: { back: BackTo }) {
  const catalog = useCostCatalog();
  const stock = useStockSnapshot();

  // Read once, and again after each write. Nothing ticks.
  const [now, setNow] = useState(nowIso);
  const [making, setMaking] = useState<Component | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!catalog || !stock) {
    return (
      <Screen title="ผลิต">
        <ScreenBody>
          <p className="py-6 text-lg font-bold">กำลังโหลด…</p>
        </ScreenBody>
        <ScreenFooter back={back} />
      </Screen>
    );
  }

  const components = [...catalog.components.values()]
    .filter((component) => component.is_batch_tracked)
    .sort((a, b) => a.sort_order - b.sort_order);
  const batches = batchList(catalog, stock, now);
  const reminders = prepReminders(catalog, stock, now);

  if (making) {
    // Recording a batch is its own step, with its own way out — the list's
    // back button never disappears from under the operator.
    return (
      <Screen title={`ทำ${making.name_th}`} subtitle="ผลิต · บันทึกของที่ทำ">
        <NewBatchForm
          key={making.id}
          catalog={catalog}
          stock={stock}
          component={making}
          error={error}
          onCancel={() => {
            setError(null);
            setMaking(null);
          }}
          onRecord={(input) => {
            setError(null);
            recordProduction(making, input)
              .then(() => {
                setSaved(`บันทึก${making.name_th} ${formatQty(input.qty, making.unit)} แล้ว`);
                setMaking(null);
                setNow(nowIso());
              })
              .catch((cause: unknown) => setError(`บันทึกไม่สำเร็จ: ${String(cause)}`));
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen title="ผลิต">
      <ScreenBody flush>
        <PrepBanner
          reminders={reminders}
          actionLabel="บันทึกเลย ›"
          onTap={() => {
            setSaved(null);
            setMaking(reminders[0]?.component ?? null);
          }}
        />

        <div className="px-4">
          {saved ? (
            <p role="status" className="bg-paper-sunk mt-3 rounded-xl px-4 py-3 text-lg font-bold">
              <span aria-hidden="true">✓ </span>
              {saved}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="bg-expired mt-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
            >
              {error}
            </p>
          ) : null}

          <section aria-label="ทำใหม่" className="pt-4">
            <h2 className="text-2xl font-bold">ทำใหม่</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {components.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  onClick={() => {
                    setSaved(null);
                    setMaking(component);
                  }}
                  className={`${buttonClass('secondary', 'md')} py-2 text-left`}
                >
                  {component.name_th}
                </button>
              ))}
            </div>
          </section>

          <section aria-label="ของที่ทำไว้" className="pt-6">
            <h2 className="text-2xl font-bold">ของที่ทำไว้</h2>
            {batches.length === 0 ? (
              <p className="text-ink-soft py-4 text-lg font-bold">ยังไม่มี</p>
            ) : (
              <ul>
                {batches.map((entry) => (
                  <BatchListRow
                    key={entry.batch.id}
                    entry={entry}
                    onBlanch={() => {
                      blanchBatch(entry.batch.id)
                        .then(() => setNow(nowIso()))
                        .catch((cause: unknown) => setError(`บันทึกไม่สำเร็จ: ${String(cause)}`));
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScreenBody>

      <ScreenFooter back={back} />
    </Screen>
  );
}

// ---------------------------------------------------------------- the form

interface NewBatch {
  qty: number;
  madeAt: string;
  sourceBatchId: string | null;
}

function NewBatchForm({
  catalog,
  stock,
  component,
  error,
  onCancel,
  onRecord,
}: {
  catalog: CostCatalog;
  stock: StockSnapshot;
  component: Component;
  error: string | null;
  onCancel: () => void;
  onRecord: (input: NewBatch) => void;
}) {
  const [qtyText, setQtyText] = useState(String(component.default_batch_qty ?? ''));
  const [madeAtText, setMadeAtText] = useState(() => toBangkokInput(nowIso()));
  const [pickedSource, setPickedSource] = useState<string | null>(null);

  const qty = Number(qtyText);
  const qtyValid = qtyText.trim() !== '' && Number.isFinite(qty) && qty > 0;
  const madeAt = fromBangkokInput(madeAtText);

  const source = component.source_component_id
    ? catalog.components.get(component.source_component_id)
    : undefined;
  const sourceNeeded = qtyValid ? sourceQtyFor(component, qty) : null;
  const options =
    source && madeAt ? sourceOptions(catalog, stock, component, qtyValid ? qty : 0, madeAt) : [];
  const chosen = options.find((option) => option.batch.id === pickedSource) ?? options[0] ?? null;

  const clocks = madeAt ? clocksFor(component, madeAt) : null;
  const canRecord = qtyValid && madeAt !== null && (!source || chosen !== null);

  return (
    <>
      <ScreenBody>
        {component.recipe_note_th ? (
          // A reminder, not a form field: the recipe is edited in settings.
          <p className="bg-paper-sunk mt-3 rounded-xl px-4 py-3 text-lg leading-relaxed font-bold">
            {component.recipe_note_th}
          </p>
        ) : null}

        <label className="mt-4 block">
          <span className="text-xl font-bold">จำนวนที่ทำ</span>
          <span className="border-ink-soft field-focus mt-1 flex items-center rounded-xl border-2 px-3">
            <input
              type="text"
              inputMode="numeric"
              aria-label="จำนวนที่ทำ"
              value={qtyText}
              onChange={(event) => setQtyText(event.target.value)}
              className="min-h-touch-lg w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums outline-none"
            />
            <span className="text-xl font-bold">{unitLabel(component.unit)}</span>
          </span>
        </label>

        <label className="mt-4 block">
          <span className="text-xl font-bold">เวลาที่ทำ</span>
          <input
            type="datetime-local"
            aria-label="เวลาที่ทำ"
            value={madeAtText}
            onChange={(event) => setMadeAtText(event.target.value)}
            className="border-ink-soft min-h-touch-lg mt-1 w-full rounded-xl border-2 bg-transparent px-3 text-xl font-bold"
          />
        </label>

        {clocks ? (
          <p className="mt-3 text-lg font-bold">
            {STATE_TH[clocks.state]}
            {clocks.ready_at !== madeAt ? ` · พร้อม ${bangkokShort(clocks.ready_at)}` : ''}
            {component.shelf_life_hours !== null
              ? ` · หมดอายุ ${bangkokShort(clocks.expires_at)}`
              : ''}
          </p>
        ) : null}

        {source ? (
          <div className="mt-4">
            <p className="text-xl font-bold">
              ใช้{source.name_th}
              {sourceNeeded !== null ? ` ${formatQty(sourceNeeded, source.unit)}` : ''} จากถัง
            </p>

            {options.length === 0 ? (
              <p
                role="alert"
                className="bg-expired mt-2 rounded-lg px-3 py-2 text-lg font-bold text-white"
              >
                ไม่มี{source.name_th}พร้อมใช้ — บันทึก{source.name_th}ก่อน
              </p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {options.map((option) => (
                  <ChoiceChip
                    key={option.batch.id}
                    selected={option.batch.id === chosen?.batch.id}
                    size="md"
                    onClick={() => setPickedSource(option.batch.id)}
                    align="start"
                    className="py-2"
                  >
                    ทำ {bangkokShort(option.batch.made_at)} · เหลือ{' '}
                    {formatQty(option.remaining, source.unit)}
                  </ChoiceChip>
                ))}
              </div>
            )}

            {chosen && !chosen.enough && sourceNeeded !== null ? (
              // Warn, never block: the jelly was made, and the ledger should
              // say where its tea came from even if the count was off.
              <p role="alert" className="bg-today mt-2 rounded-lg px-3 py-2 text-lg font-bold">
                ถังนี้เหลือ {formatQty(chosen.remaining, source.unit)} — ไม่ถึง{' '}
                {formatQty(sourceNeeded, source.unit)}
              </p>
            ) : null}
          </div>
        ) : null}
      </ScreenBody>

      {/* In thumb reach however long the recipe note runs. ยกเลิก: nothing is recorded. */}
      <ScreenFooter
        back={{ label: 'ยกเลิก', onClick: onCancel }}
        primary={{
          label: 'บันทึก',
          disabled: !canRecord,
          onClick: () => {
            if (!canRecord || !madeAt) return;
            onRecord({ qty, madeAt, sourceBatchId: chosen?.batch.id ?? null });
          },
        }}
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
    </>
  );
}

// ------------------------------------------------------------ the list

function BatchListRow({ entry, onBlanch }: { entry: BatchListEntry; onBlanch: () => void }) {
  const { component, batch, state } = entry;

  return (
    <li className="border-line border-b py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xl font-bold">{component.name_th}</p>
        <p className="text-xl font-bold tabular-nums">
          {formatQty(entry.remaining, component.unit)}
        </p>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2">
        {/* A state, not a button: filled and flat, no edge to press. */}
        <span className="bg-paper-sunk rounded-lg px-2 text-base font-bold">{STATE_TH[state]}</span>
        <Clock entry={entry} />
        <span className="text-ink-soft text-base font-bold">ทำ {bangkokShort(batch.made_at)}</span>
      </div>

      {state === 'SOAKING' ? (
        <Button
          variant="primary"
          size="sm"
          onClick={onBlanch}
          aria-label={`ลวกแล้ว ${component.name_th}`}
          className="mt-2"
        >
          ลวกแล้ว
        </Button>
      ) : null}
    </li>
  );
}

/** "พร้อมใน 6 ชม." while it waits, "เหลือ 1 วัน" after — loud once it is the last day. */
function Clock({ entry }: { entry: BatchListEntry }) {
  if (entry.readyInMs !== null) {
    const label =
      entry.state === 'SOAKING'
        ? entry.readyInMs > 0
          ? `ลวกได้ใน ${formatSpan(entry.readyInMs, 'up')}`
          : 'ลวกได้แล้ว'
        : `พร้อมใน ${formatSpan(entry.readyInMs, 'up')}`;
    return <span className="text-lg font-bold">{label}</span>;
  }

  if (entry.status === 'EXPIRED') {
    return (
      <span className="bg-expired rounded-lg px-2 text-lg font-bold text-white">หมดอายุแล้ว</span>
    );
  }

  return (
    <span
      className={`rounded-lg text-lg font-bold ${entry.status === 'TODAY' ? 'bg-today px-2' : ''}`}
    >
      เหลือ {formatSpan(entry.leftMs)}
    </span>
  );
}
