import { useState } from 'react';
import { ChoiceChip } from '../../components/Button.tsx';
import {
  Choice,
  Editor,
  ListPage,
  ListRow,
  NumberField,
  TextField,
} from '../../components/form.tsx';
import type { BackTo } from '../../components/Screen.tsx';
import { useDirty } from '../../components/use-dirty.ts';
import { numberText, parseNumber } from '../../lib/number.ts';
import { bahtInput, formatTHB, parseBaht } from '../../lib/money.ts';
import { unitLabel } from '../../lib/quantity.ts';
import type { CostCatalog } from '../../domain/cost.ts';
import { createModifier, saveModifier } from '../../db/catalog-repo.ts';
import type { ComponentRole, Modifier, ModifierKind } from '../../db/types.ts';
import { AddButton } from './shared.tsx';
import { problemsOf } from './problems.ts';

const KINDS = [
  ['PAID', 'เพิ่มเงิน'],
  ['PREP', 'วิธีทำ (ฟรี)'],
] as const;

const ROLES = [
  ['NONE', 'ไม่แทน'],
  ['TEA_BASE', 'ชาฐาน'],
  ['CONCENTRATE', 'หัวเชื้อ'],
  ['SOLID', 'เนื้อ'],
  ['GARNISH', 'โรยหน้า'],
] as const;

type View = { kind: 'LIST' } | { kind: 'EDIT'; id: string };

/**
 * Toppings and preparation choices. A modifier says what it does through its
 * fields — adds a component, replaces the amount of one by role, leaves out a
 * packaging item — so the engine never has to recognise one by name.
 */
export default function ModifierSettings({
  catalog,
  exit,
}: {
  catalog: CostCatalog;
  exit: BackTo;
}) {
  const [view, setView] = useState<View>({ kind: 'LIST' });
  const [problems, setProblems] = useState<string[]>([]);

  if (view.kind === 'EDIT') {
    const modifier = catalog.modifiers.get(view.id);
    if (!modifier) return null;
    return (
      <ModifierEditor
        key={modifier.id}
        catalog={catalog}
        modifier={modifier}
        back={{ label: 'กลับไปรายการ', onClick: () => setView({ kind: 'LIST' }) }}
      />
    );
  }

  const modifiers = [...catalog.modifiers.values()].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <ListPage exit={exit}>
      <section aria-label="ท็อปปิ้ง">
        <ul>
          {modifiers.map((modifier) => (
            <ListRow
              key={modifier.id}
              title={modifier.name_th}
              detail={modifier.price_delta > 0 ? `+${formatTHB(modifier.price_delta)}` : 'ฟรี'}
              muted={modifier.applies_to_variant_ids.length === 0}
              onOpen={() => setView({ kind: 'EDIT', id: modifier.id })}
            />
          ))}
        </ul>
        {problems.length > 0 ? (
          <p
            role="alert"
            className="bg-expired mt-2 rounded-xl px-4 py-3 text-lg font-bold text-white"
          >
            {problems.join(' · ')}
          </p>
        ) : null}
        <AddButton
          label="เพิ่มท็อปปิ้ง"
          onClick={() => {
            createModifier('ท็อปปิ้งใหม่')
              .then((modifier) => setView({ kind: 'EDIT', id: modifier.id }))
              .catch((cause: unknown) => setProblems(problemsOf(cause)));
          }}
        />
      </section>
    </ListPage>
  );
}

