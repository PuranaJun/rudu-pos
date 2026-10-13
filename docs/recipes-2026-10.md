# Ruedu Cha (ฤดูชา) — Ingredient & Recipe Update Spec

**Source:** the shop's master file "ฤดูชา · เมนูจริง (ฉบับรวมทุกสูตร)", updated 12 Oct 2026.
**Purpose:** replace every recipe, sub-recipe and ingredient quantity currently in the app with the current recipes below. This file is the single source of truth.

---

## 0. Instructions for Claude Code

### Before changing anything
1. Explore the app and find where these live: raw ingredients (with prices/units), prep batches / sub-recipes, menu items, per-cup recipes, modifiers (sweetness levels, add-ons), packaging, prices and cost calculations. They may be in a database, seed files, JSON/YAML, or code constants.
2. Make sure the current state can be restored (git commit, DB export or backup) before editing.
3. Match existing records **by Thai name** (every item below has its Thai name) so you don't create duplicates. When a match exists, **update it in place** so IDs and any sales history stay linked.

### How to replace
- Update matched records so quantities, yields, units, shelf life and notes match this spec exactly.
- Create any record that is missing.
- Records in the app that are **not** in this spec (old recipes, old menu items, unused ingredients): **do not hard-delete.** Deactivate/archive them if the data model supports it; otherwise list them and ask the user before deleting. Known obsolete items are in §8.
- If the app models sweetness or Yakult as modifiers, use §4 and §5. If it doesn't, store them in whatever structure the app already uses and say what you did.

### Data rules
- **Do not invent numbers.** Where this spec says "not set", "not calculated" or "keep existing", leave the field null / unchanged and include it in your report.
- **Prices:** §1 gives prices for some ingredients. Ones marked *assumed* are estimates not yet checked — if the app has a "price status" or note field, mark them. For ingredients with no price here, keep the app's existing price; if there is none, leave it null and report it.
- **Count units** (fruit, leaf, stalk, bottle) stay as count units. Where the app needs grams and no conversion is given here, do not guess — report it.
- If the app has a status/notes field for recipes, store the tasting status shown for each item (many recipes are not yet taste-tested).

### When you finish, report
- What was updated, created and archived.
- Every field left null or flagged.
- Cost check for menus 10–15 against the reference table in §7, with any differences explained.

---

## 1. Raw ingredients

Price column: "cost file" = from the shop's cost analysis file; *assumed* = estimate, not yet checked; "keep existing" = no price in this spec.

### Teas and dried flowers
| English | Thai | Price (THB) | Status | Used in |
|---|---|---|---|---|
| Black tea leaves | ใบชาแดง | 400/kg | cost file | P1, pitcher 10 |
| White tea leaves | ใบชาขาว | 1,200/kg | cost file | P2, pitcher 12 |
| Jasmine green tea leaves (loose leaf, not powder or premix) | ใบชาเขียวมะลิ | 500/kg | cost file | P3, pitcher 11 |
| Oolong tea leaves, rolled (e.g. Oolong No.12) — **new** | ใบชาอูหลง | 1,000/kg | *assumed* | pitcher 13 only |
| Butterfly pea flowers, dried | ดอกอัญชันแห้ง | 400/kg | cost file | P4, pitcher 15 |
| Chrysanthemum flowers, dried | ดอกเก๊กฮวยแห้ง | keep existing | — | P5, M1 garnish |
| Roselle (red hibiscus) calyces, dried, food grade — **new** | กระเจี๊ยบแห้ง | 300/kg | *assumed* | pitcher 14 only |
| Osmanthus flowers, dried | ดอกกุ้ยฮวาแห้ง | keep existing | — | M2 garnish |
| Rose buds, dried, for brewing | ดอกกุหลาบแห้ง | keep existing | — | P9, M5 garnish |

### Sweeteners, seasoning, other dry goods
| English | Thai | Price | Used in |
|---|---|---|---|
| Rock sugar | น้ำตาลกรวด | keep existing | P6, P11, P15 |
| Brown sugar | น้ำตาลทรายแดง | keep existing | P13 |
| Cane sugar block | น้ำตาลอ้อยก้อน | keep existing | P13 |
| Honey | น้ำผึ้ง | keep existing | P7, P8 |
| Sea salt | เกลือทะเล | keep existing | P7–P10, P13, P14 |
| Agar powder | ผงวุ้น | keep existing | P11, P15 |
| Drinking water | น้ำดื่ม | keep existing | all teas/bases |

