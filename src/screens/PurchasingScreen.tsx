import { useState } from 'react';
import { Button } from '../components/Button.tsx';
import { NumberField } from '../components/form.tsx';
import LeaveGuardProvider from '../components/LeaveGuardProvider.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { formatTHB } from '../lib/money.ts';
import { parseNumber } from '../lib/number.ts';
import { bangkokDate, bangkokShort } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import { useCostCatalog, usePackagingStock, usePurchasing } from '../db/hooks.ts';
import { countPackaging, type Purchasing } from '../db/purchase-repo.ts';
import type { PackagingStock } from '../domain/packaging.ts';
import { monthSpend, previousMonth, type CostSuggestion } from '../domain/purchasing.ts';
import type { PurchaseOrder } from '../db/types.ts';
import OrderEditor from './purchasing/OrderEditor.tsx';
import OrderDetail from './purchasing/OrderDetail.tsx';
import ManageLists from './purchasing/ManageLists.tsx';

type View =
  | { kind: 'HOME' }
  | { kind: 'NEW' }
  | { kind: 'ORDER'; id: string; suggestions: CostSuggestion[] }
  | { kind: 'MANAGE' };

/**
 * สั่งของ — what the shop buys, and the cups, lids and straws on the shelf
 * (CLAUDE.md §6.5, §6.6). Usually opened the evening before, at home; never
 * on the way to a sale.
 */
export default function PurchasingScreen({ back }: { back: BackTo }) {
  return (
    <LeaveGuardProvider>
      <Purchasing back={back} />
    </LeaveGuardProvider>
  );
}

function Purchasing({ back }: { back: BackTo }) {
  const catalog = useCostCatalog();
  const data = usePurchasing();
  const stock = usePackagingStock(catalog);
  const [view, setView] = useState<View>({ kind: 'HOME' });
  const home = () => setView({ kind: 'HOME' });

  if (!catalog || !data || !stock) {
    return (
      <Screen title="สั่งของ">
        <ScreenBody>
          <p className="py-6 text-lg font-bold">กำลังโหลด…</p>
        </ScreenBody>
        <ScreenFooter back={back} />
      </Screen>
    );
  }

  if (view.kind === 'NEW') {
    return (
      <OrderEditor
        data={data}
        back={{ label: 'ยกเลิก', onClick: home }}
        onSaved={(id, suggestions) => setView({ kind: 'ORDER', id, suggestions })}
      />
    );
  }
  if (view.kind === 'ORDER') {
    return (
      <OrderDetail
        orderId={view.id}
        data={data}
        initialSuggestions={view.suggestions}
        back={{ label: 'กลับไปสั่งของ', onClick: home }}
      />
    );
  }
  if (view.kind === 'MANAGE') {
    return (
      <ManageLists data={data} catalog={catalog} back={{ label: 'กลับไปสั่งของ', onClick: home }} />
    );
  }

  return (
    <Home
      data={data}
      stock={stock}
      back={back}
      onNew={() => setView({ kind: 'NEW' })}
      onOpen={(id) => setView({ kind: 'ORDER', id, suggestions: [] })}
      onManage={() => setView({ kind: 'MANAGE' })}
    />
  );
}

