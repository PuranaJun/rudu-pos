# Rudu Tea (ฤดูชา) POS — project rules

Point-of-sale for a **single-stall Thai tea shop**. Runs on the owner's **iPhone/iPad, outdoors, on battery, with no reliable data**, while she is making drinks. One operator, occasionally two.

Currency THB · locale th-TH · timezone Asia/Bangkok (UTC+07:00) · UI strings Thai · code/comments English.

---

## 0. Prime directive

**If ringing up a sale is slower than not ringing it up, the operator stops using this within a week and the data is worthless.**

A standard single-drink cash sale must complete in **under 5 seconds and 3 taps**. Any feature that adds a tap to that path is rejected — no exceptions, no "just this once".

When a design choice trades completeness against speed, **speed wins**.

---

## 1. Hard constraints (physical facts, not preferences)

| Constraint                       | Rule in code                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Outdoor, direct sunlight         | High contrast only. No grey-on-grey, no thin weights. Body text ≥16px, buttons ≥20px bold.                                      |
| No mains power, 8-hour day       | No polling, no timers that wake the app, no background sync loops, minimal animation.                                           |
| Mobile data only, unreliable     | **Offline-first is mandatory.** Every sale completes with zero connectivity. **Never `await` a network call in a user path.**   |
| Wet hands, ice, condensation     | Touch targets ≥48×48px real estate (aim 56px+ on the sell screen). Never make long-press or swipe the _only_ path to an action. |
| One thumb, cup in the other hand | Primary actions in the **lower half** of the screen.                                                                            |
| Device may die mid-day           | **Persist every cart line the moment it is added, not at payment.** Sales survive a crash, force-quit or battery death.         |

---

## 2. Domain model — the part most likely to be built wrong

**This shop has no finished product.** A cup is assembled at the moment of sale from 3–5 independent **components**, each with its own unit, batch, yield, lifecycle and shelf life. A generic "units of product in stock" model is wrong and must not be introduced.

### 2.1 Non-negotiable invariants

1. **BOM is variant-level, never product-level.** Hot pear has a different bill of materials from iced pear (agar jelly melts at ~85 °C, so hot omits the jelly and always includes peach gum). A product-level BOM produces wrong stock and wrong cost.
2. **Stock movements are the ledger.** `qty_remaining` is _computed_ from `stock_movement` rows, never mutated as a counter in two places. This is what makes overrides and voids reverse cleanly.
3. **One component consumes another.** Producing a `COMP_JELLY_WHITE_GOJI` batch deducts **500 ml** from an active `COMP_TEA_WHITE` batch (`parent_batch_id`). If this is not modelled, the tea base silently over-reports and the shop runs out mid-service.
4. **FEFO.** Two active batches of one component → consume **oldest ready first**, show combined remaining.
5. **Voids restore stock.** A completed sale is **never edited** — it is voided with a reason and re-rung. Voiding reverses every component deduction.
6. **Warn, never block.** Expired batch, zero stock, uncut jelly → warn loudly, allow override, **record the override**.
7. **Nothing about recipes, prices or costs is compiled in.** The recipes have not been taste-tested yet. Every quantity, price and cost is a row in the database, editable in settings.
8. **Price and cost changes are effective forward only.** Historical sale lines keep the `unit_price` and `unit_cost` that applied at the time. Changing a BOM or a cost must never rewrite history.

### 2.2 Available cups — the most useful number in the app

```
available_cups(variant) = floor( min over components in BOM of
                                 ( sum(batch.remaining where state is sellable) / bom.qty_per_cup ) )
```

Show it **per drink on the sell screen**, and **name the limiting component** when it binds:

> `สาลี่ขาว เหลือ 8 แก้ว — จำกัดโดยกอง B`

This is more useful than the day's revenue: it decides whether to push a drink or slow it down.

- A component at zero makes its drinks **sold out** — grey them out, but allow an override (the operator may stretch a batch).
- **Modifier components do not limit `available_cups`.** If basil seed runs out, the _modifier_ goes unavailable; the tamarind drink stays sellable.

### 2.3 Component lifecycle

| State                   | Sellable | Notes                                                                    |
| ----------------------- | :------: | ------------------------------------------------------------------------ |
| `STEEPING`              |    ❌    | Cold brew in the fridge, timer running                                   |
| `SOAKING`               |    ❌    | Peach gum hydrating                                                      |
| `BLANCHED`              |    ✅    | Peach gum blanched and chilled                                           |
| `SLAB`                  |    ❌    | **Jelly set in the tray, uncut — not sellable**                          |
| `CUT`                   |    ✅    | Jelly cut into 1 cm cubes — **shelf life drops from 3 days to same-day** |
| `READY`                 |    ✅    | Everything else                                                          |
| `EXPIRED` / `DISCARDED` |    ❌    |                                                                          |