### Fresh, dried and frozen fruit / produce
| English | Thai | Price (THB) | Status | Used in |
|---|---|---|---|---|
| Asian pear (white) | สาลี่ | keep existing | — | P10, P12, P15 |
| Dried jujube (Chinese red date) | พุทราจีนแห้ง | keep existing | — | P10, P15 |
| Goji berries, dried | เก๋ากี้ | keep existing | — | P10, P11, P15, M7 |
| Dried longan | ลำไยอบแห้ง | keep existing | — | P13 |
| Shredded ginger (plain fresh ginger, no vinegar or brine) | ขิงฝอย | keep existing | — | P13 |
| Fresh mature ginger — **new** | ขิงแก่สด | 60/kg | *assumed* | pitcher 11 |
| Passion fruit | เสาวรส | keep existing | — | P8, M3 garnish |
| Calamansi | ส้มจี๊ด | 60/kg | cost file | P7, M6, pitcher 11, M11 garnish |
| Lime juice | น้ำมะนาว | keep existing | — | P9, P14 |
| Seedless red or black grapes | องุ่นแดง/ดำไร้เมล็ด | keep existing | — | P14, M4 garnish |
| Canned lychee in syrup, 565 g can (~15 lychees/can) | ลิ้นจี่ในน้ำเชื่อม | keep existing | — | P9 |
| Sai Nam Phueng orange — **new** | ส้มสายน้ำผึ้ง | 70/kg (~200 g/fruit) | *assumed* | pitchers 10, 14; M10 garnish |
| Lemon — **new** | เลมอน | 15/fruit | *assumed* | pitchers 10, 12, 13, 15 |
| Pineapple, whole (~55% flesh yield) — **new** | สับปะรด | 25/kg whole | *assumed* | pitcher 11 |
| Lemongrass (~20 g/stalk) — **new** | ตะไคร้ | 40/kg | *assumed* | pitcher 13 |
| Mint — **new** (recipes use leaf counts; g/leaf not defined) | มิ้นต์ | 200/kg | *assumed* | pitchers 10, 12, 14, 15; M14 garnish |
| Peach — **new** (type undecided, see §9) | พีช | ~130/kg drained flesh (canned basis) | *assumed* | pitcher 13, M13 garnish |
| Frozen raspberry — **new** | ราสเบอร์รีแช่แข็ง | 350/kg | *assumed* | pitcher 12, M12 garnish |
| Frozen strawberry — **new** | สตรอว์เบอร์รีแช่แข็ง | 150/kg | *assumed* | pitcher 14 |
| Frozen blueberry — **new** | บลูเบอร์รีแช่แข็ง | 300/kg | *assumed* | pitcher 15, M15 garnish |
| Yakult, 80 ml bottle | ยาคูลท์ | keep existing | — | §5 add-on |

### Ice and packaging
| Item | Thai | Qty / cost | Notes |
|---|---|---|---|
| Ice | น้ำแข็ง | 180 g per cup · 0.54 THB/cup | all drinks |
| Packaging set, regular straw, no spoon (cup, lid, regular straw, bag) | แก้ว ฝา หลอดปกติ ถุง | 3.45 THB/cup | menus 6, 7, 8, 10–15 |
| Large straw | หลอดใหญ่ | keep existing | menus 1–5 |
| Spoon | ช้อน | keep existing | menus 1–5, 9 |
| 8 oz cup + flat lid | ถ้วย 8 oz ฝาเรียบ | keep existing | menu 9 |
| Delivery packaging (app orders) | แพ็กเดลิเวอรี | +1 THB/cup | app orders only |

---

## 2. Prep recipes (sub-recipes)

All cold-brewed teas: drinking water only, steep inside the fridge (≤4°C), lift the tea bag out on time.

