import { useState } from 'react';
import DrinkButton from '../components/DrinkButton.tsx';
import CartLineRow from '../components/CartLineRow.tsx';
import VersionStamp from '../components/VersionStamp.tsx';
import { formatTHB } from '../lib/money.ts';
import { useWakeLock } from '../lib/useWakeLock.ts';
import { cartTotals, defaultVariantOf } from '../domain/cart.ts';
import { unitPrice } from '../domain/cost.ts';
import { availableCups } from '../domain/stock.ts';
import {
  useCart,
  useCostCatalog,
  useDeviceId,
  useOperator,
  useStockSnapshot,
  useTodayTotals,
} from '../db/hooks.ts';
import { addDrink, clearCart, setVariant, stepQty, toggleModifier } from '../db/cart-repo.ts';
import { completeSale } from '../db/sale-repo.ts';
import type { PaymentMethod, Product } from '../db/types.ts';

const MENU_COLORS = ['--color-drink-1', '--color-drink-2', '--color-drink-3'];

/**
 * The sell screen. The only workflow that has to be fast.
 *
 * Tap a drink and it is in the cart — no confirmation, no modal. Everything
 * writes to IndexedDB as it happens and nothing on the tap path is awaited, so
 * the screen never waits on a disk or a radio while the operator's hands are
 * wet (CLAUDE.md §0, §6.1).
 */