Cutting a slab is an **explicit action that records grams cut**, so the uncut remainder keeps its longer clock. Prompt for it on the open-day screen.

---

## 3. Money and rounding

- **All persisted money is an integer in satang** (1 THB = 100 satang). No floats in the database for money.
- `component.cost_per_unit` is a float in **THB per ml or per g** (not per cup) — so BOM changes never corrupt costs.
- Line cost = `round(qty_per_cup × cost_per_unit × 100)` satang, summed over BOM + packaging + modifiers.
- Every sale line stores a **snapshot** of `unit_price` and `unit_cost`.
- Prices display as whole baht (`฿40`), never `฿40.00`.

---

## 4. Pricing, promotions, payment

| Rule              | Behaviour                                                                                                                                                                                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PROMO_TWO_CUP`   | 10 THB off per pair of qualifying **drinks** in one transaction: `floor(qty/2) × 10`. Bottles excluded. Free/0 THB loyalty lines do **not** qualify. **Applies automatically** — the operator will forget, and a forgotten discount is a complaint.                  |
| `PROMO_RAINY_DAY` | Hot pear 59 → 54. **Manually toggled by the operator. Never date-automated.** `VAR_PEAR_HOT` only.                                                                                                                                                                   |
| `LOYALTY_STAMP`   | Physical paper punch card. Buy 10 get 1 free, one stamp per drink. **Do not build customer accounts, phone capture or a CRM.** The POS only rings the free drink at 0 THB: it **counts as a unit, deducts components, lands in COGS, and is excluded from revenue.** |

**Every discounted or zero-price line must record a reason code:** `PROMO_TWO_CUP`, `PROMO_RAINY_DAY`, `LOYALTY_REDEEM`, `STAFF_DRINK`, `COMP_GOODWILL`. Without a reason, shrinkage and generosity are indistinguishable.

**Payment** — one method per sale, no splits, no cards, no e-wallets.

- **Cash** (majority): change calculation + drawer balance. Opening float 1,500 THB. Quick-tender: **40 · 50 · 59 · 100 · 500 · 1000 · exact**.
- **PromptPay QR**: a **static printed QR**. No gateway, no callback. The customer scans and shows their phone; **the operator confirms manually.** The system must **never** wait for, poll for, or claim to have verified a payment.

---

## 5. Tax

- **Not VAT-registered.** **Receipts must not show VAT. Do not build a tax engine.** The price is simply the price.
- Receipts are optional and rarely requested — **never prompt by default**; offer a "show receipt" action.
- Track cumulative annual revenue and warn when approaching **1.8M THB** (the VAT threshold — a real compliance event with lead time).

---

## 6. Core workflows

### 6.1 Sell — the only workflow that must be fast

```
Tap drink → [temp / modifier sheet only if applicable] → Tap CASH or QR → Done
```

- Plain tamarind, cash = **2 taps**. Most common sale, must be the fastest.
- Pear defaults to **ICED**; HOT is one extra tap. Temperature is a **variant selection, not a second menu button**.
- Second identical drink = **quantity stepper**, not a repeat of the flow.
- `PROMO_TWO_CUP` applies automatically when the cart qualifies.
- On payment, deduct every BOM component **in one transaction**.

### 6.2 Open day

Confirm opening float (default 1,500) · confirm active batches and remaining quantities · **cut today's jelly (records grams)** · select operator · optionally toggle the rainy-day promo.

### 6.3 Record a production batch

Pick component → quantity (defaults from the catalog) → made-at time. `ready_at` and `expires_at` compute automatically from the lifecycle. For white-tea jelly, **pick the source tea batch and deduct 500 ml.** Usually done the evening before, at home, on the same device.

### 6.4 Close day

Per component: how much is left → **carry over** (within shelf life) or **discard** → count cash → record variance → day summary.
Same-day components (`CUT` jelly, Pile B pear, basil seed) **default to discarded and must be one tap**.

---

## 7. Reporting — build top-down, stop at Tier 2

**Tier 1 (day one)**

- **Today, live**: cups sold · revenue · **available cups per drink with the limiting component named** · cash in drawer.
- **Daily close**: units by variant · revenue · COGS · gross profit · discounts by reason · **waste per component** · cash variance.
- **Breakeven marker**: fixed cost **370 THB/day**. Clear "past breakeven" indicator at **10 cups**.

**Tier 2 (month two)**

- Sales by day of week and hour — decides which market days to keep.
- **Attach rate for paid modifiers** — the plan assumes ~1 in 3; that needs checking.
- **Waste % per component** — target under 10%. This is a first-class report.
- **Prep reminders**: "start red tea steeping by 21:00 to be ready tomorrow" (10 h and 12–14 h lead times).
- Average basket size — tests whether the 2-cup discount works.

> **The financial risk is product thrown away, not cost per cup.** Breakeven is 10 cups/day and gross margin is ~81%; a day cannot realistically lose money on margin. It loses money on a batch that did not sell. Waste reporting matters more than margin reporting.

---

## 8. Data model

Offline-friendly. Every row carries a **client-generated UUID** and a nullable `synced_at`.

```
product          id, name_full_th, name_short_th, name_en, base_price,
                 advisory_th, is_active, sort_order