### P1 · Black tea, cold brew — ชาแดงสกัดเย็น
- **Full batch:** black tea leaves 50 g + cold drinking water 9.3 L → **9 L**
- **Half batch:** 25 g + 4.65 L → 4.5 L
- Steep 10 h in fridge · **Shelf life 3 days** · ~2.5 batches per 3-day cycle
- Used in: M1 (~200 ml), M6 (~265 ml), M8 black (~290 ml), P11 (600 ml/batch)
- Status: strength must be taste-checked once (replaces hot-brewed black tea used at tasting)

### P2 · White tea, cold brew — ชาขาวสกัดเย็น
- White tea leaves 52 g + cold drinking water 8.25 L → **8 L**
- Steep 12–14 h · **Shelf life 3 days** · 3 batches per 3-day cycle
- Used in: M2, M4, M8 white

### P3 · Jasmine tea, cold brew — ชามะลิสกัดเย็น
- **Full batch:** jasmine green tea leaves 65 g + cold drinking water 8.3 L → **8 L**
- **Half batch:** 33 g + 4.15 L → 4 L
- Steep 8 h (green tea — never over-steep) · **Shelf life 2 days** · 1 batch every 2 days
- Used in: M5, M8 jasmine · Status: not tasted

### P4 · Butterfly pea, cold brew — อัญชันสกัดเย็น
- **Full batch:** dried butterfly pea flowers 40 g (rinsed) + cold drinking water 8.3 L → **8 L**
- **Half batch:** 20 g + 4.15 L → 4 L
- Steep 8 h · **Shelf life 3 days** · 1 batch per 3-day cycle
- Used in: M3 · Never let it touch acid (separate pitcher and ladle)

### P5 · Chrysanthemum tea — น้ำเก๊กฮวย
- Dried chrysanthemum flowers 120 g (rinsed) + boiling drinking water 3.5 L, steep 10 min off heat, strain, then top up with ice-cold drinking water **to 9 L** → **9 L (~30 cups)**
- **Shelf life 3 days** · 1 batch per 3-day cycle · Status: not tasted
- Used in: M7

### P6 · Central simple syrup — น้ำเชื่อมกลาง
- Rock sugar 1 kg + water 1.38 L → **~2 L = 200 pumps**
- **1 pump = 10 ml = 5 g sugar**
- **Shelf life 14 days** (fridge) · make when low
- Used for sweetness in every menu except M2 and M9

### P7 · Calamansi honey base — ฐานส้มจี๊ดน้ำผึ้ง (no sugar)
- Calamansi juice 450 ml (~1.2–1.4 kg fruit) + honey 200 g + sea salt 2 g → **~0.6 L (30 cups)**
- Not cooked · **Shelf life 4 days** · 1 batch per 3-day cycle
- Used in: M6 (20 ml/cup)

### P8 · Passion fruit honey base — ฐานเสาวรสน้ำผึ้ง (no sugar)
- Passion fruit pulp with seeds 600 g (~18–20 fruits) + honey 100 g + sea salt 2 g + water 300 ml → **~0.95 L (30 cups)**
- **Shelf life 4 days** · 1 batch per 3-day cycle · Stored in a wide-mouth jar, dosed with a 30 ml ladle
- Used in: M3 (30 ml/cup)
- Status: ratio tasted ✓; sugar removal needs a taste check

### P9 · Lychee rose base — ฐานลิ้นจี่กุหลาบ (no added sugar)
- Canned lychee in syrup 2 cans (565 g each) + dried rose buds 6 g + lime juice 20 ml + sea salt 1 g → **~30 lychees + ~680 ml base (~15 cups)**
- **Shelf life 3 days** (lychee flesh included) · 2 batches per 3-day cycle
- Used in: M5 (2 lychees + 40 ml/cup) · Status: not tasted

### P10 · Asian pear concentrate — หัวเชื้อสาลี่ (no sugar)
| Batch | Asian pear | Dried jujube | Goji | Sea salt | Water | Final volume |
|---|---:|---:|---:|---:|---:|---:|
| **4 L (default: 60 cups + jelly cups)** | 4.32 kg | 140 g | 51 g | 11 g | 3.3 L | **4.0 L** |
| 3 L (when not selling jelly cups) | 3.24 kg | 105 g | 38 g | 8 g | 2.5 L | 3.0 L |
- Pear and jujube are simmered then discarded; goji stays in.
- **Shelf life 5 days** · every ~4–5 days
- Used in: M1 (50 ml/cup), P15 (400 ml/batch)
- Status: ratio tasted ✓ · pear weight before/after peeling is undefined (see §9)

