import { useState } from 'react';
import { ChoiceChip } from '../../components/Button.tsx';
import {
  Choice,
  Editor,
  ListPage,
  NumberField,
  TextField,
  Toggle,
} from '../../components/form.tsx';
import type { BackTo } from '../../components/Screen.tsx';
import { useDirty } from '../../components/use-dirty.ts';
import { bahtInput, parseBaht } from '../../lib/money.ts';
import { parseNumber } from '../../lib/number.ts';
import { WEEKDAY_TH } from '../../domain/period-report.ts';
import { promotionSummary } from '../../domain/promotions.ts';
import type { CostCatalog } from '../../domain/cost.ts';
import { isRemovedVariant } from '../../domain/removal.ts';
import type { OrderType, Promotion, PromotionActivation, PromotionKind } from '../../db/types.ts';
import { blankPromotion, savePromotion } from '../../db/promotion-repo.ts';
import { AddButton } from './shared.tsx';
import { problemsOf } from './problems.ts';

const KINDS: readonly (readonly [PromotionKind, string])[] = [
  ['AMOUNT_OFF', 'ลดเป็นบาท'],
  ['PERCENT_OFF', 'ลดเป็น %'],
  ['FIXED_PRICE', 'ขายราคาเดียว'],
  ['BUY_X_GET_Y', 'ซื้อ X แถม Y'],
];
const ORDER_TYPES: readonly (readonly [OrderType, string])[] = [
  ['DINE_IN', 'ทานที่ร้าน'],
  ['TAKEAWAY', 'กลับบ้าน'],
];
const ACTIVATIONS: readonly (readonly [PromotionActivation, string])[] = [
  ['AUTO', 'อัตโนมัติตามวันเวลา'],
  ['MANUAL', 'เปิดเองตอนเปิดร้าน'],
];

/**
 * The owner's promotions: ฿ or % off, or buy X get Y, on chosen drinks, on a
 * schedule or switched on for the day. Applied at the till by themselves —
 * a promotion never adds a tap to a sale (CLAUDE.md §0, §4). The 2-cup
 * discount and the rainy-day price stay in ร้าน.
 */
