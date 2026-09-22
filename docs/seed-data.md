# Seed data — Rudu Tea POS

Everything here becomes **rows in the database on first run**, loaded from `src/data/seed.ts`. After the first run the database owns these values and settings edits them. **Nothing here may be referenced from business logic at runtime.**

> ⚠️ The recipes have **not been taste-tested**. Every quantity and cost below is a planning estimate and will change.

---

## 1. Products

| id | name_full_th | name_short_th | name_en | base_price | advisory_th |
|---|---|---|---|---:|---|
| `DRINK_TAMARIND` | มะขามแดง | **มะขามแดง** | Red tamarind | 40 | — |
| `DRINK_PEAR` | สาลี่ขาวสมุนไพรจีน | **สาลี่ขาว** | White pear, Chinese herbs | 59 | มีคาเฟอีน · สตรีมีครรภ์แนะนำเลี่ยง |
| `BOTTLE_TAMARIND_1L` | ขวดมะขามแดง 1 ลิตร | **ขวดมะขาม 1L** | Tamarind bottle 1L | 99 | — |

## 2. Variants

| id | product | name_th | temp | price | packaging_set | default |
|---|---|---|---|---:|---|:--:|
| `VAR_TAMARIND_ICED` | Tamarind | มะขามแดง | ICED | 40 | `PKG_ICED_STRAW` | only |
| `VAR_PEAR_ICED` | Pear | สาลี่ขาว (เย็น) | ICED | 59 | `PKG_ICED_STRAW_SPOON` | ✅ |
| `VAR_PEAR_HOT` | Pear | สาลี่ขาว (ร้อน) | HOT | 59 | `PKG_HOT` | |
| `VAR_BOTTLE_TAMARIND` | Bottle | ขวดมะขาม 1L | — | 99 | `PKG_BOTTLE` | only |

Hot and iced pear are the **same price** but a **different BOM and different packaging**. Separately reportable, but **one menu button** — temperature is a variant selection.

## 3. Components

| id | name_th | unit | default_batch | yield | shelf_life | cut_shelf_life | lead_time | lifecycle |
|---|---|:--:|---:|---:|---:|---:|---:|---|
| `COMP_TEA_RED` | ชาแดงสกัดเย็น 2x | ML | 5,000 | 40 | 72 h | — | **10 h steep** | `STEEP` |
| `COMP_TEA_WHITE` | ชาขาวสกัดเย็น 2x | ML | 4,000 | 40 | 72 h | — | **13 h steep** | `STEEP` |
| `COMP_CONC_TAMARIND` | หัวเชื้อมะขาม | ML | 3,000 | 60 | 168 h | — | 0 | `SIMPLE` |
| `COMP_CONC_PEAR` | หัวเชื้อสาลี่พุทราจีน | ML | 3,000 | 60 | 168 h | — | 0 | `SIMPLE` |
| `COMP_JELLY_CHRYS` | เยลลี่เก๊กฮวย | G | 1,000 | 33 | 72 h | **24 h** | 40 min set | `SLAB_CUT` |
| `COMP_JELLY_WHITE_GOJI` | เยลลี่ชาขาวฝังเก๋ากี้ | G | 1,000 | 33 | 72 h | **24 h** | 40 min set | `SLAB_CUT` |
| `COMP_PEAR_FRESH` | กอง B สาลี่สด | G | 420 | 20 | **same day** | — | 0 | `SIMPLE` |
| `COMP_PEACH_GUM` | ยางพีช | G | 350 | 17 | 72 h | — | **11 h soak** | `SOAK_BLANCH` |
| `COMP_BASIL_SEED` | เม็ดแมงลักพอง | G | 250 | 7 | **same day** | — | 0 | `SIMPLE` |

**Not batch-tracked** (`is_batch_tracked: false`, simple stock counts at most): salted plum, dried chrysanthemum garnish, rock sugar, coconut sugar, salt, tea leaves, agar powder.