### P11 · Black tea jelly with goji — เยลลี่ชาแดงฝังเก๋ากี้
- Black tea cold brew (P1) 600 ml + water 400 ml + agar powder 10 g + rock sugar 70 g + goji 40 g → **1 L (33 cups at 30 g)**
- **Shelf life 3 days** (whole slab); cut into 1 cm cubes on the day, leftovers discarded
- Used in: M1 (30 g/cup)

### P12 · Fresh diced pear ("Pile B") — กอง B
- Fresh Asian pear, diced, ~420 g/day, kept submerged in chilled pear liquid
- **Same day only, discard leftovers**
- Used in: M1 (21 g/cup); also diced alongside P15

### P13 · Longan ginger concentrate — หัวเชื้อลำไยขิง
- Dried longan 360 g + shredded ginger 144 g + brown sugar 630 g + cane sugar block 120 g + sea salt 4 g + water 1.1 L → **1.4 L (30 cups)**
- Split: **1.2 L into the 10 ml pump bottle** + **0.2 L poured over the cooked longan flesh** (kept)
- **Shelf life:** concentrate 7 days · longan flesh in syrup 5 days · 1 batch per 3-day cycle
- **Do not reduce the sugar** (it preserves the concentrate and makes the bottom layer heavy enough to layer)
- Used in: M2 · Status: ratio tasted ✓

### P14 · Hand-mashed grape — องุ่นบดมือ (no sugar)
- Seedless red/black grapes 1.2 kg + lime juice 20 ml + sea salt 1 g → **~1.2 kg (30 cups at 40 g)**
- **Shelf life 2 days** · made in half batches, every other day
- Used in: M4 (40 g/cup) · Status: not tasted

### P15 · Pear, jujube & goji jelly cups — เยลลี่สาลี่พุทราเก๋ากี้
- Pear concentrate (P10) 400 ml + water 800 ml + agar powder 10 g + rock sugar 120 g + dried jujube (shredded) 30 g + fresh diced Asian pear 300 g + goji 25 g → **~1.6 kg = 10 cups × 160 g**
- **Shelf life 2 days** · every other day
- Sold as M9 · Status: not tasted

### P16 · Fruit-infused tea pitchers (menus 10–15) — เหยือกชาแช่ผลไม้
**1 batch = cold drinking water 3.1 L → ~3 L strained tea (~10 cups)**. Half batch = halve everything.
No sugar or honey in the pitcher. All citrus peeled with white pith removed. Solids strained out and discarded.

| Pitcher | Tea (in bag) | Fruit | Citrus | Herb | Steep (fridge) |
|---|---|---|---|---|---|
| 10 Orange mint black tea | black tea 24 g | Sai Nam Phueng orange 3 fruits (~600 g) | lemon 1 | mint 12 leaves | 12 h |
| 11 Pineapple ginger jasmine | jasmine green tea 25 g | pineapple flesh 700 g (≈1.27 kg whole) | calamansi 6 fruits, juice only | fresh ginger 50 g, grated | **6 h max** |
| 12 Raspberry lemon white tea | white tea 20 g | frozen raspberry 200 g | lemon 1 | mint 15 leaves | 12 h |
| 13 Peach oolong | oolong 24 g (2 bags) | peach 600 g | lemon 1 | lemongrass 3 stalks (~60 g) | 12 h |
| 14 Strawberry orange roselle | dried roselle 22 g | frozen strawberry 400 g | Sai Nam Phueng orange 1½ fruits (~300 g) | mint 25 leaves | 12 h |
| 15 Blueberry butterfly pea | dried butterfly pea 15 g | frozen blueberry 300 g | lemon 1 | mint 15 leaves | 12 h |

- **Shelf life after straining: 2 days** (≤4°C), counted from straining time · never leave solids in more than 24 h
- 2 batches per menu per 3-day cycle (start at half batches — see §9)
- Status: **none tasted** (converted from Oh, How Civilized recipes)

