import { useState } from 'react';
import { ChoiceChip } from '../components/Button.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from '../components/Screen.tsx';
import { useCostCatalog } from '../db/hooks.ts';
import { setSoldOutToday } from '../db/catalog-repo.ts';
import { sessionBusinessDate } from '../db/session-repo.ts';
import type { CashSession } from '../db/types.ts';
import { isRemoved } from '../domain/removal.ts';
import { soldOutToday } from '../domain/sold-out.ts';

/**
 * หมดวันนี้ — take a drink off for the rest of the day when something stock
 * cannot see has run out (domain/sold-out.ts). One tap each way, written as
 * it is tapped; it ends with the day by itself. Off the sell path and not
 * behind the PIN: it is the person at the counter who knows the mint is gone.
 */
export default function SoldOutScreen({ session, back }: { session: CashSession; back: BackTo }) {
  const catalog = useCostCatalog();
  const today = sessionBusinessDate(session);
  const [error, setError] = useState<string | null>(null);

  const drinks = catalog
    ? [...catalog.products.values()]
        .filter((product) => product.is_active && !isRemoved(product))
        .sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const out = drinks.filter((product) => soldOutToday(product, today)).length;

  return (
    <Screen title="หมดวันนี้" subtitle={out > 0 ? `ปิดอยู่ ${out} เมนู` : 'ขายได้ทุกเมนู'}>
      <ScreenBody>
        <p className="text-ink-soft pt-3 text-lg font-bold">
          ปิดเมนูที่ของหมดไปถึงสิ้นวัน · พรุ่งนี้กลับมาขายเอง · ยังกดขายได้ถ้าจำเป็น
        </p>
        <ul aria-label="เมนู" className="pt-2">
          {drinks.map((product) => {
            const off = soldOutToday(product, today);
            return (
              <li
                key={product.id}
                className="border-line flex items-center justify-between gap-3 border-b py-2"
              >
                <span
                  className={`min-w-0 text-xl font-bold ${off ? 'text-ink-soft line-through' : ''}`}
                >
                  {product.name_short_th}
                </span>
                <ChoiceChip
                  selected={off}
                  size="md"
                  aria-label={`${product.name_short_th} หมดวันนี้`}
                  onClick={() => {
                    setError(null);
                    setSoldOutToday(product.id, off ? null : today).catch((cause: unknown) =>
                      setError(`บันทึกไม่สำเร็จ: ${String(cause)}`),
                    );
                  }}
                >
                  {off ? 'หมดวันนี้' : 'ขายอยู่'}
                </ChoiceChip>
              </li>
            );
          })}
        </ul>
      </ScreenBody>
      <ScreenFooter back={back}>
        {error ? (
          <p
            role="alert"
            className="bg-expired mb-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
          >
            {error}
          </p>
        ) : null}
      </ScreenFooter>
    </Screen>
  );
}
