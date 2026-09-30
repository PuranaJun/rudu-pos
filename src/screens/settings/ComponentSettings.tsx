import { useState } from 'react';
import {
  Choice,
  Editor,
  ListPage,
  ListRow,
  NumberField,
  TextField,
  Toggle,
} from '../../components/form.tsx';
import type { BackTo } from '../../components/Screen.tsx';
import { useDirty } from '../../components/use-dirty.ts';
import { numberText, parseNumber } from '../../lib/number.ts';
import { unitLabel } from '../../lib/quantity.ts';
import type { CostCatalog } from '../../domain/cost.ts';
import { createComponent, saveComponent } from '../../db/catalog-repo.ts';
import type { Component, ComponentRole, Lifecycle, Unit } from '../../db/types.ts';
import { AddButton } from './shared.tsx';
import { problemsOf } from './problems.ts';

const UNITS = [
  ['ML', 'ml'],
  ['G', 'g'],
  ['PC', 'ชิ้น'],
] as const;

const LIFECYCLES = [
  ['SIMPLE', 'ทำแล้วใช้ได้เลย'],
  ['STEEP', 'แช่ (ชาสกัดเย็น)'],
  ['SOAK_BLANCH', 'แช่แล้วลวก'],
  ['SLAB_CUT', 'เยลลี่ (ตัดก่อนขาย)'],
] as const;

const ROLES = [
  ['TEA_BASE', 'ชาฐาน'],
  ['CONCENTRATE', 'หัวเชื้อ'],
  ['SOLID', 'เนื้อ/ท็อปปิ้ง'],
  ['GARNISH', 'โรยหน้า'],
] as const;

type View = { kind: 'LIST' } | { kind: 'NEW' } | { kind: 'EDIT'; id: string };

/**
 * Components: the things a cup is assembled from, each with its own unit,
 * batch, clock and cost per ml or gram (CLAUDE.md §2, §3). Every number the
 * stock and cost engines use comes from here.
 */
export default function ComponentSettings({
  catalog,
  exit,
}: {
  catalog: CostCatalog;
  exit: BackTo;
}) {
  const [view, setView] = useState<View>({ kind: 'LIST' });
  const toList = () => setView({ kind: 'LIST' });

  if (view.kind === 'NEW') {
    return (
      <NewComponentForm
        back={{ label: 'ยกเลิก', onClick: toList }}
        onCreated={(id) => setView({ kind: 'EDIT', id })}
      />
    );
  }

  if (view.kind === 'EDIT') {
    const component = catalog.components.get(view.id);
    if (!component) return null;
    return (
      <ComponentEditor
        key={component.id}
        catalog={catalog}
        component={component}
        back={{ label: 'กลับไปรายการ', onClick: toList }}
      />
    );
  }

  const components = [...catalog.components.values()].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <ListPage exit={exit}>
      <section aria-label="ส่วนประกอบ">
        <ul>
          {components.map((component) => (
            <ListRow
              key={component.id}
              title={component.name_th}
              detail={`฿${component.cost_per_unit}/${unitLabel(component.unit)}`}
              onOpen={() => setView({ kind: 'EDIT', id: component.id })}
            />
          ))}
        </ul>
        <AddButton label="เพิ่มส่วนประกอบ" onClick={() => setView({ kind: 'NEW' })} />
      </section>
    </ListPage>
  );
}