### Daily garnishes (made same morning, leftovers discarded)
| Garnish | Thai | Per cup | Menu |
|---|---|---|---|
| Passion fruit, halved crosswise | เสาวรสผ่าครึ่ง | ½ fruit (¼ fruit out of season, Dec–Jun) | M3 |
| Calamansi, halved | ส้มจี๊ดผ่าครึ่ง | 1 fruit (2 halves) in M6 · ½ fruit in M11 | M6, M11 |
| Grape, halved lengthwise | องุ่นผ่าครึ่ง | 1 grape (2 halves) | M4 |
| Goji, soaked | เก๋ากี้แช่ | 4 g dry weight | M7 |
| Sai Nam Phueng orange half-slice (peel on) | ส้มครึ่งแว่น | 1 piece | M10 |
| Peach, thin slice | พีชฝาน | 1 slice | M13 |
| Frozen raspberry (from freezer at assembly) | ราสเบอร์รี | 2 berries | M12 |
| Frozen blueberry (from freezer at assembly) | บลูเบอร์รี | 3 berries | M15 |
| Mint sprig | ยอดมิ้นต์ | 1 sprig | M14 |
| Dried chrysanthemum flowers, sprinkled | ดอกเก๊กฮวย | qty not set | M1 |
| Dried osmanthus | ดอกกุ้ยฮวา | 0.2 g | M2 |
| Dried rose buds | ดอกกุหลาบแห้ง | 3 buds (~0.5 g) | M5 |
| Longan flesh in syrup | ลำไยแช่หัวเชื้อ | 2 pieces (~4 g) | M2 |

---

## 3. Menu items (15) — per-cup recipes

Sweetness quantities are written **Normal / Less / Much less / None** (see §4). "—" = level not offered.
"to line" = fill to the marked line on the cup.

### M1 · Asian Pear Chinese Herbal Black Tea — สาลี่ขาวสมุนไพรจีน
Signature · black tea · stirred · **Store 59 / App 79** · Yakult: no · Status: ratio tasted ✓
1. Central syrup: 2 / 1 / 1 / 0 pumps
2. Black tea jelly (P11): 30 g
3. Fresh diced pear (P12): 21 g
4. Pear concentrate (P10): 50 ml
5. Ice: 180 g
6. Black tea (P1): ~200 ml, to line
7. Stir 3 times · garnish dried chrysanthemum flowers (qty not set)
8. Packaging: lid, spoon, large straw

### M2 · Longan Ginger Osmanthus — ลำไยขิงกุ้ยฮวา
Signature · white tea · layered (not stirred) · **Store 55 / App 75** · Yakult: no · Status: ratio tasted ✓
1. Longan flesh (P13): 18 g
2. Longan ginger concentrate (P13): 4 / 3 / 2 / — pumps (40 / 30 / 20 ml) — **no central syrup**
3. White tea (P2), bottom pour: 60 / 70 / 80 ml
4. Ice: 180 g
5. White tea (P2), top pour: ~200 ml, to line
6. Garnish: longan flesh 2 pieces (~4 g) + osmanthus 0.2 g
7. Packaging: lid, spoon, large straw

### M3 · Passion Fruit Honey Butterfly Pea — เสาวรสน้ำผึ้งอัญชัน
Signature · **caffeine-free** · butterfly pea · layered · **Store 55 / App 75** · Yakult: yes · Status: base tasted ✓; butterfly pea version needs check
1. Central syrup: 3 / 2 / 1 / — pumps
2. Passion fruit base (P8): 30 ml
3. Ice: 180 g
4. Butterfly pea (P4): ~260 ml, to line
5. Garnish: passion fruit ½ fruit
6. Packaging: lid, spoon, large straw

### M4 · Grape White Tea — องุ่นชาขาว
Signature · white tea · layered with mash · **Store 59 / App 79** · Yakult: yes · Status: not tasted
1. Central syrup: 3 / 2 / 1 / 0 pumps
2. Hand-mashed grape (P14): 40 g
3. Ice: 180 g
4. White tea (P2): ~250 ml, to line
5. Garnish: 1 grape, halved
6. Packaging: lid, spoon, large straw

