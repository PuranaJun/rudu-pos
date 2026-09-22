# Rudu Tea POS — step-by-step build prompts for Claude Code

Copy each **PROMPT** block into Claude Code, one at a time, in order. Don't skip ahead and don't merge steps — each one ends with something you can check on your actual iPhone.

**How to work through this**

1. Run one prompt. Let it finish.
2. Run the **CHECK**. If it fails, tell Claude Code what you saw — don't move on.
3. Commit (`git add -A && git commit -m "step N: ..."`) before starting the next step.
4. If Claude Code starts building something in the ❌ list in `CLAUDE.md`, say **"that's a non-requirement, remove it"** and it will.

**Before Step 0**, put these three files in an empty folder:

```
rudu-pos/
├── CLAUDE.md              ← project rules, Claude Code reads this every turn
└── docs/
    └── seed-data.md       ← all the numbers
```

Then run `claude` inside `rudu-pos/`.

**A note on scope.** Steps 0–9 are the system. Steps 10–14 make it survivable on a real market day. Steps 15–16 are optional and can wait months. Resist adding anything not listed.

---

## Phase 1 — Skeleton you can hold in your hand (Steps 0–3)

### Step 0 — Scaffold and deploy on day one

Deploying first sounds backwards. It isn't: iOS will not install a PWA or run a service worker over plain HTTP, so without a live HTTPS URL you cannot test the thing you are actually building until the very end. Get a URL now, then every later step is checkable on the real phone in the real sunlight.