### 3.1 Two lifecycle facts that must be modelled

- **`COMP_JELLY_WHITE_GOJI` consumes 500 ml of `COMP_TEA_WHITE`.** Recording a goji-jelly batch must deduct 500 ml from a chosen active white-tea batch and set `parent_batch_id`. Real white-tea yield after one jelly batch is **35 cups, not 40**.
- **Cutting a jelly slab shortens shelf life from 72 h to 24 h.** The cut action records grams cut; the uncut remainder keeps the longer clock.

### 3.2 `recipe_note_th` — free text per component, shown on the prep screen

Stored as an editable string, **not parsed, not used for ingredient depletion**:

- `COMP_TEA_RED` — ชาแดง 50 g ในถุงกรอง + น้ำดื่ม 5.25 L · แช่ตู้เย็น ≤4°C 10 ชม. · ยกถุงขึ้น บีบเบา ๆ ครั้งเดียว
- `COMP_TEA_WHITE` — ชาขาวโซ่วเหมย 52 g + น้ำดื่ม 4.3 L · แช่ ≤4°C 12–14 ชม.
- `COMP_CONC_TAMARIND` — มะขามเปียก 720 g · น้ำตาลกรวด 1,350 g · น้ำตาลมะพร้าว 225 g · เกลือ 38 g · แช่มะขามในน้ำร้อน 1.2 L ขยำ **กรอง 3 ครั้ง** ละลายน้ำตาล เติมให้ครบ 3.0 L แช่เย็นเร็ว
- `COMP_CONC_PEAR` — สาลี่ 3.24 kg (ต้มแล้วทิ้ง) · พุทราจีนแห้ง 105 g · เก๋ากี้ 38 g · น้ำตาลกรวด 645 g · เกลือ 8 g · ต้ม 95–97°C 15 นาที ยกตะกร้าทิ้ง เติมให้ครบ 3.0 L
- `COMP_JELLY_CHRYS` — เก๊กฮวยแห้ง 12 g · ผงวุ้น 10 g · น้ำตาลกรวด 60 g · น้ำ 1.1 L · แช่ดอกไม้นอกเตา 5 นาที กรอง พักผงวุ้น 5 นาที **ต้มเดือด 2 นาทีเต็ม** เทถาดหนา 1.5 cm
- `COMP_JELLY_WHITE_GOJI` — **ใช้ชาขาว 500 ml** · น้ำ 500 ml · ผงวุ้น 10 g · น้ำตาลกรวด 70 g · เก๋ากี้แช่ 40 g · ต้มวุ้นในน้ำเปล่าเท่านั้น ลด 60°C ใส่ชาเย็น ลด 50°C ใส่เก๋ากี้ เทถาดทันที
- `COMP_PEACH_GUM` — แช่ 10–12 ชม. ≤4°C → เขี่ยเปลือกไม้ออก → ล้าง → **ลวก 3 นาที** → แช่น้ำแข็ง → เก็บจมน้ำ เปลี่ยนน้ำทุกวัน
- `COMP_PEAR_FRESH` — หั่นเช้าวันขาย ห้ามค้างคืน
- `COMP_BASIL_SEED` — แช่พองเช้าวันขาย

---

## 4. Bill of materials — **variant-level**

| Component | `VAR_TAMARIND_ICED` | `VAR_PEAR_ICED` | `VAR_PEAR_HOT` | `VAR_BOTTLE_TAMARIND` |
|---|---:|---:|---:|---:|
| `COMP_TEA_RED` | **125 ml** | – | – | **417 ml** |
| `COMP_TEA_WHITE` | – | **100 ml** | **100 ml** | – |
| `COMP_CONC_TAMARIND` | **50 ml** | – | – | **167 ml** |
| `COMP_CONC_PEAR` | – | **50 ml** | **50 ml** | – |
| `COMP_JELLY_CHRYS` | **30 g** | – | – | – |
| `COMP_JELLY_WHITE_GOJI` | – | **30 g** | **– none** | – |
| `COMP_PEAR_FRESH` | – | **21 g** | **21 g** | – |
| `COMP_PEACH_GUM` | – | modifier only (20 g) | **20 g always** | – |