function Home({
  data,
  stock,
  back,
  onNew,
  onOpen,
  onManage,
}: {
  data: Purchasing;
  stock: PackagingStock[];
  back: BackTo;
  onNew: () => void;
  onOpen: (orderId: string) => void;
  onManage: () => void;
}) {
  const suppliers = new Map(data.suppliers.map((s) => [s.id, s]));
  const items = new Map(data.items.map((i) => [i.id, i]));
  const waiting = data.orders.filter((order) => order.status === 'ORDERED');
  const received = data.orders.filter((order) => order.status === 'RECEIVED').slice(0, 5);
  const month = bangkokDate(nowIso()).slice(0, 7);
  const thisMonth = monthSpend(month, data.orders, data.lines, suppliers, items);
  const lastMonth = monthSpend(previousMonth(month), data.orders, data.lines, suppliers, items);
  const ready = data.suppliers.some((s) => s.is_active) && data.items.some((i) => i.is_active);

  const summary = (order: PurchaseOrder) =>
    data.lines
      .filter((line) => line.purchase_order_id === order.id)
      .map((line) => items.get(line.purchase_item_id)?.name_th ?? '')
      .join(' · ');

  return (
    <Screen title="สั่งของ">
      <ScreenBody>
        <section aria-label="สต็อกของใช้" className="pt-3">
          <h2 className="border-line border-b pb-1 text-xl font-bold">สต็อกของใช้</h2>
          <ul>
            {stock.map((entry) => (
              <CountRow key={entry.item.id} entry={entry} />
            ))}
          </ul>
        </section>

        <section aria-label="รอรับของ" className="pt-6">
          <h2 className="border-line border-b pb-1 text-xl font-bold">รอรับของ</h2>
          {waiting.length === 0 ? (
            <p className="text-ink-soft py-3 text-lg font-bold">ไม่มีของที่รออยู่</p>
          ) : (
            <ul>
              {waiting.map((order) => (
                <OrderRow
                  key={order.id}
                  title={suppliers.get(order.supplier_id)?.name ?? '—'}
                  detail={`สั่ง ${bangkokShort(order.ordered_at)} · ${summary(order)}`}
                  total={order.total_cost}
                  onOpen={() => onOpen(order.id)}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-label="ยอดซื้อ" className="pt-6">
          <h2 className="border-line border-b pb-1 text-xl font-bold">ยอดซื้อ</h2>
          <p className="flex justify-between py-2 text-xl font-bold">
            <span>เดือนนี้</span>
            <span className="tabular-nums">{formatTHB(thisMonth.total)}</span>
          </p>
          {thisMonth.bySupplier.map((entry) => (
            <p key={entry.supplierId} className="flex justify-between text-lg font-bold">
              <span className="pl-3">{entry.name}</span>
              <span className="tabular-nums">{formatTHB(entry.total)}</span>
            </p>
          ))}
          <p className="text-ink-soft flex justify-between py-2 text-lg font-bold">
            <span>เดือนที่แล้ว</span>
            <span className="tabular-nums">{formatTHB(lastMonth.total)}</span>
          </p>
        </section>

        {received.length > 0 ? (
          <section aria-label="รับของแล้ว" className="pt-6">
            <h2 className="border-line border-b pb-1 text-xl font-bold">รับของแล้ว</h2>
            <ul>
              {received.map((order) => (
                <OrderRow
                  key={order.id}
                  title={suppliers.get(order.supplier_id)?.name ?? '—'}
                  detail={`รับ ${bangkokShort(order.received_at ?? order.ordered_at)} · ${summary(order)}`}
                  total={order.total_cost}
                  onOpen={() => onOpen(order.id)}
                />
              ))}
            </ul>
          </section>
        ) : null}

        <div className="pt-6">
          <Button variant="secondary" onClick={onManage} className="w-full">
            ร้านที่ซื้อ · ของที่ซื้อ
          </Button>
        </div>
      </ScreenBody>

      <ScreenFooter
        back={back}
        primary={{ label: 'สั่งของใหม่', onClick: onNew, disabled: !ready }}
      >
        {!ready ? (
          <p className="text-ink-soft mb-3 text-lg font-bold">
            เพิ่มร้านที่ซื้อและของที่ซื้อก่อน ที่ปุ่ม “ร้านที่ซื้อ · ของที่ซื้อ”
          </p>
        ) : null}
      </ScreenFooter>
    </Screen>
  );
}

function OrderRow({
  title,
  detail,
  total,
  onOpen,
}: {
  title: string;
  detail: string;
  total: number;
  onOpen: () => void;
}) {
  return (
    <li className="border-line border-b">
      <button
        type="button"
        onClick={onOpen}
        className="min-h-touch-lg flex w-full items-center gap-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-xl font-bold">{title}</span>
            <span className="text-xl font-bold tabular-nums">{formatTHB(total)}</span>
          </span>
          <span className="text-ink-soft block text-base font-bold">{detail}</span>
        </span>
        <span aria-hidden="true" className="text-3xl font-bold">
          ›
        </span>
      </button>
    </li>
  );
}

/** One counted item: what is left, and a count when the shelf says otherwise. */
function CountRow({ entry }: { entry: PackagingStock }) {
  const [counting, setCounting] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = entry.item.name_th;

  function save() {
    const counted = parseNumber(value);
    if (counted === null || counted < 0) {
      setError('จำนวนต้องเป็นตัวเลข');
      return;
    }
    countPackaging(entry.item.id, counted).then(
      () => {
        setCounting(false);
        setValue('');
        setError(null);
      },
      (cause: unknown) => setError(`บันทึกไม่สำเร็จ: ${String(cause)}`),
    );
  }

  return (
    <li className="border-line border-b py-2">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-xl font-bold">{name}</span>
          <span className="text-lg font-bold tabular-nums">
            {entry.remaining === null ? (
              <span className="text-ink-soft">ยังไม่ได้นับ</span>
            ) : entry.level === 'OUT' ? (
              <span className="bg-expired rounded-lg px-2 text-white">หมด</span>
            ) : entry.level === 'LOW' ? (
              <span className="bg-today rounded-lg px-2">ใกล้หมด · เหลือ {entry.remaining}</span>
            ) : (
              `เหลือ ${entry.remaining}`
            )}
          </span>
        </span>
        {counting ? null : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setCounting(true)}
            aria-label={`นับ ${name}`}
          >
            นับ
          </Button>
        )}
      </div>
      {counting ? (
        <div className="pb-1">
          <NumberField
            label="นับได้"
            name={`นับได้ ${name}`}
            value={value}
            onChange={setValue}
            suffix="ชิ้น"
          />
          {error ? (
            <p
              role="alert"
              className="bg-expired mt-2 rounded-xl px-3 py-2 text-lg font-bold text-white"
            >
              {error}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCounting(false)}
              className="flex-1"
            >
              ยกเลิก
            </Button>
            <Button variant="primary" size="sm" onClick={save} className="flex-1">
              บันทึกที่นับ
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