export default function PromotionSettings({
  catalog,
  exit,
}: {
  catalog: CostCatalog;
  exit: BackTo;
}) {
  const [editing, setEditing] = useState<Promotion | null>(null);
  const promotions = [...catalog.promotions].sort((a, b) => a.sort_order - b.sort_order);

  if (editing) {
    return (
      <PromotionEditor
        key={editing.id}
        catalog={catalog}
        promotion={editing}
        isNew={!promotions.some((p) => p.id === editing.id)}
        back={{ label: 'กลับไปรายการ', onClick: () => setEditing(null) }}
      />
    );
  }

  return (
    <ListPage exit={exit}>
      <section aria-label="โปรโมชั่น">
        <h2 className="pt-3 text-xl font-bold">โปรโมชั่นของร้าน</h2>
        <p className="text-ink-soft text-base font-bold">
          ใช้ให้เองตอนขาย ไม่ต้องกดเพิ่ม · ส่วนลด 2 แก้ว และวันฝนตก อยู่ที่ “ร้าน”
        </p>
        <ul>
          {promotions.map((promotion) => (
            <li key={promotion.id} className="border-line border-b">
              <button
                type="button"
                onClick={() => setEditing(promotion)}
                className="min-h-touch-lg flex w-full items-center gap-3 py-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xl font-bold ${promotion.is_active ? '' : 'text-ink-soft line-through'}`}
                  >
                    {promotion.name_th}
                    {promotion.is_active ? '' : ' (ปิดอยู่)'}
                  </span>
                  <span className="text-ink-soft block text-base font-bold">
                    {promotionSummary(catalog, promotion)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-3xl font-bold">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
        <AddButton
          label="เพิ่มโปรโมชั่น"
          onClick={() => setEditing(blankPromotion(promotions.length))}
        />
      </section>
    </ListPage>
  );
}

function PromotionEditor({
  catalog,
  promotion,
  isNew,
  back,
}: {
  catalog: CostCatalog;
  promotion: Promotion;
  isNew: boolean;
  back: BackTo;
}) {
  const drinks = [...catalog.variants.values()]
    .filter((variant) => variant.is_active && !isRemovedVariant(catalog, variant))
    .sort((a, b) => {
      const pa = catalog.products.get(a.product_id)?.sort_order ?? 0;
      const pb = catalog.products.get(b.product_id)?.sort_order ?? 0;
      return pa - pb || a.sort_order - b.sort_order;
    });

  const [name, setName] = useState(promotion.name_th);
  const [kind, setKindRaw] = useState<PromotionKind>(promotion.kind);
  // A set price is a price, not a discount: switching to it never carries
  // over the ฿10-off default, which would sell every drink at ฿10. It starts
  // empty and must be typed.
  const setKind = (next: PromotionKind) => {
    if (next === 'FIXED_PRICE' && kind !== 'FIXED_PRICE') setAmount('');
    setKindRaw(next);
  };
  const [amount, setAmount] = useState(bahtInput(promotion.amount));
  const [percent, setPercent] = useState(String(promotion.percent));
  const [buy, setBuy] = useState(String(promotion.buy_qty));
  const [free, setFree] = useState(String(promotion.free_qty));
  const [variants, setVariants] = useState<string[]>(promotion.variant_ids);
  const [activation, setActivation] = useState<PromotionActivation>(promotion.activation);
  const [startsOn, setStartsOn] = useState(promotion.starts_on ?? '');
  const [endsOn, setEndsOn] = useState(promotion.ends_on ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(promotion.weekdays);
  const [from, setFrom] = useState(promotion.hours_from ?? '');
  const [to, setTo] = useState(promotion.hours_to ?? '');
  const [stacks, setStacks] = useState(promotion.stacks_with_two_cup);
  const [orderTypes, setOrderTypes] = useState<OrderType[]>(promotion.order_types ?? []);
  const [active, setActive] = useState(promotion.is_active);
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({
    name,
    kind,
    amount,
    percent,
    buy,
    free,
    variants,
    activation,
    startsOn,
    endsOn,
    weekdays,
    from,
    to,
    stacks,
    orderTypes,
    active,
  });

  const toggle = <T,>(list: T[], item: T) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  /** The promotion as it stands on screen — saved as is, and summed up live above. */
  function draft(): Promotion {
    const amountSatang = parseBaht(amount);
    const numbers = {
      percent: parseNumber(percent),
      buy: parseNumber(buy),
      free: parseNumber(free),
    };
    const auto = activation === 'AUTO';
    return {
      ...promotion,
      name_th: name,
      kind,
      amount: amountSatang ?? 0,
      percent: numbers.percent ?? 0,
      buy_qty: numbers.buy ?? 0,
      free_qty: numbers.free ?? 0,
      variant_ids: variants,
      activation,
      starts_on: startsOn || null,
      ends_on: endsOn || null,
      weekdays: auto ? [...weekdays].sort() : [],
      hours_from: auto ? from || null : null,
      hours_to: auto ? to || null : null,
      stacks_with_two_cup: stacks,
      // Both chosen is the same as neither: every order.
      order_types: orderTypes.length === ORDER_TYPES.length ? [] : orderTypes,
      is_active: active,
    };
  }

  function save(): Promise<boolean> {
    return savePromotion(draft()).then(
      () => {
        setProblems([]);
        form.markSaved();
        return true;
      },
      (cause: unknown) => {
        setProblems(problemsOf(cause));
        return false;
      },
    );
  }

  return (
    <Editor
      title={isNew ? 'โปรโมชั่นใหม่' : promotion.name_th}
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      {/* Read back in one line before saving: a typo in a price is caught here,
          not by a customer at the counter. */}
      <p
        role="status"
        aria-label="สรุป"
        className="bg-paper-sunk mt-3 rounded-xl px-4 py-3 text-lg font-bold"
      >
        สรุป:{' '}
        {promotionSummary(catalog, draft())
          .split(' · ')
          .map((phrase, index) => (
            // Each phrase whole on a line: Thai has no spaces to break at.
            <span key={phrase}>
              {index > 0 ? '\u00a0· ' : null}
              <span className="whitespace-nowrap">{phrase}</span>
            </span>
          ))}
      </p>
      <TextField label="ชื่อโปรโมชั่น" value={name} onChange={setName} hint="ขึ้นบนบิลและใบเสร็จ" />
      <Choice label="แบบ" value={kind} options={KINDS} onChange={setKind} />
      {kind === 'AMOUNT_OFF' ? (
        <NumberField label="ลดแก้วละ" value={amount} onChange={setAmount} suffix="บาท" />
      ) : kind === 'FIXED_PRICE' ? (
        <NumberField
          label="ขายแก้วละ"
          value={amount}
          onChange={setAmount}
          suffix="บาท"
          hint="ราคาเครื่องดื่ม · ท็อปปิ้งยังคิดเพิ่มตามปกติ · แก้วที่ถูกกว่านี้อยู่แล้วไม่ลด"
        />
      ) : kind === 'PERCENT_OFF' ? (
        <NumberField label="ลดแก้วละ" value={percent} onChange={setPercent} suffix="%" />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="ซื้อ" value={buy} onChange={setBuy} suffix="แก้ว" />
          <NumberField label="แถม" value={free} onChange={setFree} suffix="แก้ว" />
        </div>
      )}

      <div className="mt-3" role="group" aria-label="ใช้กับ">
        <span className="text-lg font-bold">ใช้กับ</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {drinks.map((variant) => (
            <ChoiceChip
              key={variant.id}
              selected={variants.includes(variant.id)}
              onClick={() => setVariants((current) => toggle(current, variant.id))}
            >
              {variant.name_th}
            </ChoiceChip>
          ))}
        </div>
        <span className="text-ink-soft block text-base font-bold">
          ไม่เลือก = ทุกเครื่องดื่ม (ไม่รวมขวด)
        </span>
      </div>

      <Choice label="เปิดใช้" value={activation} options={ACTIVATIONS} onChange={setActivation} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="เริ่มวันที่" value={startsOn} onChange={setStartsOn} type="date" />
        <TextField label="ถึงวันที่" value={endsOn} onChange={setEndsOn} type="date" />
      </div>
      <p className="text-ink-soft text-base font-bold">ว่างไว้ = ไม่มีกำหนด</p>

      {activation === 'AUTO' ? (
        <>
          <div className="mt-3" role="group" aria-label="วัน">
            <span className="text-lg font-bold">วัน</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {WEEKDAY_TH.map((label, day) => (
                <ChoiceChip
                  key={label}
                  selected={weekdays.includes(day)}
                  onClick={() => setWeekdays((current) => toggle(current, day))}
                >
                  {label}
                </ChoiceChip>
              ))}
            </div>
            <span className="text-ink-soft block text-base font-bold">ไม่เลือก = ทุกวัน</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField label="ตั้งแต่เวลา" value={from} onChange={setFrom} type="time" />
            <TextField label="ถึงเวลา" value={to} onChange={setTo} type="time" />
          </div>
          <p className="text-ink-soft text-base font-bold">ว่างไว้ = ทั้งวัน</p>
        </>
      ) : (
        <p className="text-ink-soft mt-2 text-base font-bold">
          เปิดได้ที่หน้าเปิดร้าน ใช้ได้วันนั้นวันเดียว
        </p>
      )}

      <div className="mt-3" role="group" aria-label="ใช้กับการสั่ง">
        <span className="text-lg font-bold">ใช้กับการสั่ง</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {ORDER_TYPES.map(([type, label]) => (
            <ChoiceChip
              key={type}
              selected={orderTypes.includes(type)}
              onClick={() => setOrderTypes((current) => toggle(current, type))}
            >
              {label}
            </ChoiceChip>
          ))}
        </div>
        <span className="text-ink-soft block text-base font-bold">ไม่เลือก = ทั้งสองแบบ</span>
      </div>

      <Toggle label="ใช้ร่วมกับส่วนลด 2 แก้ว" value={stacks} onChange={setStacks} />
      <Toggle label="เปิดใช้โปรนี้" value={active} onChange={setActive} />
    </Editor>
  );
}
