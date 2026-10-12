import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
import { Choice, NumberField } from '../../components/form.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../../components/Screen.tsx';
import { bahtInput, formatTHB, parseBaht } from '../../lib/money.ts';
import { parseNumber } from '../../lib/number.ts';
import { createOrder, type Purchasing } from '../../db/purchase-repo.ts';
import type { CostSuggestion } from '../../domain/purchasing.ts';
import type { PurchaseItem } from '../../db/types.ts';
import { problemsOf } from '../settings/problems.ts';

/**
 * A new order: who from, how much of what, at what price. The price starts at
 * the last one paid. Two ways to finish: ordered and waiting for delivery, or
 * the market run — bought and carried home, received there and then.
 */
export default function OrderEditor({
  data,
  back,
  onSaved,
}: {
  data: Purchasing;
  back: BackTo;
  onSaved: (orderId: string, suggestions: CostSuggestion[]) => void;
}) {
  const suppliers = data.suppliers.filter((s) => s.is_active);
  const items = data.items.filter((i) => i.is_active);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        item.last_unit_cost === null ? '' : bahtInput(item.last_unit_cost),
      ]),
    ),
  );
  const [problems, setProblems] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // This supplier's usual items first; everything else is still one scroll away.
  const theirs = items.filter((item) => item.default_supplier_id === supplierId);
  const others = items.filter((item) => item.default_supplier_id !== supplierId);

  const lines = items
    .map((item) => ({
      item,
      qty: parseNumber(qty[item.id] ?? ''),
      unitCost: parseBaht(cost[item.id] ?? ''),
    }))
    .filter((line) => line.qty !== null && line.qty > 0);
  const total = lines.reduce(
    (sum, line) => sum + Math.round((line.qty ?? 0) * (line.unitCost ?? 0)),
    0,
  );

  function save(receiveNow: boolean) {
    if (saving) return;
    const wrong: string[] = [];
    if (lines.length === 0) wrong.push('ใส่จำนวนของที่สั่งอย่างน้อยหนึ่งอย่าง');
    if (lines.some((line) => line.unitCost === null)) wrong.push('ใส่ราคาของทุกอย่างที่สั่ง');
    if (wrong.length > 0) {
      setProblems(wrong);
      return;
    }
    setSaving(true);
    createOrder(
      {
        supplierId,
        lines: lines.map((line) => ({
          purchaseItemId: line.item.id,
          qty: line.qty!,
          unitCost: line.unitCost!,
        })),
        note: null,
      },
      receiveNow,
    )
      .then(({ order, suggestions }) => onSaved(order.id, suggestions))
      .catch((cause: unknown) => setProblems(problemsOf(cause)))
      .finally(() => setSaving(false));
  }

  const row = (item: PurchaseItem) => (
    <li key={item.id} className="border-line border-b py-2">
      <p className="text-xl font-bold">
        {item.name_th} <span className="text-ink-soft text-lg">({item.unit})</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="จำนวน"
          name={`จำนวน ${item.name_th}`}
          value={qty[item.id] ?? ''}
          onChange={(value) => setQty((current) => ({ ...current, [item.id]: value }))}
          suffix={item.unit}
        />
        <NumberField
          label={`ราคา/${item.unit}`}
          name={`ราคาต่อ${item.unit} ${item.name_th}`}
          value={cost[item.id] ?? ''}
          onChange={(value) => setCost((current) => ({ ...current, [item.id]: value }))}
          suffix="บาท"
        />
      </div>
    </li>
  );

  return (
    <Screen title="สั่งของใหม่">
      <ScreenBody>
        <Choice
          label="ร้านที่ซื้อ"
          value={supplierId}
          options={suppliers.map((s) => [s.id, s.name] as const)}
          onChange={setSupplierId}
        />
        <ul className="pt-2">{theirs.map(row)}</ul>
        {others.length > 0 ? (
          <>
            <h3 className="text-ink-soft pt-4 text-lg font-bold">ของอื่น</h3>
            <ul>{others.map(row)}</ul>
          </>
        ) : null}
      </ScreenBody>

      <ScreenFooter
        back={back}
        primary={{
          label: 'ได้ของแล้ว',
          onClick: () => save(true),
          disabled: saving,
        }}
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
        ) : null}
        <p className="mb-2 flex items-baseline justify-between">
          <span className="text-xl font-bold">รวม</span>
          <span className="text-3xl font-bold tabular-nums">{formatTHB(total)}</span>
        </p>
        <Button
          variant="secondary"
          onClick={() => save(false)}
          disabled={saving}
          className="mb-3 w-full"
        >
          สั่งไว้ รอของมา
        </Button>
      </ScreenFooter>
    </Screen>
  );
}