function ModifierEditor({
  catalog,
  modifier,
  back,
}: {
  catalog: CostCatalog;
  modifier: Modifier;
  back: BackTo;
}) {
  const variants = [...catalog.variants.values()].sort((a, b) =>
    a.name_th.localeCompare(b.name_th, 'th'),
  );
  const components = [...catalog.components.values()].sort((a, b) => a.sort_order - b.sort_order);
  const items = [...catalog.packagingItems.values()];

  const [name, setName] = useState(modifier.name_th);
  const [kind, setKind] = useState<ModifierKind>(modifier.kind);
  const [price, setPrice] = useState(bahtInput(modifier.price_delta));
  const [cost, setCost] = useState(bahtInput(modifier.cost_delta));
  const [applies, setApplies] = useState<string[]>(modifier.applies_to_variant_ids);
  const [componentId, setComponentId] = useState(modifier.component_id ?? 'NONE');
  const [qty, setQty] = useState(numberText(modifier.qty_per_cup));
  const [role, setRole] = useState<ComponentRole | 'NONE'>(
    modifier.overrides_component_role ?? 'NONE',
  );
  const [removes, setRemoves] = useState(modifier.removes_packaging_item_id ?? 'NONE');
  const [advisory, setAdvisory] = useState(modifier.advisory_th ?? '');
  const [sortOrder, setSortOrder] = useState(String(modifier.sort_order));
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({
    name,
    kind,
    price,
    cost,
    applies,
    componentId,
    qty,
    role,
    removes,
    advisory,
    sortOrder,
  });

  const component = componentId === 'NONE' ? undefined : catalog.components.get(componentId);
  // A quantity means something when a component is added or one is replaced by role.
  const needsQty = component !== undefined || role !== 'NONE';

  function save(): Promise<boolean> {
    const priceDelta = parseBaht(price);
    const costDelta = parseBaht(cost);
    const sort = parseNumber(sortOrder);
    const perCup = qty.trim() === '' ? null : parseNumber(qty);
    if (
      priceDelta === null ||
      costDelta === null ||
      sort === null ||
      (qty.trim() !== '' && perCup === null)
    ) {
      setProblems(['ช่องตัวเลขต้องเป็นตัวเลข']);
      return Promise.resolve(false);
    }

    return saveModifier({
      ...modifier,
      name_th: name.trim(),
      kind,
      is_paid: kind === 'PAID',
      price_delta: priceDelta,
      cost_delta: costDelta,
      applies_to_variant_ids: applies,
      component_id: component?.id ?? null,
      qty_per_cup: needsQty ? perCup : null,
      overrides_component_role: role === 'NONE' ? null : role,
      removes_packaging_item_id: removes === 'NONE' ? null : removes,
      advisory_th: advisory.trim() || null,
      sort_order: sort,
    }).then(
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
      title={modifier.name_th}
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <TextField label="ชื่อ" value={name} onChange={setName} />
      <Choice label="ประเภท" value={kind} options={KINDS} onChange={setKind} />
      <NumberField label="ราคาเพิ่ม" value={price} onChange={setPrice} suffix="บาท" />

      <div className="mt-3" role="group" aria-label="ใช้กับ">
        <span className="text-lg font-bold">ใช้กับ (เลือกได้หลายแบบ)</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {variants.map((variant) => {
            const on = applies.includes(variant.id);
            return (
              <ChoiceChip
                key={variant.id}
                selected={on}
                onClick={() =>
                  setApplies((current) =>
                    on ? current.filter((id) => id !== variant.id) : [...current, variant.id],
                  )
                }
              >
                {variant.name_th}
              </ChoiceChip>
            );
          })}
        </div>
      </div>

      <Choice
        label="ใส่ส่วนประกอบ"
        value={componentId}
        options={[
          ['NONE', 'ไม่มี'] as const,
          ...components.map((entry) => [entry.id, entry.name_th] as const),
        ]}
        onChange={setComponentId}
      />
      <Choice label="แทนปริมาณของ" value={role} options={ROLES} onChange={setRole} />
      {needsQty ? (
        <NumberField
          label="ปริมาณต่อแก้ว"
          value={qty}
          onChange={setQty}
          suffix={component ? unitLabel(component.unit) : ''}
        />
      ) : null}
      <NumberField
        label="ต้นทุนเพิ่ม"
        value={cost}
        onChange={setCost}
        suffix="บาท"
        hint="เฉพาะที่ไม่มีส่วนประกอบ เช่น บ๊วยเค็ม — ถ้ามีส่วนประกอบ ต้นทุนมาจากส่วนประกอบ"
      />
      <Choice
        label="ไม่ใส่บรรจุภัณฑ์"
        value={removes}
        options={[
          ['NONE', 'ไม่มี'] as const,
          ...items.map((item) => [item.id, item.name_th] as const),
        ]}
        onChange={setRemoves}
      />
      <TextField
        label="คำเตือน"
        value={advisory}
        onChange={setAdvisory}
        multiline
        hint="แสดงและอ่านออกเสียงตอนขาย เช่น มีเมล็ด ระวังสำลัก"
      />
      <NumberField label="ลำดับ" value={sortOrder} onChange={setSortOrder} />
    </Editor>
  );
}