export default function SellScreen() {
  const catalog = useCostCatalog();
  const stock = useStockSnapshot();
  const cart = useCart();
  const today = useTodayTotals();
  const operatorId = useOperator();
  const deviceId = useDeviceId();

  // The screen must not sleep between pours.
  useWakeLock();

  const [pendingSoldOut, setPendingSoldOut] = useState<Product | null>(null);
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (!catalog || !stock || !cart) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <p className="text-2xl font-bold">กำลังโหลด…</p>
      </div>
    );
  }

  const products = [...catalog.products.values()]
    .filter((product) => product.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const drinks = products.filter((product) => product.kind === 'DRINK');
  const bottles = products.filter((product) => product.kind === 'BOTTLE');

  const entries = cart.map((item) => ({
    variantId: item.line.variant_id,
    qty: item.line.qty,
    modifierIds: item.modifierIds,
  }));
  const totals = cartTotals(catalog, entries);

  function stockFor(product: Product) {
    const variant = defaultVariantOf(catalog!, product.id);
    if (!variant) return { cups: 0, limitingComponentName: null, variantId: null, price: 0 };

    const { cups, limitingComponentId } = availableCups(catalog!, stock!, variant.id);
    const limiting = limitingComponentId ? catalog!.components.get(limitingComponentId) : undefined;

    return {
      cups,
      // Naming the component is what makes the number actionable: it decides
      // whether to push a drink or slow it down (CLAUDE.md §2.2).
      limitingComponentName:
        cups > 0 && !Number.isFinite(cups) ? null : (limiting?.name_th ?? null),
      variantId: variant.id,
      price: unitPrice(catalog!, variant.id),
    };
  }

  function tapProduct(product: Product) {
    const { cups, variantId } = stockFor(product);
    if (!variantId) return;

    if (cups <= 0) {
      setPendingSoldOut(product);
      return;
    }
    void addDrink(variantId);
  }

  function confirmOverride() {
    const product = pendingSoldOut;
    setPendingSoldOut(null);
    if (!product) return;

    const { variantId } = stockFor(product);
    if (variantId) void addDrink(variantId, { soldOutOverride: true });
  }

  function pay(method: PaymentMethod) {
    if (cart!.length === 0 || paying) return;
    setPaying(true);

    completeSale(catalog!, cart!, {
      method,
      cashReceived: method === 'CASH' ? totals.gross : null,
      operatorId,
      deviceId: deviceId ?? 'unknown',
    })
      .then((result) => {
        setToast(
          result.shortfalls.length > 0
            ? `ขายแล้ว — สต็อกติดลบ ${result.shortfalls.length} รายการ`
            : 'ขายแล้ว',
        );
        window.setTimeout(() => setToast(null), 2000);
      })
      .catch((error: unknown) => setToast(`บันทึกไม่สำเร็จ: ${String(error)}`))
      .finally(() => setPaying(false));
  }

  return (
    <div className="safe-x flex h-full flex-col bg-white text-ink">
      {/* Today, live. */}
      <header className="safe-top border-line flex items-baseline justify-between gap-3 border-b px-4 pb-2">
        <p className="text-4xl font-bold tabular-nums">
          {today.units} <span className="text-2xl font-bold">แก้ว</span>
        </p>
        <p className="text-4xl font-bold tabular-nums">{formatTHB(today.revenue)}</p>
      </header>

      {/* The menu. */}
      <div className="flex shrink-0 flex-col gap-2 p-2">
        <div className="flex gap-2">
          {drinks.map((product, index) => {
            const info = stockFor(product);
            return (
              <div key={product.id} className="flex min-w-[44%] flex-1">
                <DrinkButton
                  product={product}
                  price={info.price}
                  cups={info.cups}
                  limitingComponentName={info.limitingComponentName}
                  colorVar={MENU_COLORS[index % MENU_COLORS.length]!}
                  onTap={() => tapProduct(product)}
                />
              </div>
            );
          })}
        </div>

        {bottles.map((product) => {
          const info = stockFor(product);
          return (
            <DrinkButton
              key={product.id}
              product={product}
              price={info.price}
              cups={info.cups}
              limitingComponentName={info.limitingComponentName}
              colorVar="--color-bottle"
              size="small"
              onTap={() => tapProduct(product)}
            />
          );
        })}
      </div>

      {/* The cart. */}
      <main className="min-h-0 flex-1 overflow-y-auto px-4">
        {cart.length === 0 ? (
          <p className="text-ink-soft py-6 text-center text-lg font-semibold">ยังไม่มีรายการ</p>
        ) : (
          <ul>
            {cart.map((item) => (
              <CartLineRow
                key={item.line.id}
                catalog={catalog}
                item={item}
                onStep={(delta) => void stepQty(item.line.id, delta)}
                onSetVariant={(variantId, allowed) =>
                  void setVariant(item.line.id, variantId, allowed)
                }
                onToggleModifier={(modifierId) => void toggleModifier(item.line.id, modifierId)}
              />
            ))}
          </ul>
        )}
      </main>

      {/* Payment, in thumb reach. */}
      <footer className="safe-bottom border-line border-t px-4 pt-2">
        {pendingSoldOut ? (
          <div role="alertdialog" aria-label="เลยจำนวนที่มี" className="mb-2">
            <p className="text-xl font-bold">เลยจำนวนที่มี — ขายต่อ?</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={confirmOverride}
                className="bg-brand text-paper min-h-touch-lg flex-1 rounded-xl text-xl font-bold"
              >
                ขายต่อ
              </button>
              <button
                type="button"
                onClick={() => setPendingSoldOut(null)}
                className="border-line min-h-touch-lg flex-1 rounded-xl border-2 text-xl font-bold"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        ) : null}

        {toast ? (
          <p role="status" className="mb-2 text-center text-xl font-bold">
            {toast}
          </p>
        ) : null}

        <div className="mb-2 flex items-baseline justify-between">
          <button
            type="button"
            onClick={() => void clearCart()}
            disabled={cart.length === 0}
            className="text-ink-soft min-h-touch text-lg font-bold disabled:opacity-40"
          >
            ล้าง
          </button>
          <p className="text-3xl font-bold tabular-nums">{formatTHB(totals.gross)}</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => pay('CASH')}
            disabled={cart.length === 0 || paying}
            className="min-h-touch-lg flex-1 rounded-2xl bg-brand-2 text-2xl font-bold text-white active:brightness-90 disabled:opacity-40"
          >
            เงินสด
          </button>
          <button
            type="button"
            onClick={() => pay('PROMPTPAY')}
            disabled={cart.length === 0 || paying}
            className="bg-ink min-h-touch-lg flex-1 rounded-2xl text-2xl font-bold text-white active:brightness-90 disabled:opacity-40"
          >
            QR
          </button>
        </div>

        <div className="mt-1 flex justify-center">
          <VersionStamp />
        </div>
      </footer>
    </div>
  );
}
