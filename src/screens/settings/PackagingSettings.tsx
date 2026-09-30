import { useState } from 'react';
import { Button } from '../../components/Button.tsx';
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
import { parseNumber } from '../../lib/number.ts';
import { bahtInput, formatTHB, parseBaht } from '../../lib/money.ts';
import { newId } from '../../lib/id.ts';
import type { CostCatalog } from '../../domain/cost.ts';
import { createPackagingItem, savePackagingItem, savePackagingSet } from '../../db/catalog-repo.ts';
import type { PackagingItem, PackagingSet } from '../../db/types.ts';
import { AddButton } from './shared.tsx';
import { problemsOf } from './problems.ts';

type View =
  { kind: 'LIST' } | { kind: 'ITEM'; id: string | null } | { kind: 'SET'; id: string | null };

/**
 * Cups, lids, straws, ice: each item's cost, and which go into each set. A
 * variant names its set, so a new cup price reaches every drink that uses it.
 */
export default function PackagingSettings({
  catalog,
  exit,
}: {
  catalog: CostCatalog;
  exit: BackTo;
}) {
  const [view, setView] = useState<View>({ kind: 'LIST' });
  const toList = () => setView({ kind: 'LIST' });

  if (view.kind === 'ITEM') {
    const item = view.id ? catalog.packagingItems.get(view.id) : undefined;
    return (
      <ItemEditor
        key={view.id ?? 'new'}
        item={item}
        back={{ label: item ? 'กลับไปรายการ' : 'ยกเลิก', onClick: toList }}
        onCreated={toList}
      />
    );
  }

  if (view.kind === 'SET') {
    const set = view.id ? catalog.packagingSets.get(view.id) : undefined;
    return (
      <SetEditor
        key={view.id ?? 'new'}
        catalog={catalog}
        set={set}
        back={{ label: 'กลับไปรายการ', onClick: toList }}
      />
    );
  }

  return (
    <ListPage exit={exit}>
      <section aria-label="บรรจุภัณฑ์">
        <h2 className="pt-3 text-xl font-bold">ชุดบรรจุภัณฑ์</h2>
        <ul>
          {[...catalog.packagingSets.values()].map((set) => (
            <ListRow
              key={set.id}
              title={set.name}
              detail={formatTHB(setCost(catalog, set))}
              onOpen={() => setView({ kind: 'SET', id: set.id })}
            />
          ))}
        </ul>
        <AddButton label="เพิ่มชุด" onClick={() => setView({ kind: 'SET', id: null })} />

        <h2 className="pt-6 text-xl font-bold">ของแต่ละชิ้น</h2>
        <ul>
          {[...catalog.packagingItems.values()].map((item) => (
            <ListRow
              key={item.id}
              title={item.name_th}
              detail={formatTHB(item.unit_cost)}
              onOpen={() => setView({ kind: 'ITEM', id: item.id })}
            />
          ))}
        </ul>
        <AddButton label="เพิ่มชิ้น" onClick={() => setView({ kind: 'ITEM', id: null })} />
      </section>
    </ListPage>
  );
}

function setCost(catalog: CostCatalog, set: PackagingSet): number {
  return set.items.reduce(
    (total, line) =>
      total + (catalog.packagingItems.get(line.packaging_item_id)?.unit_cost ?? 0) * line.qty,
    0,
  );
}

function ItemEditor({
  item,
  back,
  onCreated,
}: {
  item: PackagingItem | undefined;
  back: BackTo;
  onCreated: () => void;
}) {
  const [name, setName] = useState(item?.name_th ?? '');
  const [cost, setCost] = useState(item ? bahtInput(item.unit_cost) : '');
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({ name, cost });

  function save(): Promise<boolean> {
    const unitCost = parseBaht(cost);
    if (unitCost === null) {
      setProblems(['ต้นทุนต้องเป็นตัวเลข']);
      return Promise.resolve(false);
    }
    const write = item
      ? savePackagingItem({ ...item, name_th: name.trim(), unit_cost: unitCost })
      : createPackagingItem(name, unitCost).then(() => {
          form.markSaved();
          onCreated();
        });
    return write.then(
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
      title={item?.name_th ?? 'ชิ้นใหม่'}
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <TextField label="ชื่อ" value={name} onChange={setName} />
      <NumberField label="ต้นทุนต่อชิ้น" value={cost} onChange={setCost} suffix="บาท" />
    </Editor>
  );
}

function SetEditor({
  catalog,
  set,
  back,
}: {
  catalog: CostCatalog;
  set: PackagingSet | undefined;
  back: BackTo;
}) {
  const items = [...catalog.packagingItems.values()];
  // One id from the first render on, so a new set saved twice — a retry after
  // a problem, or a double tap — is the same set written twice, not two sets.
  const [id] = useState(() => set?.id ?? newId());
  const [name, setName] = useState(set?.name ?? '');
  const [lines, setLines] = useState(
    (set?.items ?? []).map((line) => ({ id: line.packaging_item_id, qty: String(line.qty) })),
  );
  const [adding, setAdding] = useState(items[0]?.id ?? '');
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({ name, lines });

  const unused = items.filter((item) => !lines.some((line) => line.id === item.id));
  const toAdd = unused.find((item) => item.id === adding) ?? unused[0];

  function save(): Promise<boolean> {
    const parsed = lines.map((line) => ({
      packaging_item_id: line.id,
      qty: parseNumber(line.qty),
    }));
    if (parsed.some((line) => line.qty === null)) {
      setProblems(['จำนวนต้องเป็นตัวเลข']);
      return Promise.resolve(false);
    }
    const itemsOut = parsed.map((line) => ({
      packaging_item_id: line.packaging_item_id,
      qty: line.qty!,
    }));

    // Checked, then written in one put: never a half-made set left behind.
    return savePackagingSet({
      ...(set ?? { synced_at: null }),
      id,
      name: name.trim(),
      items: itemsOut,
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
      title={set?.name ?? 'ชุดใหม่'}
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <TextField label="ชื่อชุด" value={name} onChange={setName} />
      <ul className="mt-2">
        {lines.map((line, index) => {
          const item = catalog.packagingItems.get(line.id);
          return (
            <li key={line.id} className="border-line flex items-end gap-2 border-b py-1">
              <div className="min-w-0 flex-1">
                <NumberField
                  label={item?.name_th ?? line.id}
                  value={line.qty}
                  onChange={(qty) =>
                    setLines((current) =>
                      current.map((entry, at) => (at === index ? { ...entry, qty } : entry)),
                    )
                  }
                  suffix="ชิ้น"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`เอา${item?.name_th ?? ''}ออก`}
                onClick={() => setLines((current) => current.filter((_, at) => at !== index))}
              >
                ลบ
              </Button>
            </li>
          );
        })}
      </ul>
      {toAdd ? (
        <div className="bg-paper-sunk mt-3 rounded-xl px-3 pb-3">
          <Choice
            label="เพิ่มในชุด"
            value={toAdd.id}
            options={unused.map((item) => [item.id, item.name_th] as const)}
            onChange={setAdding}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setLines((current) => [...current, { id: toAdd.id, qty: '1' }])}
            className="mt-3 w-full"
          >
            เพิ่ม
          </Button>
        </div>
      ) : null}
    </Editor>
  );
}