> **PROMPT**
>
> Read CLAUDE.md and docs/seed-data.md before you start.
>
> Scaffold the project. Nothing domain-specific yet — I want a deployable shell.
>
> - Vite + React + TypeScript, Tailwind CSS, `vite-plugin-pwa`
> - Dependencies: `dexie`, `dexie-react-hooks`, `zustand`. Dev: `vitest`, `@testing-library/react`, `eslint`, `prettier`
> - Scripts: `dev`, `build`, `preview`, `typecheck`, `lint`, `test`
> - `src/` folders: `domain/`, `db/`, `data/`, `screens/`, `components/`, `lib/`
> - PWA manifest: name "ฤดูชา POS", short_name "ฤดูชา", `display: standalone`, `orientation: portrait`, `theme_color` and `background_color` a warm off-white, icons at 192/512 (generate simple placeholder icons with the Thai character ฤ)
> - `index.html`: lang="th", `viewport-fit=cover`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style=default`
> - Global CSS: `height: 100dvh`, `overscroll-behavior: none`, `touch-action: manipulation` on buttons, `-webkit-user-select: none` on buttons, safe-area-inset padding on a bottom bar
> - One placeholder screen: big centred text "ฤดูชา POS" plus a build timestamp so I can tell a deploy landed
> - `git init`, `.gitignore`, initial commit
>
> Then tell me the exact commands to (a) push this to a new GitHub repo and (b) connect it to Vercel for automatic deploys. Give me the commands, don't run the GitHub/Vercel steps yourself.

**CHECK** — push and deploy. Open the Vercel URL in Safari on your iPhone → Share → **Add to Home Screen**. Launch from the home screen icon: no Safari address bar, no rubber-band bounce when you drag, the text is not hidden behind the home bar. Turn on **airplane mode** and launch it again — it must still open.

---

### Step 1 — Database and seed data

> **PROMPT**
>
> Build the data layer. Follow §8 of CLAUDE.md for the schema and docs/seed-data.md for the values.
>
> - `src/db/database.ts` — a Dexie database `RuduPosDB`, version 1, with every table in §8. Index what reports and stock queries will need: `sale.business_date`, `sale.created_at`, `component_batch.component_id`, `component_batch.state`, `stock_movement.component_batch_id`, `stock_movement.sale_line_id`.
> - `src/db/types.ts` — TypeScript types for every table. String-literal union types for `temp`, `state`, `lifecycle`, `payment_method`, `reason`, `unit`, `kind` — no bare strings.
> - Every row gets `id: crypto.randomUUID()` and a nullable `synced_at`. Timestamps are ISO-8601 UTC strings.
> - **All money is an integer in satang.** Add `src/lib/money.ts` with `toSatang`, `toBaht`, `formatTHB` (formats `4000` as `฿40`, never `฿40.00`) and unit tests.
> - `src/data/seed.ts` — every product, variant, component, BOM row, packaging item, packaging set, modifier and setting from docs/seed-data.md. Seeding runs **once** on first launch, guarded by a `settings` flag. After that the database owns the data and seed.ts is never read again.
> - A dev-only "reset and reseed database" button, hidden behind a long-press on the version number.
>
> Write a test asserting the seed loads and that `bom` rows exist for all four variants with the quantities in §4 of seed-data.md — especially that `VAR_PEAR_HOT` has **no** `COMP_JELLY_WHITE_GOJI` row and **does** have a 20 g `COMP_PEACH_GUM` row.

**CHECK** — `npm run test` passes. In the browser's dev tools, Application → IndexedDB → `RuduPosDB` shows the seeded rows.

---

### Step 2 — The cost engine, tested against the margin table

The margin table in `docs/seed-data.md` §6.3 is arithmetic I have already verified — all seven rows reconcile to the satang. Making it a test fixture means any later change to a recipe or a cost that quietly breaks the model fails loudly instead.

> **PROMPT**
>
> Build the cost engine as pure functions in `src/domain/cost.ts`. No React, no Dexie imports — take data in, return numbers out.
>
> - `materialCost(variant, modifiers, prep)` → satang. Sums BOM qty × `component.cost_per_unit`, plus modifier component costs, plus the per-cup chrysanthemum garnish on pear variants.
> - `packagingCost(variant, prep)` → satang, from the variant's `packaging_set`. `PREP_NO_ICE` removes the ice item. `PREP_TAKEAWAY_BAG` changes nothing — the bag is already in every set.
> - `PREP_LESS_SWEET` reduces concentrate from 50 ml to 35 ml in both cost and deduction.
> - `lineCost(...)` → material + packaging, rounded to the nearest satang.
>
> Then write `src/domain/__tests__/cost.test.ts` reproducing **every row** of the margin table in docs/seed-data.md §6.3 exactly — all seven variants plus the blended average of 9.22 cost / 40.28 profit / 81.4% GP.
>
> Costs must be read from the database, never from constants in the cost module.

**CHECK** — `npm run test` shows all seven margin rows green.

---

### Step 3 — Stock engine: the ledger, FEFO, available cups

This is the step most likely to be built wrong, so it gets built alone and tested before any screen touches it.

> **PROMPT**
>
> Build the stock engine in `src/domain/stock.ts`, pure functions plus a thin Dexie repository in `src/db/stock-repo.ts`. Follow §2 of CLAUDE.md exactly.
>
> - **`qty_remaining` is always computed from `stock_movement` rows.** Never store or mutate a counter. Add `batchRemaining(batchId, movements)`.
> - `sellableStates = ['READY', 'CUT', 'BLANCHED']`. `STEEPING`, `SOAKING`, `SLAB`, `EXPIRED`, `DISCARDED` are not sellable.
> - `availableCups(variant, batches, movements, boms)` → `{ cups, limitingComponentId }`. `floor(min over BOM components of (sum of sellable remaining / qty_per_cup))`. Return which component bound the minimum.
> - **Modifier components never limit `availableCups`.** Add a separate `modifierAvailable(modifier, ...)`.
> - `deductForSaleLine(...)` → the `stock_movement` rows to write. **FEFO**: consume the oldest sellable batch by `expires_at` first, spilling into the next batch when one is short. All movements for a sale write in a single Dexie transaction.
> - `reverseForSale(saleId)` → movements with reason `VOID_REVERSAL` that exactly undo the sale's deductions.
> - `expiryStatus(batch, now)` → `OK | EXPIRING_SOON | EXPIRED`, using `cut_shelf_life_hours` once a slab is cut.
>
> Tests I want to see:
>
> 1. Tamarind with red tea 5,000 ml, tamarind concentrate 3,000 ml, chrysanthemum jelly 1,000 g → 33 cups, limited by `COMP_JELLY_CHRYS`.
> 2. Fresh pear at 420 g caps iced pear at 20 cups, limited by `COMP_PEAR_FRESH`.
> 3. `VAR_PEAR_HOT` is **not** limited by jelly stock at all, and **is** limited by peach gum.
> 4. Basil seed at zero → tamarind still sellable, `MOD_BASIL_SEED` unavailable.
> 5. Two red tea batches, older expiring first → a sale drains the older one first and spills correctly.
> 6. A jelly slab in `SLAB` state contributes zero; after the cut action it contributes.
> 7. Sell 5 cups, then void → every component returns to its exact starting quantity.

**CHECK** — `npm run test` green, especially test 7.

---

## Phase 2 — The thing that has to be fast (Steps 4–6)

### Step 4 — The sell screen

> **PROMPT**
>
> Build the sell screen — `src/screens/SellScreen.tsx`. This is the screen from §0 and §6.1 of CLAUDE.md: **under 5 seconds, 3 taps, one thumb, wet hands, direct sunlight.**
>
> Layout, portrait phone:
>
> - Top third: today's running total — cups sold and revenue, large. Under each drink name, **available cups with the limiting component named** when it binds, e.g. `สาลี่ขาว เหลือ 8 แก้ว — จำกัดโดยกอง B`.
> - Middle: **two big drink buttons side by side**, `มะขามแดง` and `สาลี่ขาว` — `name_short_th` only, never `name_full_th`, never truncated with an ellipsis. Each at least 44% of the screen width and 120px tall. Price in the corner. The bottle is a smaller third button below.
> - Bottom third: the cart, and the **CASH** and **QR** buttons within thumb reach.
>
> Behaviour:
>
> - Tapping a drink adds it to the cart **immediately** — no confirmation, no modal for tamarind.
> - Pear defaults to ICED. HOT is a single extra tap on a temperature row that appears in the cart line, not a blocking modal.
> - Tapping the same drink again increments quantity. Each cart line has a **stepper**, no swipe-to-delete as the only path.
> - Paid modifiers live behind one "+" on the cart line. Hide `MOD_PEACH_GUM` when the line is `VAR_PEAR_HOT`.
> - Selecting `MOD_SALTED_PLUM` shows its advisory (`มีเมล็ด ระวังสำลัก`) prominently — it is per-modifier data, not a hardcoded string.
> - Sold-out drinks are greyed but still tappable; tapping shows "เลยจำนวนที่มี — ขายต่อ?" with an override that gets recorded.
> - **Every cart change persists to Dexie immediately.** Reloading mid-cart restores it.
> - **Nothing in the tap path awaits a network call.** Reads via `useLiveQuery`, writes fire-and-forget.
>
> Style: white background, near-black text, drink buttons in strong saturated colour (deep red for มะขามแดง, warm amber for สาลี่ขาว). No grey-on-grey, no thin fonts, no animation longer than 100ms.

**CHECK** — on the phone, from the home screen: tap `มะขามแดง`, tap `CASH`. Time it. If it is not clearly under 5 seconds, tell Claude Code what felt slow. Force-quit the app mid-cart and reopen — the cart is still there.

---

### Step 5 — Payment, promotions, discount reasons

> **PROMPT**
>
> Build payment. Follow §4 of CLAUDE.md.
>
> - `src/domain/promotions.ts`, pure: `PROMO_TWO_CUP` gives `floor(qualifyingDrinks / 2) × 10 THB` off, **applied automatically**, bottles excluded, 0 THB loyalty lines excluded from the count. `PROMO_RAINY_DAY` applies 5 THB off `VAR_PEAR_HOT` only when the operator has manually toggled it on — **never date-automated**. Unit-test both, including 4 drinks → 20 THB off, and 1 drink + 1 bottle → no discount.
> - **Cash**: full-screen tender pad with quick-tender buttons 40 / 50 / 59 / 100 / 500 / 1000 and "พอดี" (exact). Change shown in very large type — this is read at arm's length with a customer watching. One tap to confirm.
> - **PromptPay**: shows the static QR image from settings, full screen and bright. Below it a single "ลูกค้าจ่ายแล้ว" button the **operator** taps. The app must never poll, wait, or claim to have verified anything. Make it obvious in the UI that confirmation is manual.
> - A discount/free action on each cart line requiring a reason from `PROMO_TWO_CUP`, `PROMO_RAINY_DAY`, `LOYALTY_REDEEM`, `STAFF_DRINK`, `COMP_GOODWILL`. **No line may be discounted or zeroed without a reason.**
> - A `LOYALTY_REDEEM` line rings at 0 THB, counts as a unit, deducts components, lands in COGS, and is **excluded from revenue**.
> - On confirm: write `sale`, `sale_line`, `sale_line_mod`, and all `stock_movement` rows **in one Dexie transaction**, snapshotting `unit_price` and `unit_cost`. Then clear the cart and return to the sell screen.
> - Receipts: **never prompt.** A "ดูใบเสร็จ" action on the completed-sale toast only. **No VAT line anywhere.**

**CHECK** — ring 2 tamarind: the 10 THB discount appears by itself, total 70. Ring 1 tamarind + 1 bottle: no discount. Pay 100 cash for a 40 THB drink: change reads ฿60 in large type.

---

### Step 6 — Void and crash safety

> **PROMPT**
>
> - Add a sales list for the current session, newest first, showing time, items, total, payment method.
> - **Void**, not edit.** Voiding requires a reason, sets `is_voided`, writes `VOID_REVERSAL` stock movements that exactly restore every component, and removes the sale from revenue and COGS. Never delete or mutate a sale row.
> - A voided sale shows struck through in the list with its reason.
> - Add an integration test: seed stock → ring 3 mixed sales → void one → assert component quantities, revenue and COGS all match a fresh calculation.
> - Verify cart persistence survives a hard reload at every stage: empty, one line, line with modifiers, on the payment screen. Write a test for it.

**CHECK** — ring a pear, check `สาลี่ขาว เหลือ N` drops by one, void it, watch N go back up.

---

## Phase 3 — The day around the selling (Steps 7–9)

### Step 7 — Open day

> **PROMPT**
>
> Build the open-day flow (§6.2 of CLAUDE.md). It runs when there is no open `cash_session`.
>
> 1. **Operator** — pick from the `operators` setting. No password. Never asked again during the day.
> 2. **Opening float** — defaults to 1,500 THB, one tap to accept.
> 3. **Active batches** — list every component with sellable stock, its remaining quantity, and its expiry status with a colour. Anything expired or expiring today is loud. Remaining quantity is editable here (writes an `ADJUSTMENT` movement, never a direct overwrite).
> 4. **Cut today's jelly** — for every batch in `SLAB` state, a prompt: "ตัดเยลลี่วันนี้" with a grams input defaulting to the full slab. Cutting creates a `CUT` batch with a 24-hour clock and leaves the uncut remainder on its original 72-hour clock. **A drink whose jelly is uncut is not sellable — say so explicitly on this screen.**
> 5. **Rainy day promo** — an optional toggle, off by default.
> 6. Then open the session and go to the sell screen.
>
> Skippable in one tap for a day where nothing changed, but the jelly-cut prompt must not be skippable if a `SLAB` batch exists.

**CHECK** — with a `SLAB` jelly batch seeded, the pear button is unsellable until you run the cut action, then it becomes sellable and `available cups` is correct.

---

### Step 8 — Production batches

> **PROMPT**
>
> Build the production batch screen (§6.3 of CLAUDE.md). Mostly used at home the evening before, on the same phone.
>
> - Pick a component → quantity prefilled from `default_batch_qty` → made-at time defaulting to now, editable.
> - `ready_at` and `expires_at` compute from `lifecycle` and `lead_time_hours`: `STEEP` starts `STEEPING` and becomes `READY` at `made_at + lead_time`; `SOAK_BLANCH` goes `SOAKING` → `BLANCHED` via an explicit action; `SLAB_CUT` starts `SLAB`; `SIMPLE` starts `READY`.
> - **`COMP_JELLY_WHITE_GOJI` requires picking a source `COMP_TEA_WHITE` batch and deducts 500 ml from it**, sets `parent_batch_id`, and writes a `PRODUCTION` stock movement. Warn if the chosen batch has under 500 ml. Test this.
> - Show `recipe_note_th` as a read-only reminder while recording the batch.
> - A batch list showing state, remaining, and a countdown — "พร้อมใน 6 ชม." while steeping, "เหลือ 1 วัน" when near expiry.
> - **Prep reminders** on the home screen: if there is no red tea batch that will be ready by tomorrow morning, show "เริ่มแช่ชาแดงก่อน 21:00". Same for white tea at 19:00. Read the times from settings. A banner, not a notification — no background wake-ups.

**CHECK** — record a white-tea jelly batch. The source white-tea batch drops by exactly 500 ml, and `available cups` for pear drops with it.

---

### Step 9 — Close day and waste

Waste is where this shop actually loses money — not margin. Build this screen as carefully as the sell screen.

> **PROMPT**
>
> Build close day (§6.4 of CLAUDE.md).
>
> 1. **Per component, how much is left** — prefilled with the computed remaining, editable if the operator eyeballs it differently.
> 2. Each component gets **carry over** or **discard**. Same-day components (`CUT` jelly, `COMP_PEAR_FRESH`, `COMP_BASIL_SEED`) **default to discard and must be a single tap to confirm.** Components still inside shelf life default to carry over.
> 3. Discarding writes a `waste_event` with a reason: `EXPIRED`, `END_OF_DAY_PERISHABLE`, `QUALITY`, `SPILLAGE`. Default `END_OF_DAY_PERISHABLE` for same-day items so the common case is one tap.
> 4. **Count cash** — a denomination pad or a single total, operator's choice. Show expected (float + cash sales) vs counted vs variance. **Record the variance, never block on it.**
> 5. **Day summary**: units by variant · revenue · COGS · gross profit · discounts grouped by reason · **waste per component in both quantity and THB** · cash variance · a clear past-breakeven marker at 10 cups against the 370 THB/day fixed cost.
> 6. Close the `cash_session`.
>
> The summary must be readable on one phone screen without scrolling past the important numbers.

**CHECK** — do a full dry run: open day → ring 5 mixed sales → close day. Revenue, COGS and waste numbers all add up by hand.

---

## Phase 4 — Survivable on a real market day (Steps 10–14)

### Step 10 — Reports, Tier 1 only

> **PROMPT**
>
> Build Tier 1 of §7 in CLAUDE.md, and stop there.
>
> - **Today, live** — already on the sell screen; make sure cups, revenue, available-cups-with-limiting-component, and cash in drawer are all correct and update live.
> - **Daily close** — the summary from Step 9, re-openable for any past day.
> - **Breakeven marker** — cups sold against 10, and gross profit against 370 THB/day.
> - **Annual revenue** — a running total with a warning band as it approaches 1.8M THB. No VAT calculation anywhere.
>
> Charts: at most one, and only if it beats a number. **Do not build Tier 2 or Tier 3 yet.**

**CHECK** — after a dry-run day, the daily close matches what you calculate by hand.

---

### Step 11 — Settings: everything editable, nothing compiled in

> **PROMPT**
>
> Build settings. Per §2.1 item 7 and §12 of CLAUDE.md, **every recipe, price and cost must be editable here** — the recipes have not been taste-tested and will change.
>
> - **Products and variants** — short name, full name, price, advisory text, active flag, sort order.
> - **Components** — name, unit, default batch quantity, shelf life, cut shelf life, lead time, `cost_per_unit`, lifecycle, recipe note.
> - **BOM** — edit `qty_per_cup` per **variant** and component. Add or remove rows.
> - **Packaging** — item costs and set composition.
> - **Modifiers** — price, cost, which variants they apply to, advisory text.
> - **Promotions, float, quick-tender amounts, fixed daily cost, operators, branding text, PromptPay QR image upload.**
> - **All changes are effective forward only.** Historical sale lines keep their snapshot. Add a test: change a price and a cost, then confirm a sale rung before the change still reports its original price, cost and gross profit.
> - Prove the catalog is data-driven: add a **third drink** through settings alone — new product, new component, new BOM rows, priced at 40 — and confirm it appears on the sell screen with correct available-cups and costing, **with no code change.** Write this as a test.

**CHECK** — add a fake third drink in settings. It shows up on the sell screen and costs correctly. Then delete it.

---

### Step 12 — iOS hardening

> **PROMPT**
>
> Harden for iPhone and iPad per §13 of CLAUDE.md. Test on a real device, not just the simulator.
>
> - Call `navigator.storage.persist()` on first launch; show a one-time note if it is denied.
> - Request a **Screen Wake Lock** while a cash session is open; release it on close and re-acquire on visibility change.
> - Safe-area insets on every fixed bar. The CASH button must not sit under the home indicator.
> - `touch-action: manipulation` everywhere; confirm no 300ms delay and no double-tap zoom.
> - `overscroll-behavior: none`, `100dvh` — the sell screen must not rubber-band or scroll.
> - Audit every touch target on the sell and payment screens: **minimum 48×48px, 56px+ preferred.**
> - **Sunlight contrast audit**: every text/background pair at 7:1 or better. No grey-on-grey. Increase font weights.
> - Service worker: app shell precached, cold start works in airplane mode, and a non-intrusive "อัปเดตแล้ว" toast when a new version is available — never an auto-reload mid-sale.
> - Add an iPad layout: same flow, drink buttons larger, cart alongside instead of below. Do not add features for iPad.
> - Confirm the app never fetches anything at runtime after install.

**CHECK** — the real test. Take the phone **outside into direct sun** in airplane mode and ring ten sales with one thumb and a wet hand. Everything readable, nothing mis-tapped, nothing hidden behind the home bar.

---

### Step 13 — Backup and restore

iOS can evict IndexedDB in edge cases, and this phone holds the only copy of the business's records. Treat backup as part of the product.

> **PROMPT**
>
> - **Export**: a full JSON dump of every table, filename `rudu-backup-YYYY-MM-DD.json`, saved via the share sheet so it can go to iCloud Drive, Files or LINE.
> - **Auto-prompt the export at close of day**, one tap — this is the routine that keeps the data alive.
> - **Import**: restore from a backup file, with a clear warning and a confirmation, replacing the local database.
> - A **CSV export of sales** for the year, for the twice-yearly personal income tax filing (ภ.ง.ด.94 / ภ.ง.ด.90). §5 of CLAUDE.md: the POS's job is a defensible annual revenue total, nothing more. **No tax calculation, no accounting integration.**
> - Test: export → wipe the database → import → every sale, batch, movement and waste event is identical.

**CHECK** — export, wipe, import. Everything comes back.

---

### Step 14 — Dry run, then a real market day

> **PROMPT**
>
> Before I take this to the stall:
>
> 1. Write a seed script that generates a realistic week — 5 market days, 25–45 sales each, sensible time distribution, some modifiers, one void, one loyalty redemption, realistic waste at close. Behind the dev-only menu.
> 2. Run it and check every Tier 1 report for anything impossible: negative stock, revenue including loyalty drinks, COGS excluding them, waste double-counted, cash variance that doesn't reconcile.
> 3. Audit the sell path end to end and report **the exact number of taps** for: plain tamarind cash · pear hot cash · 2 tamarind + 1 pear QR · tamarind with salted plum cash. If plain-tamarind-cash is more than 2 taps, fix it.
> 4. Run `npm run typecheck && npm run lint && npm run test` and fix everything.
> 5. List anything in the codebase that violates a non-requirement in §11 of CLAUDE.md, and remove it.

**CHECK** — then use it for **one real market day**, ringing every sale. That day will teach you more than the next five prompts would.

---

## Phase 5 — Only after a month of real use (Steps 15–16)

Do not build these before you have a month of real data. What you learn in that month will change what they should be.

### Step 15 — Tier 2 reports

> **PROMPT**
>
> Now that there is a month of real data, build Tier 2 from §7 of CLAUDE.md:
>
> - Sales by day of week and by hour — which market days are worth keeping
> - **Attach rate for paid modifiers** — the plan assumed roughly 1 in 3
> - **Waste % per component over time**, against the 10% target — the most important report in the app
> - Average basket size, to test whether the 2-cup discount is working
>
> Read the dataviz guidance before building any chart. One screen, phone-readable, no dashboard sprawl.

### Step 16 — Cloud backup (optional)

Only worth doing if a second operator or a second device appears.

> **PROMPT**
>
> Add optional cloud sync to Supabase. Mirror the local schema, push unsynced rows when connectivity allows, **last-write-wins per record**. Per §8 of CLAUDE.md: one device, one operator, real conflicts are near-impossible — **do not build CRDTs**.
>
> Non-negotiable: **the app must work exactly as it does today with the network permanently off.** Sync is a background nicety that never blocks, delays or gates a sale. If that is not achievable cleanly, say so and we skip it.

---

## Things to say to Claude Code when it drifts

| It does this                                 | Say this                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| Adds a confirmation dialog to the sell path  | "That's a tap on the standard sale. §0 of CLAUDE.md. Remove it."                |
| Builds a product-level BOM                   | "BOM is variant-level. Hot pear has no jelly. §2.1."                            |
| Stores `qty_remaining` as a counter          | "Stock movements are the ledger. Compute it. §2.1."                             |
| Blocks a sale on expired stock               | "Warn, never block. Record the override. §2.1."                                 |
| Adds VAT, a tax field, or a receipt prompt   | "Not VAT-registered. No tax engine, never prompt for receipts. §5."             |
| Builds customer accounts for loyalty         | "Loyalty is a paper punch card. No CRM. §4."                                    |
| Waits on or polls for PromptPay confirmation | "Static QR, manual confirmation. The system must never claim to verify. §4."    |
| Hardcodes a price, cost or quantity          | "Nothing compiled in — recipes aren't taste-tested. Settings row. §2.1 item 7." |
| Truncates a drink name with "…"              | "Never truncate. Fix the short name in settings. §9."                           |
| Starts on Tier 2 or Tier 3 reports           | "Tier 1 only for now. §7."                                                      |

---

## The one thing to remember

From §14 of CLAUDE.md:

> **It fails if ringing up a sale takes longer than making the drink.**

You have 35–48 seconds of hands-on work per cup. The POS is meant to be used _between_ pours, not during them. Every time you are tempted to add a field, a confirmation or a screen to the sell path — don't.