> ⚠️ **Hot pear omits the jelly** (agar melts at ~85 °C) **and always includes peach gum instead.**

**Not tracked as components:** dilution water (125 ml iced tamarind / 100 ml pear), ice (180 g), chrysanthemum garnish, salted plum (counted, costed, not weighed).

---

## 5. Modifiers

### 5.1 Paid

| id | name_th | price_delta | applies to | component | qty | rule |
|---|---|---:|---|---|---:|---|
| `MOD_BASIL_SEED` | เม็ดแมงลัก | **+5** | `VAR_TAMARIND_ICED` | `COMP_BASIL_SEED` | 35 g | |
| `MOD_SALTED_PLUM` | บ๊วยเค็ม | **+5** | `VAR_TAMARIND_ICED` | — (cost 1.25) | 1 pc | **advisory: มีเมล็ด ระวังสำลัก** — displayed **and spoken** |
| `MOD_PEACH_GUM` | เพิ่มวุ้นยางท้อ | **+10** | `VAR_PEAR_ICED` | `COMP_PEACH_GUM` | 20 g | **Hidden on `VAR_PEAR_HOT`** (already included) |

Modifiers are additive. Combinations are allowed, not blocked.

### 5.2 Free (preparation instructions, no price change)

Zero revenue impact, but they change how the drink is made and **must be visible to the operator while pouring**.

| id | name_th | effect |
|---|---|---|
| `PREP_LESS_SWEET` | หวานน้อย | Concentrate 50 → **35 ml**, more dilution water. Deduct 35 ml. **Never add plain water to a finished cup.** |
| `PREP_NO_ICE` | ไม่ใส่น้ำแข็ง | Removes the ice packaging cost |
| `PREP_NO_SOLIDS` | ไม่ใส่เนื้อ | Omit jelly / fresh pear. **Still deducts by default** (portioned for this cup); operator may mark waste-free |
| `PREP_TAKEAWAY_BAG` | ใส่ถุง | **cost_delta 0** — the bag is already in every packaging set (see §6.2) |

---

## 6. Costs

### 6.1 Component cost per unit

Derived from cost-per-cup ÷ BOM quantity. **Store per ml / per g, never per cup.**

| component | cost/cup (ref) | **cost_per_unit** |
|---|---:|---:|
| `COMP_TEA_RED` (125 ml) | 0.50 | **0.0040** /ml |
| `COMP_TEA_WHITE` (100 ml) | 0.78 | **0.0078** /ml |
| `COMP_CONC_TAMARIND` (50 ml) | 2.41 | **0.0482** /ml |
| `COMP_CONC_PEAR` (50 ml) | 4.77 | **0.0954** /ml |
| `COMP_JELLY_CHRYS` (30 g) | 0.41 | **0.0136667** /g |
| `COMP_JELLY_WHITE_GOJI` (30 g) | 0.68 | **0.0226667** /g |
| `COMP_PEAR_FRESH` (21 g) | 1.47 | **0.0700** /g |
| `COMP_PEACH_GUM` (20 g) | 0.80 | **0.0400** /g |
| `COMP_BASIL_SEED` (35 g) | 0.75 | **0.0214286** /g |
| Salted plum | 1.25 | **1.25** /pc |
| Chrysanthemum garnish | 0.03 | **0.03** /cup (pear variants only) |

### 6.2 Packaging items and sets

`plastic cup 16 oz` **1.18** · `paper cup (hot)` **1.50** · `lid` **0.59** · `straw normal` 0.14 · **`straw wide` 0.25** · `spoon` **0.35** · `carry bag` **0.20** · `ice` **1.00** · `logo sticker` **0.30** · `PET bottle 1 L` **7.00**

All current drinks use the **wide straw** (jelly cubes).

