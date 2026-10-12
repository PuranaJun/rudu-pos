import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { NumberField } from '../../components/form.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../../components/Screen.tsx';
import { bahtInput, formatTHB, parseBaht } from '../../lib/money.ts';
import { parseNumber } from '../../lib/number.ts';
import { formatBangkok } from '../../lib/datetime.ts';
import { shareText } from '../../lib/share.ts';
import { SHOP_NAME_TH } from '../../lib/receipt-image.ts';
import {
  applyPackagingCost,
  cancelOrder,
  receiveOrder,
  type Purchasing,
} from '../../db/purchase-repo.ts';
import { lineQty, orderMessage, type CostSuggestion } from '../../domain/purchasing.ts';
import type { PurchaseOrderLine, PurchaseOrderStatus } from '../../db/types.ts';
import { problemsOf } from '../settings/problems.ts';

const STATUS_TH: Record<PurchaseOrderStatus, string> = {
  ORDERED: 'รอรับของ',
  RECEIVED: 'รับของแล้ว',
  CANCELLED: 'ยกเลิกแล้ว',
};

/**
 * One order. While it is waiting: send it to the supplier, receive what came
 * — quantities and prices as they actually were — or cancel it. Once
 * received: what arrived and what it cost, and, if a price per piece moved,
 * the offer to use it from the next sale on.
 */
