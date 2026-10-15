import { useState } from 'react';
import { Choice, Editor, ListRow, NumberField, TextField, Toggle } from '../../components/form.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../../components/Screen.tsx';
import { useDirty } from '../../components/use-dirty.ts';
import { bahtInput, formatTHB, parseBaht } from '../../lib/money.ts';
import { parseNumber, numberText } from '../../lib/number.ts';
import { newId } from '../../lib/id.ts';
import { savePurchaseItem, saveSupplier, type Purchasing } from '../../db/purchase-repo.ts';
import type { CostCatalog } from '../../domain/cost.ts';
import { isRemoved } from '../../domain/removal.ts';
import type { PurchaseItem, Supplier } from '../../db/types.ts';
import { AddButton } from '../settings/shared.tsx';
import { problemsOf } from '../settings/problems.ts';

type View =
  { kind: 'LIST' } | { kind: 'SUPPLIER'; id: string | null } | { kind: 'ITEM'; id: string | null };

/** Who the shop buys from, and what it buys, in the units it is bought in. */
export default function ManageLists({
  data,
  catalog,
  back,
}: {
  data: Purchasing;
  catalog: CostCatalog;
  back: BackTo;
}) {
  const [view, setView] = useState<View>({ kind: 'LIST' });
  const toList = { label: 'กลับไปรายการ', onClick: () => setView({ kind: 'LIST' }) };

  if (view.kind === 'SUPPLIER') {
    return (
      <Screen title="ร้านที่ซื้อ">
        <SupplierEditor
          key={view.id ?? 'new'}
          supplier={data.suppliers.find((s) => s.id === view.id)}
          back={toList}
        />
      </Screen>
    );
  }
  if (view.kind === 'ITEM') {
    return (
      <Screen title="ของที่ซื้อ">
        <ItemEditor
          key={view.id ?? 'new'}
          item={data.items.find((i) => i.id === view.id)}
          data={data}
          catalog={catalog}
          back={toList}
        />
      </Screen>
    );
  }

  const supplierName = new Map(data.suppliers.map((s) => [s.id, s.name]));
  return (
    <Screen title="ร้านที่ซื้อ · ของที่ซื้อ">
      <ScreenBody>
        <section aria-label="ร้านที่ซื้อ">
          <h2 className="pt-3 text-xl font-bold">ร้านที่ซื้อ</h2>
          <ul>
            {data.suppliers.map((supplier) => (
              <ListRow
                key={supplier.id}
                title={supplier.name}
                detail={supplier.contact_note ?? ''}
                muted={!supplier.is_active}
                onOpen={() => setView({ kind: 'SUPPLIER', id: supplier.id })}
              />
            ))}
          </ul>
          <AddButton label="เพิ่มร้าน" onClick={() => setView({ kind: 'SUPPLIER', id: null })} />
        </section>

        <section aria-label="ของที่ซื้อ">
          <h2 className="pt-6 text-xl font-bold">ของที่ซื้อ</h2>
          <ul>
            {data.items.map((item) => (
              <ListRow
                key={item.id}
                title={item.name_th}
                detail={[
                  item.default_supplier_id ? supplierName.get(item.default_supplier_id) : null,
                  item.last_unit_cost !== null
                    ? `${formatTHB(item.last_unit_cost)}/${item.unit}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                muted={!item.is_active}
                onOpen={() => setView({ kind: 'ITEM', id: item.id })}
              />
            ))}
          </ul>
          <AddButton label="เพิ่มของที่ซื้อ" onClick={() => setView({ kind: 'ITEM', id: null })} />
        </section>
      </ScreenBody>
      <ScreenFooter back={back} />
    </Screen>
  );
}

function SupplierEditor({ supplier, back }: { supplier: Supplier | undefined; back: BackTo }) {
  // One id from the first render, so saving twice writes one supplier twice, not two.
  const [id] = useState(() => supplier?.id ?? newId());
  const [name, setName] = useState(supplier?.name ?? '');
  const [contact, setContact] = useState(supplier?.contact_note ?? '');
  const [active, setActive] = useState(supplier?.is_active ?? true);
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({ name, contact, active });

  function save(): Promise<boolean> {
    return saveSupplier({
      id,
      name,
      contact_note: contact.trim() || null,
      is_active: active,
      synced_at: null,
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
      title={supplier?.name ?? 'ร้านใหม่'}
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <TextField label="ชื่อร้าน" value={name} onChange={setName} />
      <TextField
        label="ติดต่อ"
        value={contact}
        onChange={setContact}
        hint="เบอร์โทร LINE หรือแผงไหนในตลาด"
      />
      <Toggle label="ยังซื้ออยู่" value={active} onChange={setActive} />
    </Editor>
  );
}

function ItemEditor({
  item,
  data,
  catalog,
  back,
}: {
  item: PurchaseItem | undefined;
  data: Purchasing;
  catalog: CostCatalog;
  back: BackTo;
}) {
  const counted = [...catalog.packagingItems.values()].filter(
    (p) => p.is_stock_tracked && !isRemoved(p),
  );
  const [id] = useState(() => item?.id ?? newId());
  const [name, setName] = useState(item?.name_th ?? '');
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [packaging, setPackaging] = useState(item?.packaging_item_id ?? 'NONE');
  const [packSize, setPackSize] = useState(numberText(item?.pack_size ?? null));
  const [supplierId, setSupplierId] = useState(item?.default_supplier_id ?? 'NONE');
  const [price, setPrice] = useState(
    item?.last_unit_cost != null ? bahtInput(item.last_unit_cost) : '',
  );
  const [active, setActive] = useState(item?.is_active ?? true);
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({ name, unit, packaging, packSize, supplierId, price, active });

  function save(): Promise<boolean> {
    const isPackaging = packaging !== 'NONE';
    const size = isPackaging ? parseNumber(packSize) : null;
    const cost = price.trim() === '' ? null : parseBaht(price);
    if (price.trim() !== '' && cost === null) {
      setProblems(['ราคาต้องเป็นตัวเลข']);
      return Promise.resolve(false);
    }
    return savePurchaseItem({
      id,
      name_th: name,
      unit,
      pack_size: size,
      packaging_item_id: isPackaging ? packaging : null,
      default_supplier_id: supplierId === 'NONE' ? null : supplierId,
      last_unit_cost: cost,
      is_active: active,
      synced_at: null,
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
      title={item?.name_th ?? 'ของใหม่'}
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <TextField label="ชื่อ" value={name} onChange={setName} hint="เช่น แก้ว 16oz แพ็ค 50" />
      <TextField label="หน่วยที่ซื้อ" value={unit} onChange={setUnit} hint="แพ็ค กก. ลัง ถุง" />
      <Choice
        label="เป็นของใช้ที่นับสต็อก"
        value={packaging}
        options={[['NONE', 'ไม่ใช่'] as const, ...counted.map((p) => [p.id, p.name_th] as const)]}
        onChange={setPackaging}
      />
      {packaging !== 'NONE' ? (
        <NumberField
          label="1 หน่วยมีกี่ชิ้น"
          value={packSize}
          onChange={setPackSize}
          suffix="ชิ้น"
          hint="รับของ 1 หน่วย = เพิ่มสต็อกเท่านี้ชิ้น"
        />
      ) : null}
      <Choice
        label="ซื้อร้านไหนประจำ"
        value={supplierId}
        options={[
          ['NONE', 'ไม่ระบุ'] as const,
          ...data.suppliers.filter((s) => s.is_active).map((s) => [s.id, s.name] as const),
        ]}
        onChange={setSupplierId}
      />
      <NumberField label="ราคาล่าสุดต่อหน่วย" value={price} onChange={setPrice} suffix="บาท" />
      <Toggle label="ยังซื้ออยู่" value={active} onChange={setActive} />
    </Editor>
  );
}