variant          id, product_id, name_th, temp (ICED|HOT), price_override,
                 packaging_set_id, is_active
component        id, name_th, unit (ML|G), default_batch_qty, yield_cups,
                 shelf_life_hours, cut_shelf_life_hours, lead_time_hours,
                 cost_per_unit, lifecycle (SIMPLE|STEEP|SOAK_BLANCH|SLAB_CUT),
                 recipe_note_th, is_batch_tracked
bom              id, variant_id, component_id, qty_per_cup      -- VARIANT-level
packaging_set    id, name, items[] {packaging_item_id, qty}
packaging_item   id, name_th, unit_cost
modifier         id, name_th, price_delta, is_paid, kind (PAID|PREP),
                 applies_to_variant_ids[], component_id?, qty_per_cup?,
                 cost_delta, advisory_th, sort_order
component_batch  id, component_id, made_at, qty_made, state, ready_at,
                 expires_at, parent_batch_id?, note
sale             id, created_at, business_date, operator_id, total_gross,
                 total_discount, total_net, total_cost,
                 payment_method (CASH|PROMPTPAY), cash_received, cash_change,
                 is_voided, void_reason, device_id, synced_at
sale_line        id, sale_id, variant_id, qty, unit_price, line_discount,
                 discount_reason, unit_cost
sale_line_mod    id, sale_line_id, modifier_id, price_delta, cost_delta
stock_movement   id, sale_line_id?, component_batch_id, qty_delta,
                 reason (SALE|PRODUCTION|WASTE|ADJUSTMENT|OVERRIDE|VOID_REVERSAL)
waste_event      id, component_batch_id, qty_discarded, reason
                 (EXPIRED|END_OF_DAY_PERISHABLE|QUALITY|SPILLAGE), recorded_at, note
cash_session     id, opened_at, closed_at, operator_id, opening_float,
                 expected_cash, counted_cash, variance, note
