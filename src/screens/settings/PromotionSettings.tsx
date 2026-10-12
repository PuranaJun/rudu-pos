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
import type { Promotion, PromotionActivation, PromotionKind } from '../../db/types.ts';
import { blankPromotion, savePromotion } from '../../db/promotion-repo.ts';
import { AddButton } from './shared.tsx';
import { problemsOf } from './problems.ts';

const KINDS: readonly (readonly [PromotionKind, string])[] = [
  ['AMOUNT_OFF', 'ลดเป็นบาท'],
  ['PERCENT_OFF', 'ลดเป็น %'],
  ['BUY_X_GET_Y', 'ซื้อ X แถม Y'],
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
    .filter((variant) => variant.is_active)
    .sort((a, b) => {
      const pa = catalog.products.get(a.product_id)?.sort_order ?? 0;
      const pb = catalog.products.get(b.product_id)?.sort_order ?? 0;
      return pa - pb || a.sort_order - b.sort_order;
    });

  const [name, setName] = useState(promotion.name_th);
  const [kind, setKind] = useState<PromotionKind>(promotion.kind);
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
    active,
  });

  const toggle = <T,>(list: T[], item: T) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];

  function save(): Promise<boolean> {
    const amountSatang = parseBaht(amount);
    const numbers = {
      percent: parseNumber(percent),
      buy: parseNumber(buy),
      free: parseNumber(free),
    };
    const auto = activation === 'AUTO';
    const next: Promotion = {
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
      is_active: active,
    };
    return savePromotion(next).then(
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
      <TextField label="ชื่อโปรโมชั่น" value={name} onChange={setName} hint="ขึ้นบนบิลและใบเสร็จ" />
      <Choice label="แบบ" value={kind} options={KINDS} onChange={setKind} />
      {kind === 'AMOUNT_OFF' ? (
        <NumberField label="ลดแก้วละ" value={amount} onChange={setAmount} suffix="บาท" />
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

      <Toggle label="ใช้ร่วมกับส่วนลด 2 แก้ว" value={stacks} onChange={setStacks} />
      <Toggle label="เปิดใช้โปรนี้" value={active} onChange={setActive} />
    </Editor>
  );
}
