import { useState } from 'react';
import DrinkButton from '../components/DrinkButton.tsx';
import CartLineRow from '../components/CartLineRow.tsx';
import PayButtons from '../components/PayButtons.tsx';
import PromptPayPanel from '../components/PromptPayPanel.tsx';
import ReceiptSheet from '../components/ReceiptSheet.tsx';
import PrepBanner from '../components/PrepBanner.tsx';
import { Button } from '../components/Button.tsx';
import MenuButton from '../nav/MenuButton.tsx';
import { useNav } from '../nav/nav-store.ts';
import { formatTHB } from '../lib/money.ts';
import { defaultVariantOf } from '../domain/cart.ts';
import { unitPrice } from '../domain/cost.ts';
import { DISCOUNT_REASON_TH } from '../domain/promotions.ts';
import { breakeven, EMPTY_DAY_TOTALS } from '../domain/reporting.ts';
import { availableCups } from '../domain/stock.ts';
import { prepReminders } from '../domain/production.ts';
import { nowIso } from '../lib/id.ts';
import {
  useCart,
  useCostCatalog,
  useDeviceId,
  useSettings,
  useStockSnapshot,
  useExpectedCash,
  useSessionTotals,
} from '../db/hooks.ts';
import {
  addDrink,
  clearCart,
  setLineDiscountReason,
  setVariant,
  stepQty,
  toggleModifier,
} from '../db/cart-repo.ts';
import { CartChangedError, completeSale, priceCart, type Receipt } from '../db/sale-repo.ts';
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
 *
 * Everything else — the day's bills, production, closing the day — is behind
 * the one labelled เมนู button, never behind a tap on something that does
 * not look like a button.
 */