function NewComponentForm({
  back,
  onCreated,
}: {
  back: BackTo;
  onCreated: (componentId: string) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<Unit>('ML');
  const [lifecycle, setLifecycle] = useState<Lifecycle>('SIMPLE');
  const [role, setRole] = useState<ComponentRole>('TEA_BASE');
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({ name, unit, lifecycle, role });

  function save(): Promise<boolean> {
    return createComponent({ name_th: name, unit, lifecycle, role }).then(
      (component) => {
        form.markSaved();
        onCreated(component.id);
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
      title="ส่วนประกอบใหม่"
      problems={problems}
      back={back}
      onSave={save}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <TextField label="ชื่อ" value={name} onChange={setName} />
      <Choice label="หน่วย" value={unit} options={UNITS} onChange={setUnit} />
      <Choice label="วิธีทำ" value={lifecycle} options={LIFECYCLES} onChange={setLifecycle} />
      <Choice label="หน้าที่ในแก้ว" value={role} options={ROLES} onChange={setRole} />
    </Editor>
  );
}

function ComponentEditor({
  catalog,
  component,
  back,
}: {
  catalog: CostCatalog;
  component: Component;
  back: BackTo;
}) {
  const [name, setName] = useState(component.name_th);
  const [unit, setUnit] = useState<Unit>(component.unit);
  const [batchQty, setBatchQty] = useState(numberText(component.default_batch_qty));
  const [yieldCups, setYieldCups] = useState(numberText(component.yield_cups));
  const [shelfLife, setShelfLife] = useState(numberText(component.shelf_life_hours));
  const [cutShelfLife, setCutShelfLife] = useState(numberText(component.cut_shelf_life_hours));
  const [leadTime, setLeadTime] = useState(numberText(component.lead_time_hours));
  const [cost, setCost] = useState(numberText(component.cost_per_unit));
  const [lifecycle, setLifecycle] = useState<Lifecycle>(component.lifecycle);
  const [role, setRole] = useState<ComponentRole>(component.role);
  const [note, setNote] = useState(component.recipe_note_th ?? '');
  const [tracked, setTracked] = useState(component.is_batch_tracked);
  const [source, setSource] = useState(component.source_component_id ?? 'NONE');
  const [sourceQty, setSourceQty] = useState(numberText(component.source_qty_per_unit));
  const [prepStartBy, setPrepStartBy] = useState(component.prep_start_by ?? '');
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({
    name,
    unit,
    batchQty,
    yieldCups,
    shelfLife,
    cutShelfLife,
    leadTime,
    cost,
    lifecycle,
    role,
    note,
    tracked,
    source,
    sourceQty,
    prepStartBy,
  });

  const others = [...catalog.components.values()].filter((other) => other.id !== component.id);
  const sourceComponent = source === 'NONE' ? undefined : catalog.components.get(source);

  function save(): Promise<boolean> {
    // Blank means "not set" for the optional numbers; anything else must parse.
    const optional = (text: string) => (text.trim() === '' ? null : parseNumber(text));
    const required = parseNumber(cost);
    const lead = parseNumber(leadTime);
    const fields = [batchQty, yieldCups, shelfLife, cutShelfLife, sourceQty];
    if (
      required === null ||
      lead === null ||
      fields.some((text) => text.trim() !== '' && parseNumber(text) === null)
    ) {
      setProblems(['ช่องตัวเลขต้องเป็นตัวเลข']);
      return Promise.resolve(false);
    }

    return saveComponent({
      ...component,
      name_th: name.trim(),
      unit,
      default_batch_qty: optional(batchQty),
      yield_cups: optional(yieldCups),
      shelf_life_hours: optional(shelfLife),
      cut_shelf_life_hours: optional(cutShelfLife),
      lead_time_hours: lead,
      cost_per_unit: required,
      lifecycle,
      role,
      recipe_note_th: note.trim() || null,
      is_batch_tracked: tracked,
      source_component_id: source === 'NONE' ? null : source,
      source_qty_per_unit: source === 'NONE' ? null : optional(sourceQty),
      prep_start_by: prepStartBy.trim() || null,
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
      title={component.name_th}
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <TextField label="ชื่อ" value={name} onChange={setName} />
      <Choice label="หน่วย" value={unit} options={UNITS} onChange={setUnit} />
      <NumberField
        label="ต้นทุน"
        value={cost}
        onChange={setCost}
        suffix={`บาท/${unitLabel(unit)}`}
        hint="ต่อหน่วย ไม่ใช่ต่อแก้ว — แก้สูตรแล้วต้นทุนยังถูก"
      />
      <NumberField
        label="ทำครั้งละ"
        value={batchQty}
        onChange={setBatchQty}
        suffix={unitLabel(unit)}
      />
      <NumberField label="ได้ประมาณ" value={yieldCups} onChange={setYieldCups} suffix="แก้ว" />
      <Choice label="วิธีทำ" value={lifecycle} options={LIFECYCLES} onChange={setLifecycle} />
      <NumberField
        label="เวลาเตรียมก่อนพร้อม"
        value={leadTime}
        onChange={setLeadTime}
        suffix="ชม."
      />
      <NumberField label="อายุ" value={shelfLife} onChange={setShelfLife} suffix="ชม." />
      {lifecycle === 'SLAB_CUT' ? (
        <NumberField
          label="อายุหลังตัด"
          value={cutShelfLife}
          onChange={setCutShelfLife}
          suffix="ชม."
        />
      ) : null}
      <Choice label="หน้าที่ในแก้ว" value={role} options={ROLES} onChange={setRole} />
      <TextField label="สูตร / วิธีทำ" value={note} onChange={setNote} multiline />
      <Toggle label="นับสต็อก" value={tracked} onChange={setTracked} />
      <TextField
        label="เตือนให้เริ่มทำก่อน"
        value={prepStartBy}
        onChange={setPrepStartBy}
        hint="เช่น 21:00 — เว้นว่างถ้าไม่ต้องเตือน"
      />
      <Choice
        label="ทำจากของอื่น"
        value={source}
        options={[
          ['NONE', 'ไม่ใช่'] as const,
          ...others.map((other) => [other.id, other.name_th] as const),
        ]}
        onChange={setSource}
      />
      {sourceComponent ? (
        <NumberField
          label={`ใช้${sourceComponent.name_th}`}
          value={sourceQty}
          onChange={setSourceQty}
          suffix={`${unitLabel(sourceComponent.unit)} ต่อ ${unitLabel(unit)}`}
          hint="เช่น เยลลี่ 1,000 g ใช้ชาขาว 500 ml = 0.5"
        />
      ) : null}
    </Editor>
  );
}