### M5 · Lychee Rose Jasmine Tea — ลิ้นจี่กุหลาบชามะลิ
Signature · jasmine tea · stirred · **Store 55 / App 75** · Yakult: yes · Status: not tasted
1. Central syrup: 2 / 1 / 0 / — pumps
2. Lychee rose base (P9): 2 lychees (torn in half) + 40 ml base
3. Ice: 180 g
4. Jasmine tea (P3): ~245 ml, to line
5. Stir 3 times · garnish 3 dried rose buds (~0.5 g)
6. Packaging: lid, spoon, large straw

### M6 · Calamansi Honey Black Tea — ส้มจี๊ดน้ำผึ้ง
Easy-drinking · black tea · stirred · **Store 45 / App 59** · Yakult: yes (top pairing) · Status: not tasted
1. Central syrup: 3 / 2 / 1 / 0 pumps
2. Calamansi base (P7): 20 ml
3. Calamansi, halved: 1 fruit
4. Ice: 180 g
5. Black tea (P1): ~265 ml, to line
6. Stir 3 times · Packaging: regular-straw set

### M7 · Chrysanthemum Goji — เก๊กฮวยเก๋ากี้
Easy-drinking · **caffeine-free** · stirred · **Store 39 / App: not calculated** · Yakult: no · Status: not tasted
1. Central syrup: 3 / 2 / 1 / 0 pumps
2. Ice: 180 g
3. Chrysanthemum tea (P5): ~290 ml, to line
4. Stir 3 times · garnish soaked goji 4 g (dry weight)
5. Packaging: regular-straw set

### M8 · Plain Cold Brew Tea — ชาสกัดเย็นล้วน (customer picks the tea)
Easy-drinking · stirred · no garnish · Status: not tasted
| Variant | Thai | Store | App | Yakult |
|---|---|---:|---|---|
| Black | ชาแดง | 35 | not calculated | no |
| Jasmine | ชามะลิ | 39 | 55 | yes |
| White | ชาขาว | 45 | not calculated | no |
1. Central syrup: 3 / 2 / 1 / 0 pumps
2. Ice: 180 g
3. Chosen tea (P1 / P3 / P2): ~290 ml, to line
4. Stir 3 times · Packaging: regular-straw set

### M9 · Pear Jujube Goji Jelly Cup — เยลลี่สาลี่พุทราเก๋ากี้
Dessert · **caffeine-free** · **Store 39 / App: not calculated** · no sweetness levels (fixed, ~12 g sugar/cup) · Yakult: no · Status: not tasted
- 1 cup = 160 g of P15 · Packaging: 8 oz cup, flat lid, spoon

### M10–M15 · Fruit-Infused Cold Brew Teas — ชาแช่ผลไม้ (all stirred)
Same assembly for all six; only the pitcher and garnish change. **No fruit or base in the cup. Regular straw, no spoon.**
1. Central syrup: 3 / 2 / 1 / 0 pumps (M14: 3 / 2 / 1 / —)
2. Ice: 180 g
3. Infused tea from that menu's pitcher (P16): ~290 ml, to line
4. Stir 3 times · garnish (below)
5. Packaging: regular-straw set

| # | English | Thai | Tea | Store | App | Garnish | Caffeine-free |
|---|---|---|---|---:|---:|---|---|
| M10 | Orange Mint Black Tea | ชาส้มมิ้นต์ | black | 49 | 69 | orange half-slice | no |
| M11 | Pineapple Ginger Jasmine | สับปะรดขิงชามะลิ | jasmine | 49 | 69 | calamansi ½ fruit | no |
| M12 | Raspberry Lemon White Tea | ราสเบอร์รีเลมอนชาขาว | white | 59 | 79 | 2 frozen raspberries | no |
| M13 | Peach Oolong | พีชอูหลง | oolong | 55 | 75 | 1 peach slice | no |
| M14 | Strawberry Orange Roselle | สตรอว์เบอร์รีส้มกระเจี๊ยบ | roselle | 49 | 69 | 1 mint sprig | **yes** |
| M15 | Blueberry Butterfly Pea | บลูเบอร์รีอัญชัน | butterfly pea | 55 | 75 | 3 frozen blueberries | **yes** |

- Yakult: **not offered** on M10–M15 yet.
- **M14 warning label:** "Pregnant or breastfeeding customers should consult a doctor before drinking roselle."

---

## 4. Sweetness modifier