export default function OrderDetail({
  orderId,
  data,
  initialSuggestions,
  back,
}: {
  orderId: string;
  data: Purchasing;
  initialSuggestions: CostSuggestion[];
  back: BackTo;
}) {
  const order = data.orders.find((o) => o.id === orderId);
  const lines = data.lines.filter((line) => line.purchase_order_id === orderId);
  const items = new Map(data.items.map((i) => [i.id, i]));
  const supplier = data.suppliers.find((s) => s.id === order?.supplier_id);

  // Only what the operator changed. Everything else reads as ordered — and
  // keeps reading that way if the lines arrive a moment after the screen
  // opens, straight after the order was saved.
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const qtyOf = (line: PurchaseOrderLine) => qty[line.id] ?? String(line.qty_ordered);
  const costOf = (line: PurchaseOrderLine) => cost[line.id] ?? bahtInput(line.unit_cost);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!order) {
    return (
      <Screen title="ใบสั่งของ">
        <ScreenBody>
          <p className="py-6 text-lg font-bold">ไม่พบใบสั่งนี้</p>
        </ScreenBody>
        <ScreenFooter back={back} />
      </Screen>
    );
  }

  const waiting = order.status === 'ORDERED';

  function receive() {
    if (busy) return;
    const received = lines.map((line) => ({
      lineId: line.id,
      qty: parseNumber(qtyOf(line)),
      unitCost: parseBaht(costOf(line)),
    }));
    if (received.some((entry) => entry.qty === null || entry.qty < 0 || entry.unitCost === null)) {
      setProblems(['ใส่จำนวนและราคาที่ได้รับจริงให้ครบ (ไม่ได้ของใส่ 0)']);
      return;
    }
    setBusy(true);
    receiveOrder(
      orderId,
      received.map((entry) => ({
        lineId: entry.lineId,
        qty: entry.qty!,
        unitCost: entry.unitCost!,
      })),
    )
      .then((result) => {
        setProblems([]);
        setSuggestions(result.suggestions);
      })
      .catch((cause: unknown) => setProblems(problemsOf(cause)))
      .finally(() => setBusy(false));
  }

  function cancel() {
    setConfirmCancel(false);
    cancelOrder(orderId).catch((cause: unknown) => setProblems(problemsOf(cause)));
  }

  function send() {
    if (!order) return;
    shareText(orderMessage(SHOP_NAME_TH, order, lines, items, supplier)).then(
      (outcome) => setNote(outcome === 'copied' ? 'คัดลอกข้อความแล้ว — วางใน LINE ได้เลย' : null),
      (cause: unknown) => setProblems([`ส่งไม่สำเร็จ: ${String(cause)}`]),
    );
  }

  function apply(suggestion: CostSuggestion) {
    applyPackagingCost(suggestion.packagingItemId, suggestion.suggested).then(
      () => setApplied((current) => new Set(current).add(suggestion.packagingItemId)),
      (cause: unknown) => setProblems(problemsOf(cause)),
    );
  }

  return (
    <Screen
      title={supplier?.name ?? 'ใบสั่งของ'}
      subtitle={`${STATUS_TH[order.status]} · สั่ง ${formatBangkok(order.ordered_at)}`}
      aside={<p className="text-3xl font-bold tabular-nums">{formatTHB(order.total_cost)}</p>}
    >
      <ScreenBody>
        {suggestions.length > 0 ? (
          <section aria-label="ราคาต่อชิ้นเปลี่ยน" className="bg-today mt-3 rounded-xl p-3">
            <h2 className="text-xl font-bold">ราคาต่อชิ้นเปลี่ยน</h2>
            <p className="text-lg font-bold">ใช้ราคาใหม่กับบิลถัดไป — บิลที่ขายไปแล้วไม่เปลี่ยน</p>
            <ul>
              {suggestions.map((suggestion) => (
                <li key={suggestion.packagingItemId} className="flex items-center gap-3 pt-2">
                  <span className="min-w-0 flex-1 text-lg font-bold tabular-nums">
                    {suggestion.name} {formatTHB(suggestion.current)} →{' '}
                    {formatTHB(suggestion.suggested)}
                  </span>
                  {applied.has(suggestion.packagingItemId) ? (
                    <span className="text-lg font-bold">✓ ใช้แล้ว</span>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => apply(suggestion)}
                      aria-label={`ใช้ราคาใหม่ ${suggestion.name}`}
                    >
                      ใช้ราคาใหม่
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ul className="pt-2">
          {lines.map((line) => {
            const item = items.get(line.purchase_item_id);
            const name = item?.name_th ?? line.purchase_item_id;
            const unit = item?.unit ?? '';
            return (
              <li key={line.id} className="border-line border-b py-2">
                <p className="text-xl font-bold">{name}</p>
                {waiting ? (
                  <>
                    <p className="text-ink-soft text-lg font-bold">
                      สั่ง {line.qty_ordered} {unit} · {formatTHB(line.unit_cost)}/{unit}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField
                        label="ได้รับ"
                        name={`ได้รับ ${name}`}
                        value={qtyOf(line)}
                        onChange={(value) => setQty((c) => ({ ...c, [line.id]: value }))}
                        suffix={unit}
                      />
                      <NumberField
                        label={`ราคาจริง/${unit}`}
                        name={`ราคาจริงต่อ${unit} ${name}`}
                        value={costOf(line)}
                        onChange={(value) => setCost((c) => ({ ...c, [line.id]: value }))}
                        suffix="บาท"
                      />
                    </div>
                  </>
                ) : (
                  <p className="flex justify-between text-lg font-bold tabular-nums">
                    <span>
                      {lineQty(line)} {unit} × {formatTHB(line.unit_cost)}
                    </span>
                    <span>{formatTHB(Math.round(lineQty(line) * line.unit_cost))}</span>
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {waiting ? (
          <div className="flex flex-col gap-3 pt-4">
            <Button variant="secondary" onClick={send} className="w-full">
              ส่งใบสั่งให้ร้าน (LINE)
            </Button>
            {confirmCancel ? (
              <div className="border-expired rounded-xl border-2 p-3">
                <p className="text-xl font-bold">ยกเลิกใบสั่งนี้?</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setConfirmCancel(false)}
                    className="flex-1"
                  >
                    ไม่ยกเลิก
                  </Button>
                  <Button variant="danger" onClick={cancel} className="flex-1">
                    ยกเลิกใบสั่ง
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmCancel(true)} className="w-full">
                ไม่มาแล้ว — ยกเลิกใบสั่ง
              </Button>
            )}
          </div>
        ) : order.received_at ? (
          <p className="text-ink-soft pt-3 text-lg font-bold">
            รับของ {formatBangkok(order.received_at)}
          </p>
        ) : null}
      </ScreenBody>

      <ScreenFooter
        back={back}
        primary={waiting ? { label: 'รับของแล้ว', onClick: receive, disabled: busy } : undefined}
      >
        {problems.length > 0 ? (
          <ul
            role="alert"
            className="bg-expired mb-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        ) : note ? (
          <p role="status" className="bg-paper-sunk mb-3 rounded-xl px-4 py-2 text-lg font-bold">
            {note}
          </p>
        ) : null}
      </ScreenFooter>
    </Screen>
  );
}
