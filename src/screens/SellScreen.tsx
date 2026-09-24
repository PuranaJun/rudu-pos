import { useState } from 'react';
import DrinkButton from '../components/DrinkButton.tsx';
import CartLineRow from '../components/CartLineRow.tsx';
import CashTenderPad from '../components/CashTenderPad.tsx';
import PromptPayPanel from '../components/PromptPayPanel.tsx';
import ReceiptSheet from '../components/ReceiptSheet.tsx';
import SalesListScreen from './SalesListScreen.tsx';
import VersionStamp from '../components/VersionStamp.tsx';
import { formatTHB } from '../lib/money.ts';
import { useWakeLock } from '../lib/useWakeLock.ts';
import { defaultVariantOf } from '../domain/cart.ts';
import { unitPrice } from '../domain/cost.ts';
import { DISCOUNT_REASON_TH } from '../domain/promotions.ts';
import { availableCups } from '../domain/stock.ts';
import {
  useCart,
  useCostCatalog,
  useDeviceId,
  useSettings,
  useStockSnapshot,
  useTodaySales,
  useTodayTotals,
} from '../db/hooks.ts';
import {
  addDrink,
  clearCart,
  setLineDiscountReason,
  setVariant,
  stepQty,
  toggleModifier,
} from '../db/cart-repo.ts';
import { completeSale, priceCart, type Receipt } from '../db/sale-repo.ts';
import { voidSale } from '../db/stock-repo.ts';
import { sessionBusinessDate } from '../db/session-repo.ts';
import type { CashSession, PaymentMethod, Product } from '../db/types.ts';

const MENU_COLORS = ['--color-drink-1', '--color-drink-2', '--color-drink-3'];

/**
 * The sell screen. The only workflow that has to be fast.
 *
 * Tap a drink and it is in the cart — no confirmation, no modal. Everything
 * writes to IndexedDB as it happens and nothing on the tap path is awaited, so
 * the screen never waits on a disk or a radio while the operator's hands are
 * wet (CLAUDE.md §0, §6.1).
 *
 * Only reachable with a session open. The operator was chosen at open day and
 * is never asked again; every sale lands on the session's business date.
 */