export default function SellScreen({ session }: { session: CashSession }) {
  const businessDate = sessionBusinessDate(session);
  const operatorId = session.operator_id;

  const catalog = useCostCatalog();
  const stock = useStockSnapshot();
  const settings = useSettings();
  const cart = useCart();
  const today = useSessionTotals(session) ?? EMPTY_DAY_TOTALS;
  const drawer = useExpectedCash(session);
  const deviceId = useDeviceId();
  const open = useNav((state) => state.open);

  const [pendingSoldOut, setPendingSoldOut] = useState<Product | null>(null);
  // Only PromptPay has a screen of its own: cash completes from the footer.
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(false);
  // What the last sale was, until the next drink is tapped — long enough to
  // read the change at arm's length, with no timer to clear it.
  const [done, setDone] = useState<{ receipt: Receipt; shortfalls: number } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  // A warning is the cart moving under a tap (the next tap rings it); danger
  // is a sale that did not save.
  const [error, setError] = useState<{ message: string; kind: 'warning' | 'danger' } | null>(null);

  if (!catalog || !stock || !cart || !settings) {
    return (
      <div className="text-ink flex h-full items-center justify-center bg-white">
        <p className="text-2xl font-bold">กำลังโหลด…</p>
      </div>
    );
  }

  // Drawn with the screen, which redraws on every tap and every write — close
  // enough for a reminder about tonight, and nothing has to tick for it.
  const reminders = prepReminders(catalog, stock, nowIso());

  // Live, the waste is not known yet; at close it comes off (CLAUDE.md §7).
  const even = breakeven(today, settings.fixedCostPerDay, settings.breakevenCups);

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

    setDone(null);
    setError(null);
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
        setError(null);
        setShowQr(false);
        setDone({ receipt: result.receipt, shortfalls: result.shortfalls.length });
      })
      .catch((cause: unknown) =>
        // A cart that moved under the tap is not a failure to report as one:
        // the screen has the new total now, and the next tap will ring it.
        setError(
          cause instanceof CartChangedError
            ? { message: cause.message, kind: 'warning' }
            : { message: `บันทึกไม่สำเร็จ: ${String(cause)}`, kind: 'danger' },
        ),
      )
      .finally(() => setBusy(false));
  }

  if (showQr) {
    return (
      <PromptPayPanel
        due={priced.totalNet}
        qrImage={settings.promptPayQrImage}
        busy={busy}
        onCancel={() => setShowQr(false)}
        onConfirm={() => confirmPayment('PROMPTPAY', null)}
      />
    );
  }

  return (
    <div className="safe-x text-ink flex h-full flex-col bg-white">
      {/* Today, live — information only. The way to everything else is the
          labelled เมนู button beside it. */}
      <header className="safe-top border-line flex items-start gap-3 border-b px-4 pb-2">
        <div role="group" aria-label="ยอดวันนี้" className="min-w-0 flex-1">
          <p className="flex items-baseline justify-between gap-3">
            <span className="text-2xl font-bold tabular-nums">
              {today.units} <span className="text-lg font-bold">แก้ว</span>
            </span>
            <span className="text-2xl font-bold tabular-nums">{formatTHB(today.revenue)}</span>
          </p>
          <p className="flex flex-wrap items-center justify-between gap-x-2 text-lg font-bold">
            <span className="tabular-nums">
              ลิ้นชัก {drawer === undefined ? '—' : formatTHB(drawer)}
            </span>
            <span
              className={`rounded-lg px-2 tabular-nums ${even.past ? 'bg-brand-2 text-white' : ''}`}
            >
              {even.past ? 'ผ่านจุดคุ้มทุน' : `คุ้มทุน ${even.cups}/${even.cupsTarget}`}
            </span>
          </p>
        </div>
        <MenuButton />
      </header>

      {/* Tomorrow's tea. Only there when something needs starting. */}
      <PrepBanner reminders={reminders} onTap={() => open('PRODUCTION')} />

      {/* Phone: menu, cart, pay, top to bottom. Tablet: the same three, with the
          cart and pay alongside the menu instead of under it — same flow, bigger
          buttons, nothing added. */}
      <div className="tablet:flex-row flex min-h-0 flex-1 flex-col">
        {/* The menu. */}
        <div className="tablet:min-h-0 tablet:flex-1 tablet:overflow-y-auto tablet:gap-4 tablet:p-4 flex shrink-0 flex-col gap-2 p-2">
          {/* Wraps: a third drink takes the next row rather than squeezing the
            first two until their names no longer fit (CLAUDE.md §9, §12). */}
          <div className="tablet:gap-4 flex flex-wrap gap-2">
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

        <div className="tablet:w-[40%] tablet:max-w-md tablet:flex-none tablet:border-l border-line flex min-h-0 flex-1 flex-col">
          {/* The cart. */}
          <main className="min-h-0 flex-1 overflow-y-auto px-4">
            {cart.length === 0 ? (
              <p className="text-ink-soft py-6 text-center text-lg font-bold">ยังไม่มีรายการ</p>
            ) : (
              <>
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
                      onToggleModifier={(modifierId) =>
                        void toggleModifier(item.line.id, modifierId)
                      }
                      onSetDiscountReason={(reason) =>
                        void setLineDiscountReason(item.line.id, reason)
                      }
                    />
                  ))}
                </ul>
                {/* At the end of the cart, well away from the pay buttons: a wet
                    tap meant for พอดี must never empty the cart. */}
                <div className="flex justify-end py-2">
                  <Button variant="secondary" size="sm" onClick={() => void clearCart()}>
                    ล้างตะกร้า
                  </Button>
                </div>
              </>
            )}
          </main>

          {/* Payment, in thumb reach. */}
          <footer className="safe-bottom border-line border-t px-4 pt-2">
            {pendingSoldOut ? (
              <div
                role="alertdialog"
                aria-label="เลยจำนวนที่มี"
                className="bg-today border-ink mb-2 rounded-xl border-2 p-3"
              >
                <p className="text-xl font-bold">
                  <span aria-hidden="true">⚠ </span>
                  {pendingSoldOut.name_short_th} หมดแล้ว
                </p>
                <p className="text-lg font-bold">เลยจำนวนที่มี — ขายต่อ?</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setPendingSoldOut(null)}
                    className="flex-1"
                  >
                    ไม่ขาย
                  </Button>
                  <Button variant="warning" onClick={confirmOverride} className="flex-1">
                    ขายต่อ
                  </Button>
                </div>
              </div>
            ) : null}

            {done ? (
              <div role="status" className="mb-2 flex flex-wrap items-center justify-between gap-2">
                {done.receipt.cashChange ? (
                  // Read at arm's length with the customer watching: the
                  // largest type on the screen.
                  <p className="text-5xl leading-none font-bold tabular-nums">
                    ทอน {formatTHB(done.receipt.cashChange)}
                  </p>
                ) : (
                  <p className="text-xl font-bold">
                    <span aria-hidden="true">✓ </span>ขายแล้ว {formatTHB(done.receipt.totalNet)}
                  </p>
                )}
                {done.shortfalls > 0 ? (
                  <p className="bg-today rounded-lg px-2 text-lg font-bold">
                    สต็อกติดลบ {done.shortfalls} รายการ
                  </p>
                ) : null}
                <Button variant="secondary" onClick={() => setShowReceipt(true)}>
                  ดูใบเสร็จ
                </Button>
              </div>
            ) : null}

            {error ? (
              // Never styled like "ขายแล้ว": a sale that did not save must not
              // be mistaken for one that did.
              <p
                role="alert"
                className={`mb-2 rounded-xl px-3 py-2 text-lg font-bold ${
                  error.kind === 'danger' ? 'bg-expired text-white' : 'bg-today border-ink border-2'
                }`}
              >
                {error.message}
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

            {/* What is due: the biggest number that is always on screen. */}
            <p className="mb-2 flex items-baseline justify-between">
              <span className="text-xl font-bold">ยอด</span>
              <span className="text-4xl font-bold tabular-nums">{formatTHB(priced.totalNet)}</span>
            </p>

            <PayButtons
              due={priced.totalNet}
              quickTender={settings.quickTender}
              disabled={cart.length === 0 || busy}
              onCash={(received) => confirmPayment('CASH', received)}
              onQr={() => setShowQr(true)}
            />
          </footer>
        </div>
      </div>

      {showReceipt && done ? (
        <ReceiptSheet
          receipt={done.receipt}
          back={{ label: 'กลับไปขาย', onClick: () => setShowReceipt(false) }}
        />
      ) : null}
    </div>
  );
}
