import { useState } from 'react';
import { ChoiceChip } from '../../components/Button.tsx';
import { Editor, NumberField } from '../../components/form.tsx';
import type { BackTo } from '../../components/Screen.tsx';
import { useDirty } from '../../components/use-dirty.ts';
import { bahtInput, formatTHB, parseBaht } from '../../lib/money.ts';
import type { CostCatalog } from '../../domain/cost.ts';
import { isRemoved } from '../../domain/removal.ts';
import { savePriceList } from '../../db/catalog-repo.ts';
import { problemsOf } from './problems.ts';

interface Row {
  id: string;
  name: string;
  price: string;
  active: boolean;
  variants: { id: string; name: string; price: string }[];
}

/**
 * ราคาทั้งหมด — every price on the menu, and whether each drink sells, on one
 * screen and saved together. After a taste test or a rise in cost, the owner
 * changes the menu in one sitting instead of opening fifteen drinks one by one.
 *
 * A variant shows here when it has a price of its own or is not the one a tap
 * rings (the hot pear): blank means it sells at its drink's price.
 */
export default function PriceList({ catalog, back }: { catalog: CostCatalog; back: BackTo }) {
  const [rows, setRows] = useState<Row[]>(() =>
    [...catalog.products.values()]
      .filter((product) => !isRemoved(product))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((product) => ({
        id: product.id,
        name: product.name_short_th,
        price: bahtInput(product.base_price),
        active: product.is_active,
        variants: [...catalog.variants.values()]
          .filter(
            (variant) =>
              variant.product_id === product.id &&
              (!variant.is_default || variant.price_override !== null),
          )
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((variant) => ({
            id: variant.id,
            name: variant.name_th,
            price: variant.price_override === null ? '' : bahtInput(variant.price_override),
          })),
      })),
  );
  const [problems, setProblems] = useState<string[]>([]);
  const form = useDirty({ rows });

  const update = (id: string, patch: (row: Row) => Row) =>
    setRows((current) => current.map((row) => (row.id === id ? patch(row) : row)));

  function save(): Promise<boolean> {
    const wrong: string[] = [];
    const products = rows.map((row) => {
      const price = parseBaht(row.price);
      if (price === null) wrong.push(`${row.name}: ราคาต้องเป็นตัวเลข`);
      return { id: row.id, base_price: price ?? 0, is_active: row.active };
    });
    const variants = rows.flatMap((row) =>
      row.variants.map((variant) => {
        const blank = variant.price.trim() === '';
        const price = blank ? null : parseBaht(variant.price);
        if (!blank && price === null) wrong.push(`${variant.name}: ราคาต้องเป็นตัวเลข`);
        return { id: variant.id, price_override: price };
      }),
    );
    if (wrong.length > 0) {
      setProblems(wrong);
      return Promise.resolve(false);
    }
    return savePriceList({ products, variants }).then(
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
      title="ราคาทั้งหมด"
      problems={problems}
      onSave={save}
      back={back}
      dirty={form.dirty}
      justSaved={form.justSaved}
    >
      <p className="text-ink-soft mt-2 text-lg font-bold">
        ราคาใหม่ใช้กับบิลถัดไป · บิลที่ขายไปแล้วไม่เปลี่ยน
      </p>
      <ul aria-label="ราคา">
        {rows.map((row) => (
          <li key={row.id} className="border-line border-b pb-3">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <NumberField
                  label={row.name}
                  name={`ราคา${row.name}`}
                  value={row.price}
                  onChange={(price) => update(row.id, (current) => ({ ...current, price }))}
                  suffix="บาท"
                />
              </div>
              <ChoiceChip
                selected={row.active}
                size="md"
                aria-label={`ขาย${row.name}`}
                onClick={() =>
                  update(row.id, (current) => ({ ...current, active: !current.active }))
                }
              >
                {row.active ? 'ขาย' : 'ไม่ขาย'}
              </ChoiceChip>
            </div>
            {row.variants.map((variant) => (
              <div key={variant.id} className="pl-6">
                <NumberField
                  label={variant.name}
                  value={variant.price}
                  onChange={(price) =>
                    update(row.id, (current) => ({
                      ...current,
                      variants: current.variants.map((entry) =>
                        entry.id === variant.id ? { ...entry, price } : entry,
                      ),
                    }))
                  }
                  suffix="บาท"
                  hint={`ว่าง = ราคาเดียวกับ${row.name} (${formatTHB(parseBaht(row.price) ?? 0)})`}
                />
              </div>
            ))}
          </li>
        ))}
      </ul>
    </Editor>
  );
}