4 levels: **Normal (ป) · Less (น) · Much less (นม) · No added sugar (0)**. Use "no added sugar", not "0%" — fruit, honey and Yakult still contain sugar.

| Menu | Pumps of | Normal | Less | Much less | None |
|---|---|:-:|:-:|:-:|:-:|
| M1 Pear | central syrup | 2 | 1 | 1 | 0 |
| M2 Longan | **longan concentrate** | 4 | 3 | 2 | — |
| M3 Passion fruit | central syrup | 3 | 2 | 1 | — |
| M4 Grape | central syrup | 3 | 2 | 1 | 0 |
| M5 Lychee | central syrup | 2 | 1 | 0 | — |
| M6 Calamansi | central syrup | 3 | 2 | 1 | 0 |
| M7 Chrysanthemum | central syrup | 3 | 2 | 1 | 0 |
| M8 Plain teas | central syrup | 3 | 2 | 1 | 0 |
| M9 Jelly | — | fixed | | | |
| M10–M13, M15 | central syrup | 3 | 2 | 1 | 0 |
| M14 | central syrup | 3 | 2 | 1 | — |

M2 also changes the bottom white tea pour: 60 / 70 / 80 ml.

**Approx. sugar per cup (g):**
| Menu | Normal | Less | Much less | None |
|---|---:|---:|---:|---:|
| M1 | 12 | 7 | 7 | 2 |
| M2 | 21 | 16 | 11 | — |
| M3 | 20 | 15 | 10 | — |
| M4 | 21 | 16 | 11 | 6 |
| M5 | 17 + fruit | 12 + fruit | 7 + fruit | — |
| M6 | 20 | 15 | 10 | 5 |
| M7, M8 | 15 | 10 | 5 | 0 |
| M9 | ~12 per cup (fixed) | | | |
| M10–M15 | 15 + fruit | 10 + fruit | 5 + fruit | 0 + fruit (M14: —) |
| Any + Yakult | ~19–21 | ~14–21 | ~14–21 | ~14–21 |

---

## 5. Yakult add-on — ตัวเลือก +ยาคูลท์

- **Price: +15 THB store / +20 THB app** · 1 bottle (80 ml) per cup · ~14 g sugar per bottle (≈3 pumps)
- Added after the base, **before ice**. Lid code **+Y**.

| Allowed on | Syrup adjustment |
|---|---|
| M6 Calamansi ⭐ | minus 3 pumps (min 0) |
| M3 Passion fruit ⭐ | minus 3 pumps (min 0) |
| M8 Jasmine only ⭐ | Normal 1 · Less 0 (Much less / None also 0) |
| M4 Grape | minus 3 pumps (min 0) |
| M5 Lychee | minus 3 pumps (min 0) |

⭐ = recommended pairing (show the pair name on the menu, e.g. "Calamansi + Yakult").
**Not allowed:** M1, M2, M7, M8 black, M8 white, M9, M10–M15.
Status: not tasted.

---

## 6. Shelf life summary

| Item | Shelf life |
|---|---|
| Black, white, butterfly pea cold brew | 3 days (≤4°C) |
| Jasmine cold brew | 2 days |
| Chrysanthemum tea | 3 days |
| Central syrup | 14 days (fridge) |
| Longan ginger concentrate | 7 days |
| Longan flesh in concentrate | 5 days |
| Pear concentrate | 5 days |
| Passion fruit base · Calamansi base | 4 days |
| Lychee rose base (incl. lychee flesh) | 3 days |
| Black tea jelly (whole slab) | 3 days |
| Hand-mashed grape | 2 days |
| Jelly cups | 2 days |
| Fruit-infused pitchers, after straining | 2 days |
| Picked mint leaves | 3–4 days (fridge) |
| Frozen berries | per label; never refreeze thawed |
| Yakult | per bottle date |
| Dried flowers, roselle, tea leaves | sealed jar, room temp, away from light |
| Cut jelly cubes, Pile B, all daily garnishes | same day, discard leftovers |

---

## 7. Pricing & cost reference

**App price rule (from cost file):** platform fee 32.1% + delivery packaging +1 THB/cup.
App profit per cup = app price × 0.679 − app cost (app cost = store cost + 1).
Menu 1–8 app prices come from the cost file. **Do not compute** app prices marked "not calculated" — leave them null.