| packaging_set | items | total |
|---|---|---:|
| `PKG_ICED_STRAW` | plastic cup · lid · wide straw · ice · sticker · bag | **3.52** |
| `PKG_ICED_STRAW_SPOON` | plastic cup · lid · wide straw · spoon · ice · sticker · bag | **3.87** |
| `PKG_HOT` | paper cup · lid · spoon · sticker · bag | **2.94** |
| `PKG_BOTTLE` | PET bottle 1 L | **7.00** |

> **The carry bag is inside every packaging set.** That is why `PREP_TAKEAWAY_BAG` has `cost_delta: 0` — otherwise the bag is counted twice. (The source context document had it in both places; this is the correction.)

### 6.3 Expected margins — use these as the test fixture

`src/domain/__tests__/cost.test.ts` must reproduce this table exactly.

| Variant | Material | Packaging | Total cost | Price | Profit | GP% |
|---|---:|---:|---:|---:|---:|---:|
| Tamarind, iced | 3.32 | 3.52 | **6.84** | 40 | 33.16 | 82.9% |
| Tamarind + basil seed | 4.07 | 3.52 | **7.59** | 45 | 37.41 | 83.1% |
| Tamarind + salted plum | 4.57 | 3.52 | **8.09** | 45 | 36.91 | 82.0% |
| Pear, iced | 7.73 | 3.87 | **11.60** | 59 | 47.40 | 80.3% |
| Pear, iced + peach gum | 8.53 | 3.87 | **12.40** | 69 | 56.60 | 82.0% |
| Pear, hot | 7.85 | 2.94 | **10.79** | 59 | 48.21 | 81.7% |
| Bottle 1 L | 9.72 | 7.00 | **16.72** | 99 | 82.28 | 83.1% |
| **Blended (2 plain drinks)** | | | **9.22** | 49.50 | 40.28 | **81.4%** |

Pear material includes the 0.03 chrysanthemum garnish. Blended GP is **81.4%** (the source document said 81.6%; 40.28 ÷ 49.50 = 81.37%).

---

## 7. Settings rows

| key | value | note |
|---|---|---|
| `opening_float` | 150000 satang (1,500 THB) | |
| `fixed_cost_per_day` | 37000 satang (370 THB) | stall 200 · gas 15 · transport 80 · water 40 · wear 35 |
| `breakeven_cups` | 10 | computed: 370 ÷ 40.28 = 9.2 |
| `quick_tender` | [40, 50, 59, 100, 500, 1000] | plus "exact" |
| `promo_two_cup_enabled` | true | automatic |
| `promo_two_cup_amount` | 1000 satang | per pair |
| `promo_rainy_day_enabled` | **false** | manual toggle only, never date-automated |
| `promo_rainy_day_amount` | 500 satang | `VAR_PEAR_HOT` only |
| `loyalty_stamps_required` | 10 | paper card |
| `vat_registered` | **false** | receipts show no VAT |
| `annual_revenue_warn_threshold` | 180000000 satang (1.8M THB) | |
| `branding_line_th` | ชาต้มเอง วันต่อวัน | editable; becomes `ชา 3 แก้ว เปลี่ยนตามฤดู` at the third drink |
| `promptpay_qr_image` | — | static image the operator uploads once |
| `operators` | ["เจ้าของ"] | selected at open-day, no login per sale |
| `prep_reminder_red_tea` | 21:00 | 10 h steep → ready 07:00 |
| `prep_reminder_white_tea` | 19:00 | 12–14 h steep |

---

## 8. Reference volume figures (for sanity checks, not for code)

- 25–45 cups/day in month one · **10 cups/day is breakeven**
- Max throughput ~45–50 cups/hour, one operator
- 4–5 days/week, roughly 09:00–17:00
- A sale takes **35–48 seconds** of hands-on work; the POS must be usable **between pours, not during them**
- Startup capital ≈ 21,500 THB (equipment 15,108) — Tier 3 payback report only