setting          key, value
```

**Sync:** last-write-wins per record is fine. One device, one operator; real conflicts are near-impossible. **Do not build CRDTs.** v1 has no server at all — local IndexedDB plus export/import backup.

**Business date** = the `cash_session` the sale belongs to; fall back to the Asia/Bangkok calendar date. Never use UTC date for reports.

---

## 9. Naming — two name fields, always

Every product has `name_full_th` (marketing copy, printed A3 menu board **only**) and `name_short_th` (**what the POS renders everywhere** — buttons, cart lines, receipts, reports, sold-out banners).

`สาลี่ขาวสมุนไพรจีน` is 18 characters and will wrap to three lines or truncate on a phone button, and **a truncated button is a misread button at speed.** Customers say "สาลี่".

**Never truncate a name with an ellipsis.** If it does not fit, the short name is wrong and should be edited in settings.

The pair **แดง / ขาว** (red / white) encodes the tea base. Keep both short names visible side by side.

---

## 10. Business rules and edge cases

| Situation                           | Required behaviour                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Component hits zero mid-service     | Affected drinks **sold out**, greyed out, override allowed and recorded                                                |
| Sale rung against an expired batch  | Warn prominently, allow override, record it                                                                            |
| Jelly slab not yet cut at open      | Drink **not sellable** until the cut action runs — prompt on open-day                                                  |
| Two active batches of one component | **FEFO**; show combined remaining                                                                                      |
| Loyalty free drink                  | 0 THB, reason `LOYALTY_REDEEM`; counts as a unit, deducts components, in COGS, **not in revenue**                      |
| Customer changes mind after payment | **Void with a reason and re-ring.** Voiding restores component quantities. Never edit a closed sale.                   |
| Device dies mid-day                 | Every line persisted as added                                                                                          |
| `PREP_NO_SOLIDS` (ไม่ใส่เนื้อ)      | **Still deducts the components** by default (they were portioned for this cup); operator may mark waste-free           |
| `PREP_LESS_SWEET` (หวานน้อย)        | Concentrate 50 → 35 ml, more dilution water. **Never add plain water to a finished cup.** Deduct the reduced quantity. |
| Pre-order via LINE                  | Ring as a normal sale at pickup. **Do not build order management** — a handful a week.                                 |
| Recipe change after taste tests     | BOM quantities editable; must not rewrite historical `unit_cost`                                                       |

**Advisories** are per-product and per-modifier **data**, shown at point of sale, never hardcoded strings:

- Pear: `มีคาเฟอีน · สตรีมีครรภ์แนะนำเลี่ยง`
- Salted plum: contains a pit — **choking notice must be displayed and spoken**

---

## 11. Explicit non-requirements

Listed so they are not inferred from generic POS templates. **Do not build:**

❌ Table management, order numbers, kitchen display (customer waits ~40 s at the counter)
❌ Customer accounts, CRM, marketing, SMS/email
❌ Barcode scanning · multi-store · franchise hierarchy
❌ **Ingredient-level depletion** (grams of tamarind paste, grams of agar) — **component-batch level is the right granularity**; ingredient-level is unmaintainable for two people
❌ Employee time clock, payroll, scheduling
❌ Tax engine, e-Tax invoice, accounting export
❌ Online ordering, delivery, purchase orders
❌ Login per sale — **operator selection at open-day is enough**
❌ **Any feature that adds a tap to the standard sale**

---

## 12. Open decisions — do not hardcode around these

| Item                         | Status                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Third drink**              | Planned, not designed. Seasonal rotating slot. Clear liquid, no solids, **caffeine-free**, priced 40 or 59 — **no third price point.** The catalog must accept a new product, components and BOM rows **without code changes.** |
| **Recipes not taste-tested** | Cold-brew ratios, agar concentration and timings are calculated estimates. **Expect BOM quantities and costs to change.** Nothing compiled in.                                                                                  |
| **Caffeine-free cup**        | No drink currently suits children, pregnant or caffeine-sensitive customers. Per-product advisory flag must exist.                                                                                                              |
| **Second operator**          | Money-handling may split from drink-making. Don't assume one user — but **don't require login per sale.**                                                                                                                       |
| **Branding text**            | Sign reads `ชาต้มเอง วันต่อวัน`, becomes `ชา 3 แก้ว เปลี่ยนตามฤดู` at the third drink. Any branding the POS shows is **editable text**.                                                                                         |
| **Legal, surface once**      | Selling bottles for customers to carry home is fine. **Wholesaling or shipping by post** reclassifies them as pre-packaged food requiring Thai FDA (อย.) registration. Flag if a delivery/wholesale channel is ever added.      |

---

## 13. Tech stack and conventions

- **Vite + React + TypeScript**, Tailwind CSS. No SSR, no Next.js — this is a static offline PWA.
- **Dexie (IndexedDB)** for storage; `dexie-react-hooks` `useLiveQuery` for reactive reads. **No `localStorage` for business data.**
- **Zustand** for transient UI state only (current cart is persisted to Dexie, not held only in memory).
- **`vite-plugin-pwa`** for the service worker and manifest. Precache the app shell; the app must cold-start with the phone in airplane mode.
- IDs: `crypto.randomUUID()`.
- Dates stored as ISO-8601 UTC strings; **displayed** in Asia/Bangkok.
- Business logic lives in `src/domain/` as **pure functions** (`availableCups`, `applyPromotions`, `costOfLine`, `deductBom`) with unit tests. UI components never compute stock or money inline.
- All seed data in `src/data/seed.ts`, loaded once on first run into Dexie, **then owned by the database** — never re-read from code.
- `npm run typecheck`, `npm run lint`, `npm run test` must pass before any commit.

### iOS specifics that are easy to get wrong

- Must be **installed via Add to Home Screen** for standalone mode and durable storage. Call `navigator.storage.persist()` on first launch.
- `viewport-fit=cover` + `env(safe-area-inset-*)` padding, or the home-bar eats the payment buttons.
- `touch-action: manipulation` on all buttons to kill the 300 ms double-tap-zoom delay.
- `overscroll-behavior: none` and `height: 100dvh` — no rubber-band scrolling on the sell screen.
- `-webkit-user-select: none` on buttons so a wet mis-tap doesn't select text.
- Request a **Screen Wake Lock** while a cash session is open.
- iOS can still evict IndexedDB in edge cases. **A daily local backup export is part of the product, not a nice-to-have.**

---

## 14. Success criteria

After one month the system succeeds if:

1. The operator still uses it on a busy day — **it never became the bottleneck**.
2. Daily cash variance is consistently under 20 THB.
3. **Waste per component is visible and trending down.**
4. The owner can answer "which market day is worth keeping?" from data rather than memory.

**It fails if ringing up a sale takes longer than making the drink.**