**Cost check for M10–M15** (use to validate the app's calculation):
Store cost/cup = (pitcher batch cost × 1.05 waste) ÷ 10 cups + syrup 3 pumps 0.78 + ice 0.54 + garnish (+20% waste) + packaging 3.45

| Menu | Store cost | Store price | Store profit | Margin | App cost | App price | App profit |
|---|---:|---:|---:|---:|---:|---:|---:|
| M10 | 13.9 | 49 | 35.1 | 72% | 14.9 | 69 | 32.0 |
| M11 | 11.2 | 49 | 37.8 | 77% | 12.2 | 69 | 34.7 |
| M12 | 20.0 | 59 | 39.0 | 66% | 21.0 | 79 | 32.6 |
| M13 | 19.2 | 55 | 35.8 | 65% | 20.2 | 75 | 30.7 |
| M14 | 14.7 | 49 | 34.3 | 70% | 15.7 | 69 | 31.1 |
| M15 | 18.5 | 55 | 36.5 | 66% | 19.5 | 75 | 31.4 |

If the app's numbers differ, report the difference and its cause (e.g. mint g/leaf, garnish weights) — do not force-match.

---

## 8. What changed vs. the old recipes (remove old values)

- **Pear concentrate:** sugar removed (the old 3 L batch had 645 g rock sugar). Shelf life 7 → **5 days**. New default batch is 4 L.
- **Passion fruit base:** sugar removed (old batch had 500 g rock sugar, boiled in). Shelf life now **4 days**. Drink now uses **butterfly pea**, not black tea.
- **Black tea:** now **cold brew 50 g / 9 L** (old recipe was hot-brewed at ~3.6 g/L).
- **Sweetness:** now comes from **central syrup pumps** (§4) for every drink except M2 (longan concentrate pumps) and M9 (fixed). Remove any sugar that old recipes put inside fruit bases.
- **No plain water is added at assembly** — all teas are brewed ready-to-drink. Remove any "add water" step from old cup recipes.
- **New menus M10–M15** and new ingredients (oolong, roselle, lemon, Sai Nam Phueng orange, pineapple, fresh ginger, lemongrass, mint, peach, frozen raspberry/strawberry/blueberry).
- **Superseded / not on sale** (archive or keep inactive; no current recipes exist for them): the old "12 main menu" set; seasonal ideas — strawberry jasmine, mango jasmine (replacing mango black tea), watermelon jasmine, pomelo jasmine, Sai Nam Phueng orange jasmine, star fruit jasmine; backup idea — coconut jasmine.

---

## 9. Open items — store as notes, do not resolve

1. Black tea jelly: 1 L = 33 cups but M1 plans 40 cups/cycle (option: ~1.2 batches).
2. Grape mash: half batch every other day gives 15 cups per 2 days vs. ~20 planned.
3. Pile B: 420 g/day covers 20 cups but M1 sells ~13/day (option: ~280 g/day).
4. Sugar after moving to central syrup: pear 10.75 → 10 g, passion fruit 16.7 → 15 g (to taste-check).
5. Pear 3.24 kg / 4.32 kg — not specified whether weighed before or after peeling.
6. "5% syrup" for soaking the whole black tea jelly slab has no recipe yet (suggestion: central syrup 1 part + boiled water 8 parts).
7. Peach type for M13 undecided (fresh imported / frozen / canned, drained and rinsed).
8. Honey syrup as an alternative sweetener for M10–M15 — not adopted yet.
9. Planned sales for M10–M15 (20 cups each per 3 days) are assumptions; start at half batches.
10. New equipment for M10–M15: 12 × 4 L pitchers, fine strainer, extra filter bags, freezer space.
11. If Yakult costs more than 10 THB/bottle, the add-on becomes +20 THB store and the app price must be recalculated.

### Planning assumptions (cups per 3-day cycle, if the app does production planning)
M1 40 · M2 30 · M3 30 · M4 30 · M5 30 · M6 30 · M7 30 · M8 black 20 · M8 jasmine 20 · M8 white 20 · M9 10 cups per 2 days · +Yakult ~20 · M10–M15 20 each.