export default function SellScreen({ session }: { session: CashSession }) {
  const businessDate = sessionBusinessDate(session);
  const operatorId = session.operator_id;

  const catalog = useCostCatalog();
  const stock = useStockSnapshot();
  const settings = useSettings();
  const cart = useCart();
  const today = useTodayTotals(businessDate);
  const deviceId = useDeviceId();
  const sales = useTodaySales(catalog, businessDate);

  // The screen must not sleep between pours.
  useWakeLock();

  const [pendingSoldOut, setPendingSoldOut] = useState<Product | null>(null);
  const [tendering, setTendering] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ receipt: Receipt; shortfalls: number } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSales, setShowSales] = useState(false);

  if (!catalog || !stock || !cart || !settings) {
    return (
      <div className="text-ink flex h-full items-center justify-center bg-white">
        <p className="text-2xl font-bold">กำลังโหลด…</p>
      </div>
    );
  }

  const products = [...catalog.products.values()]
    .filter((product) => product.is_active)
    .sort((a, b) => a.sort_order - b.sort_order);
  const drinks = products.filter((product) => product.kind === 'DRINK');
  const bottles = products.filter((product) => product.kind === 'BOTTLE');

  // Priced exactly the way the sale will be written, so the total on the
  // footer can never differ from the total recorded.
  const priced = priceCart(catalog, settings, cart);

  function stockFor(product: Product) {
    const variant = defaultVariantOf(catalog!, product.id);
    if (!variant) return { cups: 0, limitingComponentName: null, variantId: null, price: 0 };

    const { cups, limitingComponentId } = availableCups(catalog!, stock!, variant.id);
    const limiting = limitingComponentId ? catalog!.components.get(limitingComponentId) : undefined;

    return {
      cups,
      // Naming the component is what makes the number actionable: it decides
      // whether to push a drink or slow it down (CLAUDE.md §2.2).
      limitingComponentName: Number.isFinite(cups) ? (limiting?.name_th ?? null) : null,
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

  function confirmPayment(method: PaymentMethod, received: number | null) {
    if (busy) return;
    setBusy(true);

    completeSale(catalog!, cart!, priced, {
      method,
      cashReceived: received,
      operatorId,
      deviceId: deviceId ?? 'unknown',
      brandingLineTh: settings!.brandingLineTh,
      businessDate,
    })
      .then((result) => {
        setTendering(null);
        setDone({ receipt: result.receipt, shortfalls: result.shortfalls.length });
        window.setTimeout(() => setDone(null), 6000);
      })
      .catch((cause: unknown) => setError(`บันทึกไม่สำเร็จ: ${String(cause)}`))
      .finally(() => setBusy(false));
  }

  if (tendering === 'CASH') {
    return (
      <CashTenderPad
        due={priced.totalNet}
        quickTender={settings.quickTender}
        busy={busy}
        onCancel={() => setTendering(null)}
        onConfirm={(received) => confirmPayment('CASH', received)}
      />
    );
  }

  if (tendering === 'PROMPTPAY') {
    return (
      <PromptPayPanel
        due={priced.totalNet}
        qrImage={settings.promptPayQrImage}
        busy={busy}
        onCancel={() => setTendering(null)}
        onConfirm={() => confirmPayment('PROMPTPAY', null)}
      />
    );
  }

  return (
    <div className="safe-x text-ink flex h-full flex-col bg-white">
      {/* Today, live. */}
      <button
        type="button"
        onClick={() => setShowSales(true)}
        aria-label="รายการขายวันนี้"
        className="safe-top border-line flex w-full items-baseline justify-between gap-3 border-b px-4 pb-2 text-left"
      >
        <span className="text-4xl font-bold tabular-nums">
          {today.units} <span className="text-2xl font-bold">แก้ว</span>
        </span>
        <span className="text-4xl font-bold tabular-nums">{formatTHB(today.revenue)}</span>
      </button>

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
                onSetDiscountReason={(reason) => void setLineDiscountReason(item.line.id, reason)}
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

        {done ? (
          <div role="status" className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xl font-bold">
              ขายแล้ว
              {done.shortfalls > 0 ? ` — สต็อกติดลบ ${done.shortfalls} รายการ` : ''}
            </p>
            <button
              type="button"
              onClick={() => setShowReceipt(true)}
              className="border-line min-h-touch rounded-xl border-2 px-4 text-lg font-bold"
            >
              ดูใบเสร็จ
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mb-2 text-lg font-bold">
            {error}
          </p>
        ) : null}

        {priced.totalDiscount > 0 ? (
          <div className="mb-1 flex flex-wrap justify-end gap-x-3 text-lg font-bold">
            {priced.byReason.map((discount) => (
              <span key={discount.reason}>
                {DISCOUNT_REASON_TH[discount.reason]} −{formatTHB(discount.amount)}
              </span>
            ))}
          </div>
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
          <p className="text-3xl font-bold tabular-nums">{formatTHB(priced.totalNet)}</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTendering('CASH')}
            disabled={cart.length === 0 || busy}
            className="bg-brand-2 min-h-touch-lg flex-1 rounded-2xl text-2xl font-bold text-white active:brightness-90 disabled:opacity-40"
          >
            เงินสด
          </button>
          <button
            type="button"
            onClick={() => setTendering('PROMPTPAY')}
            disabled={cart.length === 0 || busy}
            className="bg-ink min-h-touch-lg flex-1 rounded-2xl text-2xl font-bold text-white active:brightness-90 disabled:opacity-40"
          >
            QR
          </button>
        </div>

        <div className="mt-1 flex justify-center">
          <VersionStamp />
        </div>
      </footer>

      {showSales ? (
        <SalesListScreen
          sales={sales ?? []}
          totals={today}
          voidReasons={settings.voidReasons}
          onVoid={(saleId, reason) => {
            void voidSale(saleId, reason).catch((cause: unknown) =>
              setError(`ยกเลิกไม่สำเร็จ: ${String(cause)}`),
            );
          }}
          onClose={() => setShowSales(false)}
        />
      ) : null}

      {showReceipt && done ? (
        <ReceiptSheet receipt={done.receipt} onClose={() => setShowReceipt(false)} />
      ) : null}
    </div>
  );
}
