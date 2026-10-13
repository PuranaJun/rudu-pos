/**
 * Seed data — transcribed from docs/recipes-2026-10.md, the shop's master
 * file "ฤดูชา · เมนูจริง (ฉบับรวมทุกสูตร)" of 12 Oct 2026.
 *
 * Read exactly once, on first launch, and once more by the version-10 upgrade
 * that brings a phone seeded with the old menu onto this one (src/db/seed.ts).
 * After that the database owns these values and settings edits them; nothing
 * here may be referenced from business logic at runtime (CLAUDE.md §13).
 *
 * Most recipes have not been taste-tested. Every quantity and cost below is a
 * planning figure and is expected to change — in the database, not here.
 * Where the master file gives no number, the field is null and the recipe
 * note says so; nothing is guessed (docs/recipes-2026-10.md §0).
 *
 * Catalog rows keep stable ids (`VAR_PEAR_ICED`) rather than random UUIDs, so
 * the upgrade can find them again and the rules can name them. Rows created
 * at runtime use crypto.randomUUID().
 */
import { toSatang } from '../lib/money.ts';
import type {
  Bom,
  Component,
  ComponentRole,
  Lifecycle,
  Modifier,
  PackagingItem,
  PackagingSet,
  Product,
  PurchaseItem,
  Setting,
  Unit,
  Variant,
} from '../db/types.ts';

/** Bump to force a reseed of a database that was seeded by an older build. */
export const SEED_VERSION = 10;
export const SEED_VERSION_KEY = 'seed_version';

const unsynced = { synced_at: null } as const;

/** THB per gram, from a price per kilo. */
const perGram = (bahtPerKg: number) => bahtPerKg / 1000;

// ---------------------------------------------------------------- products
// `name_short_th` is what every button, cart line and report shows. It must
// fit a phone button without an ellipsis (CLAUDE.md §9) — edit it in
// settings if one does not.

interface ProductInput {
  id: string;
  full: string;
  short: string;
  en: string;
  price: number;
  advisory?: string;
  kind?: Product['kind'];
}

const CAFFEINE_FREE = 'ไม่มีคาเฟอีน';

const PRODUCT_LIST: ProductInput[] = [
  {
    id: 'DRINK_PEAR',
    full: 'สาลี่ขาวสมุนไพรจีน',
    short: 'สาลี่ขาว',
    en: 'Asian Pear Chinese Herbal Black Tea',
    price: 59,
    advisory: 'มีคาเฟอีน · สตรีมีครรภ์แนะนำเลี่ยง',
  },
  {
    id: 'DRINK_LONGAN',
    full: 'ลำไยขิงกุ้ยฮวา',
    short: 'ลำไยขิง',
    en: 'Longan Ginger Osmanthus',
    price: 55,
  },
  {
    id: 'DRINK_PASSION',
    full: 'เสาวรสน้ำผึ้งอัญชัน',
    short: 'เสาวรส',
    en: 'Passion Fruit Honey Butterfly Pea',
    price: 55,
    advisory: CAFFEINE_FREE,
  },
  { id: 'DRINK_GRAPE', full: 'องุ่นชาขาว', short: 'องุ่น', en: 'Grape White Tea', price: 59 },
  {
    id: 'DRINK_LYCHEE',
    full: 'ลิ้นจี่กุหลาบชามะลิ',
    short: 'ลิ้นจี่',
    en: 'Lychee Rose Jasmine Tea',
    price: 55,
  },
  {
    id: 'DRINK_CALAMANSI',
    full: 'ส้มจี๊ดน้ำผึ้ง',
    short: 'ส้มจี๊ด',
    en: 'Calamansi Honey Black Tea',
    price: 45,
  },
  {
    id: 'DRINK_CHRYS',
    full: 'เก๊กฮวยเก๋ากี้',
    short: 'เก๊กฮวย',
    en: 'Chrysanthemum Goji',
    price: 39,
    advisory: CAFFEINE_FREE,
  },
  {
    // The price on the button is black tea's; jasmine and white are variants
    // with their own price (CLAUDE.md §6.1 — one button, the choice on the line).
    id: 'DRINK_PLAIN_TEA',
    full: 'ชาสกัดเย็นล้วน',
    short: 'ชาล้วน',
    en: 'Plain Cold Brew Tea',
    price: 35,
  },
  {
    // A dessert, not a drink: it never counts towards a two-cup pair.
    id: 'DESSERT_PEAR_JELLY',
    full: 'เยลลี่สาลี่พุทราเก๋ากี้',
    short: 'เยลลี่สาลี่',
    en: 'Pear Jujube Goji Jelly Cup',
    price: 39,
    advisory: CAFFEINE_FREE,
    kind: 'DESSERT',
  },
  {
    id: 'DRINK_ORANGE_MINT',
    full: 'ชาส้มมิ้นต์',
    short: 'ส้มมิ้นต์',
    en: 'Orange Mint Black Tea',
    price: 49,
  },
  {
    id: 'DRINK_PINEAPPLE_GINGER',
    full: 'สับปะรดขิงชามะลิ',
    short: 'สับปะรดขิง',
    en: 'Pineapple Ginger Jasmine',
    price: 49,
  },
  {
    id: 'DRINK_RASPBERRY',
    full: 'ราสเบอร์รีเลมอนชาขาว',
    short: 'ราสเบอร์รี',
    en: 'Raspberry Lemon White Tea',
    price: 59,
  },
  { id: 'DRINK_PEACH_OOLONG', full: 'พีชอูหลง', short: 'พีชอูหลง', en: 'Peach Oolong', price: 55 },
  {
    id: 'DRINK_STRAWBERRY_ROSELLE',
    full: 'สตรอว์เบอร์รีส้มกระเจี๊ยบ',
    short: 'สตรอว์เบอร์รี',
    en: 'Strawberry Orange Roselle',
    price: 49,
    advisory: `${CAFFEINE_FREE} · ตั้งครรภ์หรือให้นมบุตร ควรปรึกษาแพทย์ก่อนดื่มกระเจี๊ยบ`,
  },
  {
    id: 'DRINK_BLUEBERRY_PEA',
    full: 'บลูเบอร์รีอัญชัน',
    short: 'บลูเบอร์รี',
    en: 'Blueberry Butterfly Pea',
    price: 55,
    advisory: CAFFEINE_FREE,
  },
];

export const PRODUCTS: Product[] = PRODUCT_LIST.map((entry, index) => ({
  ...unsynced,
  id: entry.id,
  name_full_th: entry.full,
  name_short_th: entry.short,
  name_en: entry.en,
  base_price: toSatang(entry.price),
  kind: entry.kind ?? 'DRINK',
  advisory_th: entry.advisory ?? null,
  is_active: true,
  sort_order: index + 1,
}));

// ---------------------------------------------------------------- variants

/** Large straw and a spoon: the drinks with something to eat in them (menus 1–5). */
const WITH_SPOON = 'PKG_ICED_STRAW_SPOON';
/** Regular straw, no spoon (menus 6–8, 10–15). */
const STRAW = 'PKG_ICED_STRAW';

const variant = (
  id: string,
  product_id: string,
  name_th: string,
  packaging_set_id: string,
  extra: Partial<Variant> = {},
): Variant => ({
  ...unsynced,
  id,
  product_id,
  name_th,
  temp: 'ICED',
  price_override: null,
  packaging_set_id,
  is_default: true,
  is_active: true,
  sort_order: 1,
  ...extra,
});

export const VARIANTS: Variant[] = [
  variant('VAR_PEAR_ICED', 'DRINK_PEAR', 'สาลี่ขาว', WITH_SPOON),
  variant('VAR_LONGAN_ICED', 'DRINK_LONGAN', 'ลำไยขิง', WITH_SPOON),
  variant('VAR_PASSION_ICED', 'DRINK_PASSION', 'เสาวรส', WITH_SPOON),
  variant('VAR_GRAPE_ICED', 'DRINK_GRAPE', 'องุ่น', WITH_SPOON),
  variant('VAR_LYCHEE_ICED', 'DRINK_LYCHEE', 'ลิ้นจี่', WITH_SPOON),
  variant('VAR_CALAMANSI_ICED', 'DRINK_CALAMANSI', 'ส้มจี๊ด', STRAW),
  variant('VAR_CHRYS_ICED', 'DRINK_CHRYS', 'เก๊กฮวย', STRAW),
  variant('VAR_PLAIN_BLACK', 'DRINK_PLAIN_TEA', 'ชาแดง', STRAW),
  variant('VAR_PLAIN_JASMINE', 'DRINK_PLAIN_TEA', 'ชามะลิ', STRAW, {
    price_override: toSatang(39),
    is_default: false,
    sort_order: 2,
  }),
  variant('VAR_PLAIN_WHITE', 'DRINK_PLAIN_TEA', 'ชาขาว', STRAW, {
    price_override: toSatang(45),
    is_default: false,
    sort_order: 3,
  }),
  variant('VAR_PEAR_JELLY', 'DESSERT_PEAR_JELLY', 'เยลลี่สาลี่', 'PKG_JELLY_CUP', { temp: null }),
  variant('VAR_ORANGE_MINT_ICED', 'DRINK_ORANGE_MINT', 'ส้มมิ้นต์', STRAW),
  variant('VAR_PINEAPPLE_GINGER_ICED', 'DRINK_PINEAPPLE_GINGER', 'สับปะรดขิง', STRAW),
  variant('VAR_RASPBERRY_ICED', 'DRINK_RASPBERRY', 'ราสเบอร์รี', STRAW),
  variant('VAR_PEACH_OOLONG_ICED', 'DRINK_PEACH_OOLONG', 'พีชอูหลง', STRAW),
  variant('VAR_STRAWBERRY_ROSELLE_ICED', 'DRINK_STRAWBERRY_ROSELLE', 'สตรอว์เบอร์รี', STRAW),
  variant('VAR_BLUEBERRY_PEA_ICED', 'DRINK_BLUEBERRY_PEA', 'บลูเบอร์รี', STRAW),
];

// -------------------------------------------------------------- components
// `shelf_life_hours: 24` is how "same day" is stored. Close-day treats
// anything at or under 24 h as a same-day component that defaults to discard.
//
// cost_per_unit is THB per ml or per g of the finished component, worked out
// from the raw-ingredient prices in the master file. Null where an
// ingredient that matters has no price yet; the recipe note says which.

interface TrackedInput {
  id: string;
  name_th: string;
  unit: Unit;
  batch: number;
  yieldCups: number | null;
  shelfHours: number;
  leadHours?: number;
  lifecycle?: Lifecycle;
  role: ComponentRole;
  cost: number | null;
  note: string;
  cutShelfHours?: number;
  source?: { id: string; perUnit: number };
  prepStartBy?: string;
}

const tracked = (input: TrackedInput): Component => ({
  ...unsynced,
  id: input.id,
  name_th: input.name_th,
  unit: input.unit,
  default_batch_qty: input.batch,
  yield_cups: input.yieldCups,
  shelf_life_hours: input.shelfHours,
  cut_shelf_life_hours: input.cutShelfHours ?? null,
  lead_time_hours: input.leadHours ?? 0,
  cost_per_unit: input.cost,
  lifecycle: input.lifecycle ?? 'SIMPLE',
  role: input.role,
  recipe_note_th: input.note,
  is_batch_tracked: true,
  source_component_id: input.source?.id ?? null,
  source_qty_per_unit: input.source?.perUnit ?? null,
  prep_start_by: input.prepStartBy ?? null,
  is_active: true,
  sort_order: 0,
});

/** A daily garnish: cut the same morning, leftovers thrown away, not counted. */
const garnish = (
  id: string,
  name_th: string,
  unit: Unit,
  note: string,
  cost: number | null = null,
): Component => ({
  ...unsynced,
  id,
  name_th,
  unit,
  default_batch_qty: null,
  yield_cups: null,
  shelf_life_hours: null,
  cut_shelf_life_hours: null,
  lead_time_hours: 0,
  cost_per_unit: cost,
  lifecycle: 'SIMPLE',
  role: 'GARNISH',
  recipe_note_th: note,
  is_batch_tracked: false,
  source_component_id: null,
  source_qty_per_unit: null,
  prep_start_by: null,
  is_active: true,
  sort_order: 0,
});

const COLD_BREW = 'น้ำดื่มเท่านั้น แช่ในตู้เย็น ≤4°C ยกถุงชาออกตรงเวลา';
const TEA_ONLY_COST = 'ต้นทุนคิดเฉพาะใบชา ไม่รวมน้ำดื่ม';
const SAME_MORNING = 'ทำเช้าวันขาย เหลือทิ้ง';
const NO_PRICE = 'ต้นทุน: ยังไม่มีราคา';

/** One fruit-infused pitcher (P16): 3.1 L of water → ~3 L strained, ~10 cups. */
function pitcher(input: {
  id: string;
  name_th: string;
  ingredients: string;
  steepHours: number;
  batchCost: number;
  costNote: string;
  extraNote?: string;
}): Component {
  return tracked({
    id: input.id,
    name_th: input.name_th,
    unit: 'ML',
    // The master file says to start at half batches (§9): 1.55 L water → 1.5 L.
    batch: 1500,
    yieldCups: 5,
    shelfHours: 48,
    leadHours: input.steepHours,
    lifecycle: 'STEEP',
    role: 'TEA_BASE',
    cost: input.batchCost / 3000,
    note: [
      'สูตรเต็ม: น้ำดื่มเย็น 3.1 L → ชากรองแล้ว ~3 L (~10 แก้ว) · ครึ่งสูตร = ครึ่งทุกอย่าง (เริ่มที่ครึ่งสูตร)',
      input.ingredients,
      `แช่ตู้เย็น ${input.steepHours} ชม.${input.steepHours < 12 ? ' ห้ามเกิน' : ''}`,
      'ไม่ใส่น้ำตาลหรือน้ำผึ้งในเหยือก · ปอกส้ม/เลมอนเอาเยื่อขาวออก · กรองกากทิ้ง ห้ามแช่กากเกิน 24 ชม. · อายุ 2 วันนับจากกรอง',
      'สถานะ: ยังไม่ได้ชิม (แปลงจากสูตร Oh, How Civilized)',
      input.extraNote,
      input.costNote,
    ]
      .filter(Boolean)
      .join(' · '),
  });
}

const COMPONENT_LIST: Component[] = [
  // ---- cold-brewed teas and bases (P1–P5)
  tracked({
    id: 'COMP_TEA_RED',
    name_th: 'ชาแดงสกัดเย็น',
    unit: 'ML',
    batch: 9000,
    yieldCups: null,
    shelfHours: 72,
    leadHours: 10,
    lifecycle: 'STEEP',
    role: 'TEA_BASE',
    cost: (50 * perGram(400)) / 9000,
    prepStartBy: '21:00',
    note: `สูตรเต็ม: ใบชาแดง 50 g + น้ำดื่มเย็น 9.3 L → 9 L · ครึ่งสูตร: 25 g + 4.65 L → 4.5 L · ${COLD_BREW} 10 ชม. · ~2.5 ครั้งต่อรอบ 3 วัน · ใช้ใน: สาลี่ ~200 ml, ส้มจี๊ด ~265 ml, ชาแดงล้วน ~290 ml, เยลลี่ชาแดง 600 ml/ครั้ง · สถานะ: ต้องชิมความเข้มอีกครั้ง (แทนชาแดงต้มร้อนที่ใช้ตอนชิม) · ${TEA_ONLY_COST}`,
  }),
  tracked({
    id: 'COMP_TEA_WHITE',
    name_th: 'ชาขาวสกัดเย็น',
    unit: 'ML',
    batch: 8000,
    yieldCups: null,
    shelfHours: 72,
    leadHours: 13,
    lifecycle: 'STEEP',
    role: 'TEA_BASE',
    cost: (52 * perGram(1200)) / 8000,
    prepStartBy: '19:00',
    note: `ใบชาขาว 52 g + น้ำดื่มเย็น 8.25 L → 8 L · ${COLD_BREW} 12–14 ชม. · 3 ครั้งต่อรอบ 3 วัน · ใช้ใน: ลำไยขิง, องุ่น, ชาขาวล้วน · ${TEA_ONLY_COST}`,
  }),
  tracked({
    id: 'COMP_TEA_JASMINE',
    name_th: 'ชามะลิสกัดเย็น',
    unit: 'ML',
    batch: 8000,
    yieldCups: null,
    shelfHours: 48,
    leadHours: 8,
    lifecycle: 'STEEP',
    role: 'TEA_BASE',
    cost: (65 * perGram(500)) / 8000,
    note: `สูตรเต็ม: ใบชาเขียวมะลิ (ใบชา ไม่ใช่ผงหรือพรีมิกซ์) 65 g + น้ำดื่มเย็น 8.3 L → 8 L · ครึ่งสูตร: 33 g + 4.15 L → 4 L · ${COLD_BREW} 8 ชม. เป็นชาเขียว ห้ามแช่เกิน · 1 ครั้งทุก 2 วัน · ใช้ใน: ลิ้นจี่, ชามะลิล้วน · สถานะ: ยังไม่ได้ชิม · ${TEA_ONLY_COST}`,
  }),
  tracked({
    id: 'COMP_BUTTERFLY_PEA',
    name_th: 'อัญชันสกัดเย็น',
    unit: 'ML',
    batch: 8000,
    yieldCups: null,
    shelfHours: 72,
    leadHours: 8,
    lifecycle: 'STEEP',
    role: 'TEA_BASE',
    cost: (40 * perGram(400)) / 8000,
    note: `สูตรเต็ม: ดอกอัญชันแห้ง 40 g (ล้างแล้ว) + น้ำดื่มเย็น 8.3 L → 8 L · ครึ่งสูตร: 20 g + 4.15 L → 4 L · ${COLD_BREW} 8 ชม. · 1 ครั้งต่อรอบ 3 วัน · ห้ามโดนกรด แยกเหยือกและกระบวย · ใช้ใน: เสาวรส · ต้นทุนคิดเฉพาะดอกอัญชัน ไม่รวมน้ำดื่ม`,
  }),
  tracked({
    id: 'COMP_CHRYS_TEA',
    name_th: 'น้ำเก๊กฮวย',
    unit: 'ML',
    batch: 9000,
    yieldCups: 30,
    shelfHours: 72,
    role: 'TEA_BASE',
    cost: null,
    note: `ดอกเก๊กฮวยแห้ง 120 g (ล้างแล้ว) + น้ำดื่มเดือด 3.5 L แช่นอกเตา 10 นาที กรอง แล้วเติมน้ำดื่มเย็นจัดให้ครบ 9 L → ~30 แก้ว · 1 ครั้งต่อรอบ 3 วัน · ใช้ใน: เก๊กฮวย · สถานะ: ยังไม่ได้ชิม · ${NO_PRICE}ดอกเก๊กฮวย`,
  }),

  // ---- sweetness (P6)
  tracked({
    id: 'COMP_SYRUP',
    name_th: 'น้ำเชื่อมกลาง',
    unit: 'ML',
    batch: 2000,
    yieldCups: null,
    shelfHours: 336,
    role: 'SWEETENER',
    // The cost file prices 3 pumps (30 ml) at 0.78 THB.
    cost: 0.78 / 30,
    note: 'น้ำตาลกรวด 1 kg + น้ำ 1.38 L → ~2 L = 200 ปั๊ม · 1 ปั๊ม = 10 ml = น้ำตาล 5 g · เก็บตู้เย็น 14 วัน ทำเมื่อใกล้หมด · ให้ความหวานทุกเมนู ยกเว้นลำไยขิง (ใช้หัวเชื้อลำไย) และเยลลี่ (หวานคงที่) · ต้นทุนจากไฟล์ต้นทุน: 3 ปั๊ม 0.78 บาท · เรื่องค้าง: น้ำตาลหลังย้ายมาใช้น้ำเชื่อมกลาง สาลี่ 10.75 → 10 g, เสาวรส 16.7 → 15 g ต้องชิม · น้ำผึ้งเชื่อมเป็นทางเลือกให้ชาแช่ผลไม้ ยังไม่ได้ใช้',
  }),

  // ---- fruit bases and concentrates (P7–P10, P13)
  tracked({
    id: 'COMP_BASE_CALAMANSI',
    name_th: 'ฐานส้มจี๊ดน้ำผึ้ง',
    unit: 'ML',
    batch: 600,
    yieldCups: 30,
    shelfHours: 96,
    role: 'CONCENTRATE',
    cost: null,
    note: `น้ำส้มจี๊ด 450 ml (ผล ~1.2–1.4 kg) + น้ำผึ้ง 200 g + เกลือทะเล 2 g → ~0.6 L (30 แก้ว) · ไม่ต้ม ไม่ใส่น้ำตาล · 1 ครั้งต่อรอบ 3 วัน · ใช้ใน: ส้มจี๊ด 20 ml/แก้ว · สถานะ: ยังไม่ได้ชิม · ${NO_PRICE}น้ำผึ้ง (ส้มจี๊ดอย่างเดียว ~72–84 บาท/ครั้ง)`,
  }),
  tracked({
    id: 'COMP_BASE_PASSION',
    name_th: 'ฐานเสาวรสน้ำผึ้ง',
    unit: 'ML',
    batch: 950,
    yieldCups: 30,
    shelfHours: 96,
    role: 'CONCENTRATE',
    cost: null,
    note: `เนื้อเสาวรสพร้อมเมล็ด 600 g (~18–20 ลูก) + น้ำผึ้ง 100 g + เกลือทะเล 2 g + น้ำ 300 ml → ~0.95 L (30 แก้ว) · ไม่ใส่น้ำตาล · เก็บโหลปากกว้าง ตักด้วยกระบวย 30 ml · 1 ครั้งต่อรอบ 3 วัน · ใช้ใน: เสาวรส 30 ml/แก้ว · สถานะ: ชิมสัดส่วนแล้ว ✓ ตัดน้ำตาลออกแล้วต้องชิมอีกครั้ง · ${NO_PRICE}เสาวรสและน้ำผึ้ง`,
  }),
  tracked({
    id: 'COMP_BASE_LYCHEE',
    name_th: 'ฐานลิ้นจี่กุหลาบ',
    unit: 'ML',
    batch: 680,
    yieldCups: 15,
    shelfHours: 72,
    role: 'CONCENTRATE',
    cost: null,
    note: `ลิ้นจี่ในน้ำเชื่อม 2 กระป๋อง (565 g, ~15 ลูก/กระป๋อง) + ดอกกุหลาบแห้ง 6 g + น้ำมะนาว 20 ml + เกลือทะเล 1 g → ลิ้นจี่ ~30 ลูก + น้ำฐาน ~680 ml (~15 แก้ว) · ไม่เติมน้ำตาล · อายุรวมเนื้อลิ้นจี่ · 2 ครั้งต่อรอบ 3 วัน · ใช้ใน: ลิ้นจี่ ลิ้นจี่ 2 ลูก (ฉีกครึ่ง) + น้ำฐาน 40 ml/แก้ว · นับสต็อกเป็น ml ของน้ำฐาน · สถานะ: ยังไม่ได้ชิม · ${NO_PRICE}`,
  }),
  tracked({
    id: 'COMP_CONC_PEAR',
    name_th: 'หัวเชื้อสาลี่',
    unit: 'ML',
    batch: 4000,
    yieldCups: 60,
    shelfHours: 120,
    role: 'CONCENTRATE',
    cost: null,
    note: `สูตร 4 L (ปกติ: 60 แก้ว + เยลลี่ถ้วย): สาลี่ 4.32 kg · พุทราจีนแห้ง 140 g · เก๋ากี้ 51 g · เกลือทะเล 11 g · น้ำ 3.3 L → 4.0 L · สูตร 3 L (เมื่อไม่ขายเยลลี่ถ้วย): สาลี่ 3.24 kg · พุทรา 105 g · เก๋ากี้ 38 g · เกลือ 8 g · น้ำ 2.5 L → 3.0 L · ต้มสาลี่และพุทราแล้วทิ้ง เก๋ากี้อยู่ต่อ · ไม่ใส่น้ำตาล · ทำทุก ~4–5 วัน · ใช้ใน: สาลี่ 50 ml/แก้ว, เยลลี่สาลี่ 400 ml/ครั้ง · สถานะ: ชิมสัดส่วนแล้ว ✓ · เรื่องค้าง: น้ำหนักสาลี่ชั่งก่อนหรือหลังปอกยังไม่ระบุ · ${NO_PRICE}สาลี่ พุทรา เก๋ากี้`,
  }),
  tracked({
    id: 'COMP_LONGAN_CONC',
    name_th: 'หัวเชื้อลำไยขิง',
    unit: 'ML',
    batch: 1200,
    yieldCups: 30,
    shelfHours: 168,
    role: 'CONCENTRATE',
    cost: null,
    note: `ลำไยอบแห้ง 360 g + ขิงฝอย (ขิงสด ไม่ดอง) 144 g + น้ำตาลทรายแดง 630 g + น้ำตาลอ้อยก้อน 120 g + เกลือทะเล 4 g + น้ำ 1.1 L → 1.4 L (30 แก้ว) · แบ่ง 1.2 L ใส่ขวดปั๊ม 10 ml (นับที่นี่) + 0.2 L ราดเนื้อลำไยที่ต้มแล้ว (นับเป็น ลำไยแช่หัวเชื้อ) · ห้ามลดน้ำตาล: ช่วยถนอม และทำให้ชั้นล่างหนักพอจะแยกชั้น · 1 ครั้งต่อรอบ 3 วัน · ใช้ใน: ลำไยขิง 4 / 3 / 2 ปั๊ม · สถานะ: ชิมสัดส่วนแล้ว ✓ · ${NO_PRICE}`,
  }),
  tracked({
    id: 'COMP_LONGAN_FLESH',
    name_th: 'ลำไยแช่หัวเชื้อ',
    unit: 'G',
    // Not in the master file: 30 cups × (18 g + ~4 g garnish). Weigh one and
    // correct it in settings.
    batch: 660,
    yieldCups: 30,
    shelfHours: 120,
    role: 'SOLID',
    cost: null,
    note: `เนื้อลำไยที่ต้มในหัวเชื้อ แช่ในหัวเชื้อ 0.2 L · ได้จากหัวเชื้อลำไยขิงครั้งเดียวกัน · ใช้ใน: ลำไยขิง 18 g + โรยหน้า 2 ชิ้น (~4 g) = 22 g/แก้ว · จำนวนต่อครั้ง 660 g คิดจาก 30 แก้ว × 22 g ยังไม่ได้ชั่งจริง · ${NO_PRICE}`,
  }),

  // ---- solids and jellies (P11, P12, P14, P15)
  tracked({
    id: 'COMP_JELLY_RED_GOJI',
    name_th: 'เยลลี่ชาแดงฝังเก๋ากี้',
    unit: 'G',
    batch: 1000,
    yieldCups: 33,
    shelfHours: 72,
    cutShelfHours: 24,
    // Not in the master file: the setting time the old jellies used.
    leadHours: 40 / 60,
    lifecycle: 'SLAB_CUT',
    role: 'SOLID',
    cost: null,
    // ชาแดงสกัดเย็น 600 ml per 1,000 g slab.
    source: { id: 'COMP_TEA_RED', perUnit: 0.6 },
    note: `ชาแดงสกัดเย็น 600 ml + น้ำ 400 ml + ผงวุ้น 10 g + น้ำตาลกรวด 70 g + เก๋ากี้ 40 g → 1 L (33 แก้ว ที่ 30 g) · อายุทั้งแผ่น 3 วัน · ตัดเต๋า 1 cm วันขาย เหลือทิ้ง · ใช้ใน: สาลี่ 30 g/แก้ว · เรื่องค้าง: 1 L = 33 แก้ว แต่สาลี่วางแผน 40 แก้ว/รอบ (ทางเลือก ~1.2 ครั้ง) · น้ำเชื่อม 5% สำหรับแช่แผ่นเยลลี่ยังไม่มีสูตร (แนะนำ น้ำเชื่อมกลาง 1 ส่วน + น้ำต้มสุก 8 ส่วน) · เวลาเซ็ตตัว 40 นาทีใช้ค่าเดิม ยังไม่ได้ระบุ · ${NO_PRICE}ผงวุ้น น้ำตาลกรวด เก๋ากี้`,
  }),
  tracked({
    id: 'COMP_PEAR_FRESH',
    name_th: 'กอง B',
    unit: 'G',
    batch: 420,
    yieldCups: 20,
    shelfHours: 24,
    role: 'SOLID',
    cost: 0.07,
    note: 'สาลี่สดหั่นเต๋า ~420 g/วัน แช่จมในน้ำสาลี่เย็น · วันต่อวัน เหลือทิ้ง · ใช้ใน: สาลี่ 21 g/แก้ว (หั่นเพิ่มสำหรับเยลลี่สาลี่ด้วย) · เรื่องค้าง: 420 g/วัน พอ 20 แก้ว แต่สาลี่ขาย ~13 แก้ว/วัน (ทางเลือก ~280 g/วัน)',
  }),
  tracked({
    id: 'COMP_GRAPE_MASH',
    name_th: 'องุ่นบดมือ',
    unit: 'G',
    // Made in half batches, every other day.
    batch: 600,
    yieldCups: 15,
    shelfHours: 48,
    role: 'SOLID',
    cost: null,
    note: `สูตรเต็ม: องุ่นแดง/ดำไร้เมล็ด 1.2 kg + น้ำมะนาว 20 ml + เกลือทะเล 1 g → ~1.2 kg (30 แก้ว ที่ 40 g) · ทำครึ่งสูตร วันเว้นวัน · ไม่ใส่น้ำตาล · ใช้ใน: องุ่น 40 g/แก้ว · สถานะ: ยังไม่ได้ชิม · เรื่องค้าง: ครึ่งสูตรวันเว้นวัน ได้ 15 แก้ว/2 วัน แต่วางแผน ~20 · ${NO_PRICE}`,
  }),
  tracked({
    id: 'COMP_PEAR_JELLY',
    name_th: 'เยลลี่สาลี่พุทราเก๋ากี้',
    unit: 'G',
    batch: 1600,
    yieldCups: 10,
    shelfHours: 48,
    role: 'SOLID',
    cost: null,
    // หัวเชื้อสาลี่ 400 ml per 1,600 g.
    source: { id: 'COMP_CONC_PEAR', perUnit: 0.25 },
    note: `หัวเชื้อสาลี่ 400 ml + น้ำ 800 ml + ผงวุ้น 10 g + น้ำตาลกรวด 120 g + พุทราจีนแห้ง (ฉีก) 30 g + สาลี่สดหั่นเต๋า 300 g + เก๋ากี้ 25 g → ~1.6 kg = 10 ถ้วย × 160 g · ทำวันเว้นวัน · หวานคงที่ ~12 g น้ำตาล/ถ้วย · ขายเป็น เยลลี่สาลี่ · สถานะ: ยังไม่ได้ชิม · ${NO_PRICE}`,
  }),

  // ---- fruit-infused pitchers (P16)
  pitcher({
    id: 'COMP_PITCHER_ORANGE_MINT',
    name_th: 'เหยือกส้มมิ้นต์',
    ingredients:
      'ใบชาแดง 24 g (ใส่ถุง) · ส้มสายน้ำผึ้ง 3 ลูก (~600 g) · เลมอน 1 ลูก · ใบมิ้นต์ 12 ใบ',
    steepHours: 12,
    batchCost: 24 * perGram(400) + 600 * perGram(70) + 15,
    costNote: 'ต้นทุนไม่รวมมิ้นต์ (ยังไม่รู้น้ำหนักต่อใบ) · ราคาส้ม เลมอน เป็นราคาประมาณ',
  }),
  pitcher({
    id: 'COMP_PITCHER_PINEAPPLE_GINGER',
    name_th: 'เหยือกสับปะรดขิง',
    ingredients:
      'ใบชาเขียวมะลิ 25 g (ใส่ถุง) · เนื้อสับปะรด 700 g (≈ทั้งลูก 1.27 kg) · ส้มจี๊ด 6 ลูก คั้นเอาแต่น้ำ · ขิงแก่สด 50 g ขูด',
    steepHours: 6,
    batchCost: 25 * perGram(500) + 1270 * perGram(25) + 50 * perGram(60),
    costNote: 'ต้นทุนไม่รวมส้มจี๊ด (ยังไม่รู้น้ำหนักต่อลูก) · ราคาสับปะรด ขิง เป็นราคาประมาณ',
  }),
  pitcher({
    id: 'COMP_PITCHER_RASPBERRY',
    name_th: 'เหยือกราสเบอร์รี',
    ingredients: 'ใบชาขาว 20 g (ใส่ถุง) · ราสเบอร์รีแช่แข็ง 200 g · เลมอน 1 ลูก · ใบมิ้นต์ 15 ใบ',
    steepHours: 12,
    batchCost: 20 * perGram(1200) + 200 * perGram(350) + 15,
    costNote: 'ต้นทุนไม่รวมมิ้นต์ (ยังไม่รู้น้ำหนักต่อใบ) · ราคาราสเบอร์รี เลมอน เป็นราคาประมาณ',
  }),
  pitcher({
    id: 'COMP_PITCHER_PEACH_OOLONG',
    name_th: 'เหยือกพีชอูหลง',
    ingredients: 'ใบชาอูหลง 24 g (2 ถุง) · พีช 600 g · เลมอน 1 ลูก · ตะไคร้ 3 ต้น (~60 g)',
    steepHours: 12,
    batchCost: 24 * perGram(1000) + 600 * perGram(130) + 15 + 60 * perGram(40),
    extraNote:
      'เรื่องค้าง: ยังไม่เลือกชนิดพีช (สดนำเข้า / แช่แข็ง / กระป๋องสะเด็ดน้ำล้างแล้ว) ราคาคิดแบบกระป๋อง',
    costNote: 'ราคาอูหลง พีช เลมอน ตะไคร้ เป็นราคาประมาณ',
  }),
  pitcher({
    id: 'COMP_PITCHER_STRAWBERRY_ROSELLE',
    name_th: 'เหยือกสตรอว์เบอร์รี',
    ingredients:
      'กระเจี๊ยบแห้ง 22 g (ใส่ถุง) · สตรอว์เบอร์รีแช่แข็ง 400 g · ส้มสายน้ำผึ้ง 1½ ลูก (~300 g) · ใบมิ้นต์ 25 ใบ',
    steepHours: 12,
    batchCost: 22 * perGram(300) + 400 * perGram(150) + 300 * perGram(70),
    costNote:
      'ต้นทุนไม่รวมมิ้นต์ (ยังไม่รู้น้ำหนักต่อใบ) · ราคากระเจี๊ยบ สตรอว์เบอร์รี ส้ม เป็นราคาประมาณ',
  }),
  pitcher({
    id: 'COMP_PITCHER_BLUEBERRY_PEA',
    name_th: 'เหยือกบลูเบอร์รี',
    ingredients:
      'ดอกอัญชันแห้ง 15 g (ใส่ถุง) · บลูเบอร์รีแช่แข็ง 300 g · เลมอน 1 ลูก · ใบมิ้นต์ 15 ใบ',
    steepHours: 12,
    batchCost: 15 * perGram(400) + 300 * perGram(300) + 15,
    costNote: 'ต้นทุนไม่รวมมิ้นต์ (ยังไม่รู้น้ำหนักต่อใบ) · ราคาบลูเบอร์รี เลมอน เป็นราคาประมาณ',
  }),

  // ---- daily garnishes, Yakult
  garnish(
    'COMP_CHRYS_GARNISH',
    'เก๊กฮวยแห้งโรยหน้า',
    'PC',
    'ดอกเก๊กฮวยแห้งโรยหน้าสาลี่ · ปริมาณต่อแก้วยังไม่ได้กำหนด',
    0.03,
  ),
  garnish(
    'COMP_GARNISH_OSMANTHUS',
    'ดอกกุ้ยฮวา',
    'G',
    `ดอกกุ้ยฮวาแห้ง 0.2 g โรยหน้าลำไยขิง · ${NO_PRICE}`,
  ),
  garnish(
    'COMP_GARNISH_PASSION',
    'เสาวรสผ่าครึ่ง',
    'PC',
    `ผ่าครึ่งตามขวาง ½ ลูก/แก้ว (นอกฤดู ธ.ค.–มิ.ย. ¼ ลูก) · ${SAME_MORNING} · ${NO_PRICE}`,
  ),
  garnish(
    'COMP_GARNISH_GRAPE',
    'องุ่นผ่าครึ่ง',
    'PC',
    `ผ่าครึ่งตามยาว 1 ลูก (2 ซีก)/แก้ว · ${SAME_MORNING} · ${NO_PRICE}`,
  ),
  garnish(
    'COMP_GARNISH_ROSE',
    'ดอกกุหลาบแห้งโรยหน้า',
    'PC',
    `ดอกกุหลาบแห้ง 3 ดอก (~0.5 g)/แก้ว · ${NO_PRICE}`,
  ),
  garnish(
    'COMP_GARNISH_CALAMANSI',
    'ส้มจี๊ดผ่าครึ่ง',
    'PC',
    `ส้มจี๊ด: 1 ลูก (2 ซีก) ในส้มจี๊ด · ½ ลูก ในสับปะรดขิง · ${SAME_MORNING} · ${NO_PRICE}ต่อลูก (ส้มจี๊ด 60 บาท/กก.)`,
  ),
  garnish(
    'COMP_GARNISH_GOJI',
    'เก๋ากี้แช่',
    'G',
    `เก๋ากี้แช่น้ำ 4 g (น้ำหนักแห้ง)/แก้ว · ${SAME_MORNING} · ${NO_PRICE}`,
  ),
  garnish(
    'COMP_GARNISH_ORANGE',
    'ส้มครึ่งแว่น',
    'PC',
    `ส้มสายน้ำผึ้งครึ่งแว่น ไม่ปอกเปลือก 1 ชิ้น/แก้ว · ${SAME_MORNING} · ${NO_PRICE}ต่อชิ้น (ส้ม 70 บาท/กก.)`,
  ),
  garnish(
    'COMP_GARNISH_RASPBERRY',
    'ราสเบอร์รีโรยหน้า',
    'PC',
    `ราสเบอร์รีแช่แข็ง 2 ลูก/แก้ว หยิบจากช่องแช่แข็งตอนทำ ห้ามแช่แข็งซ้ำ · ${NO_PRICE}ต่อลูก (350 บาท/กก.)`,
  ),
  garnish(
    'COMP_GARNISH_PEACH',
    'พีชฝาน',
    'PC',
    `พีชฝานบาง 1 ชิ้น/แก้ว · ${SAME_MORNING} · ${NO_PRICE}ต่อชิ้น (~130 บาท/กก.)`,
  ),
  garnish(
    'COMP_GARNISH_MINT',
    'ยอดมิ้นต์',
    'PC',
    `ยอดมิ้นต์ 1 ยอด/แก้ว · ใบมิ้นต์เด็ดแล้วเก็บตู้เย็น 3–4 วัน · ${NO_PRICE}ต่อยอด (200 บาท/กก.)`,
  ),
  garnish(
    'COMP_GARNISH_BLUEBERRY',
    'บลูเบอร์รีโรยหน้า',
    'PC',
    `บลูเบอร์รีแช่แข็ง 3 ลูก/แก้ว หยิบจากช่องแช่แข็งตอนทำ ห้ามแช่แข็งซ้ำ · ${NO_PRICE}ต่อลูก (300 บาท/กก.)`,
  ),
  {
    // Bought by the bottle and dated by the bottle: not made, not counted.
    ...garnish(
      'COMP_YAKULT',
      'ยาคูลท์',
      'PC',
      `ขวด 80 ml · น้ำตาล ~14 g/ขวด (≈3 ปั๊ม) · เทหลังฐาน ก่อนน้ำแข็ง · ${NO_PRICE} · เรื่องค้าง: ถ้ายาคูลท์เกิน 10 บาท/ขวด ราคาเพิ่มหน้าร้านเป็น +20 บาท`,
    ),
    role: 'CONCENTRATE',
  },
];

export const COMPONENTS: Component[] = COMPONENT_LIST.map((component, index) => ({
  ...component,
  sort_order: index + 1,
}));

// -------------------------------------------------------------------- BOM
// Variant level, at normal sweetness. Every tea is brewed ready to drink: no
// plain water goes into a cup at assembly. Sweetness and Yakult change these
// through modifiers below, never by a second recipe.

const bom = (variant_id: string, component_id: string, qty_per_cup: number): Bom => ({
  ...unsynced,
  id: `BOM_${variant_id}_${component_id}`,
  variant_id,
  component_id,
  qty_per_cup,
});

/** 1 pump of central syrup is 10 ml. */
const PUMP = 10;

/** Menus 10–15: syrup, ice, the pitcher to the line, a garnish. Nothing else in the cup. */
const infused = (variantId: string, pitcherId: string, garnishId: string, garnishQty: number) => [
  bom(variantId, 'COMP_SYRUP', 3 * PUMP),
  bom(variantId, pitcherId, 290),
  bom(variantId, garnishId, garnishQty),
];

export const BOM_ROWS: Bom[] = [
  // M1 — layered bottom up: syrup, jelly, Pile B, concentrate, ice, tea.
  bom('VAR_PEAR_ICED', 'COMP_SYRUP', 2 * PUMP),
  bom('VAR_PEAR_ICED', 'COMP_JELLY_RED_GOJI', 30),
  bom('VAR_PEAR_ICED', 'COMP_PEAR_FRESH', 21),
  bom('VAR_PEAR_ICED', 'COMP_CONC_PEAR', 50),
  bom('VAR_PEAR_ICED', 'COMP_TEA_RED', 200),
  bom('VAR_PEAR_ICED', 'COMP_CHRYS_GARNISH', 1),

  // M2 — no central syrup: the longan concentrate is the sweetness. White tea
  // is the bottom pour (60 ml at normal) plus ~200 ml on top.
  bom('VAR_LONGAN_ICED', 'COMP_LONGAN_FLESH', 18 + 4),
  bom('VAR_LONGAN_ICED', 'COMP_LONGAN_CONC', 4 * PUMP),
  bom('VAR_LONGAN_ICED', 'COMP_TEA_WHITE', 60 + 200),
  bom('VAR_LONGAN_ICED', 'COMP_GARNISH_OSMANTHUS', 0.2),

  bom('VAR_PASSION_ICED', 'COMP_SYRUP', 3 * PUMP),
  bom('VAR_PASSION_ICED', 'COMP_BASE_PASSION', 30),
  bom('VAR_PASSION_ICED', 'COMP_BUTTERFLY_PEA', 260),
  bom('VAR_PASSION_ICED', 'COMP_GARNISH_PASSION', 0.5),

  bom('VAR_GRAPE_ICED', 'COMP_SYRUP', 3 * PUMP),
  bom('VAR_GRAPE_ICED', 'COMP_GRAPE_MASH', 40),
  bom('VAR_GRAPE_ICED', 'COMP_TEA_WHITE', 250),
  bom('VAR_GRAPE_ICED', 'COMP_GARNISH_GRAPE', 1),

  bom('VAR_LYCHEE_ICED', 'COMP_SYRUP', 2 * PUMP),
  bom('VAR_LYCHEE_ICED', 'COMP_BASE_LYCHEE', 40),
  bom('VAR_LYCHEE_ICED', 'COMP_TEA_JASMINE', 245),
  bom('VAR_LYCHEE_ICED', 'COMP_GARNISH_ROSE', 3),

  bom('VAR_CALAMANSI_ICED', 'COMP_SYRUP', 3 * PUMP),
  bom('VAR_CALAMANSI_ICED', 'COMP_BASE_CALAMANSI', 20),
  bom('VAR_CALAMANSI_ICED', 'COMP_GARNISH_CALAMANSI', 1),
  bom('VAR_CALAMANSI_ICED', 'COMP_TEA_RED', 265),

  bom('VAR_CHRYS_ICED', 'COMP_SYRUP', 3 * PUMP),
  bom('VAR_CHRYS_ICED', 'COMP_CHRYS_TEA', 290),
  bom('VAR_CHRYS_ICED', 'COMP_GARNISH_GOJI', 4),

  bom('VAR_PLAIN_BLACK', 'COMP_SYRUP', 3 * PUMP),
  bom('VAR_PLAIN_BLACK', 'COMP_TEA_RED', 290),
  bom('VAR_PLAIN_JASMINE', 'COMP_SYRUP', 3 * PUMP),
  bom('VAR_PLAIN_JASMINE', 'COMP_TEA_JASMINE', 290),
  bom('VAR_PLAIN_WHITE', 'COMP_SYRUP', 3 * PUMP),
  bom('VAR_PLAIN_WHITE', 'COMP_TEA_WHITE', 290),

  bom('VAR_PEAR_JELLY', 'COMP_PEAR_JELLY', 160),

  ...infused('VAR_ORANGE_MINT_ICED', 'COMP_PITCHER_ORANGE_MINT', 'COMP_GARNISH_ORANGE', 1),
  ...infused(
    'VAR_PINEAPPLE_GINGER_ICED',
    'COMP_PITCHER_PINEAPPLE_GINGER',
    'COMP_GARNISH_CALAMANSI',
    0.5,
  ),
  ...infused('VAR_RASPBERRY_ICED', 'COMP_PITCHER_RASPBERRY', 'COMP_GARNISH_RASPBERRY', 2),
  ...infused('VAR_PEACH_OOLONG_ICED', 'COMP_PITCHER_PEACH_OOLONG', 'COMP_GARNISH_PEACH', 1),
  ...infused(
    'VAR_STRAWBERRY_ROSELLE_ICED',
    'COMP_PITCHER_STRAWBERRY_ROSELLE',
    'COMP_GARNISH_MINT',
    1,
  ),
  ...infused('VAR_BLUEBERRY_PEA_ICED', 'COMP_PITCHER_BLUEBERRY_PEA', 'COMP_GARNISH_BLUEBERRY', 3),
];

// -------------------------------------------------------------- packaging

// Cups, lids, straws and the rest are counted as stock; ice is not — it is
// bought by the bag each morning and gone by night. Nothing warns until the
// owner sets a reorder point.
const counted = { is_stock_tracked: true, reorder_at: null };
const notCounted = { is_stock_tracked: false, reorder_at: null };

export const PACKAGING_ITEMS: PackagingItem[] = [
  {
    ...unsynced,
    ...counted,
    id: 'PKGI_CUP_PLASTIC_16OZ',
    name_th: 'แก้วพลาสติก 16 oz',
    unit_cost: toSatang(1.18),
  },
  {
    ...unsynced,
    ...counted,
    id: 'PKGI_CUP_PAPER_HOT',
    name_th: 'แก้วกระดาษร้อน',
    unit_cost: toSatang(1.5),
  },
  { ...unsynced, ...counted, id: 'PKGI_LID', name_th: 'ฝา', unit_cost: toSatang(0.59) },
  {
    ...unsynced,
    ...counted,
    id: 'PKGI_STRAW_NORMAL',
    name_th: 'หลอดปกติ',
    unit_cost: toSatang(0.14),
  },
  {
    ...unsynced,
    ...counted,
    id: 'PKGI_STRAW_WIDE',
    name_th: 'หลอดใหญ่',
    unit_cost: toSatang(0.25),
  },
  { ...unsynced, ...counted, id: 'PKGI_SPOON', name_th: 'ช้อน', unit_cost: toSatang(0.35) },
  { ...unsynced, ...counted, id: 'PKGI_CARRY_BAG', name_th: 'ถุงหิ้ว', unit_cost: toSatang(0.2) },
  // 180 g a cup, 0.54 THB a cup (master file §1).
  { ...unsynced, ...notCounted, id: 'PKGI_ICE', name_th: 'น้ำแข็ง', unit_cost: toSatang(0.54) },
  {
    ...unsynced,
    ...counted,
    id: 'PKGI_LOGO_STICKER',
    name_th: 'สติกเกอร์โลโก้',
    unit_cost: toSatang(0.3),
  },
  {
    ...unsynced,
    ...counted,
    id: 'PKGI_BOTTLE_PET_1L',
    name_th: 'ขวด PET 1 ลิตร',
    unit_cost: toSatang(7.0),
  },
  {
    // The master file has no price for it yet: ฿0 until one is entered.
    ...unsynced,
    ...counted,
    id: 'PKGI_CUP_8OZ_FLAT_LID',
    name_th: 'ถ้วย 8 oz ฝาเรียบ',
    unit_cost: 0,
  },
];

const pkg = (packaging_item_id: string, qty = 1) => ({ packaging_item_id, qty });

// The carry bag is inside every cup set. The master file lists the sets as
// cup, lid, straw, bag (and a spoon for menus 1–5) — no logo sticker.
export const PACKAGING_SETS: PackagingSet[] = [
  {
    ...unsynced,
    id: 'PKG_ICED_STRAW',
    name: 'แก้วเย็น หลอดปกติ',
    items: [
      pkg('PKGI_CUP_PLASTIC_16OZ'),
      pkg('PKGI_LID'),
      pkg('PKGI_STRAW_NORMAL'),
      pkg('PKGI_ICE'),
      pkg('PKGI_CARRY_BAG'),
    ],
  },
  {
    ...unsynced,
    id: 'PKG_ICED_STRAW_SPOON',
    name: 'แก้วเย็น หลอดใหญ่ ช้อน',
    items: [
      pkg('PKGI_CUP_PLASTIC_16OZ'),
      pkg('PKGI_LID'),
      pkg('PKGI_STRAW_WIDE'),
      pkg('PKGI_SPOON'),
      pkg('PKGI_ICE'),
      pkg('PKGI_CARRY_BAG'),
    ],
  },
  {
    ...unsynced,
    id: 'PKG_JELLY_CUP',
    name: 'ถ้วยเยลลี่',
    items: [pkg('PKGI_CUP_8OZ_FLAT_LID'), pkg('PKGI_SPOON')],
  },
  {
    ...unsynced,
    id: 'PKG_HOT',
    name: 'แก้วร้อน',
    items: [
      pkg('PKGI_CUP_PAPER_HOT'),
      pkg('PKGI_LID'),
      pkg('PKGI_SPOON'),
      pkg('PKGI_LOGO_STICKER'),
      pkg('PKGI_CARRY_BAG'),
    ],
  },
  {
    ...unsynced,
    id: 'PKG_BOTTLE',
    name: 'ขวด 1 ลิตร',
    items: [pkg('PKGI_BOTTLE_PET_1L')],
  },
];

// -------------------------------------------------------------- modifiers
// Sweetness is three PREP modifiers per drink — less, much less, no added
// sugar — each setting the syrup by role. Normal is the BOM itself, so the
// standard sale never touches them (CLAUDE.md §0). Drinks that pour a
// different number of pumps at the same level get their own row with the same
// name; a line can only carry one of them (src/db/cart-repo.ts).

const ICED_DRINKS_3_PUMPS = [
  'VAR_PASSION_ICED',
  'VAR_GRAPE_ICED',
  'VAR_CALAMANSI_ICED',
  'VAR_CHRYS_ICED',
  'VAR_PLAIN_BLACK',
  'VAR_PLAIN_JASMINE',
  'VAR_PLAIN_WHITE',
  'VAR_ORANGE_MINT_ICED',
  'VAR_PINEAPPLE_GINGER_ICED',
  'VAR_RASPBERRY_ICED',
  'VAR_PEACH_OOLONG_ICED',
  'VAR_STRAWBERRY_ROSELLE_ICED',
  'VAR_BLUEBERRY_PEA_ICED',
];
/** Every drink where no added sugar is offered (not M2, M3, M5, M14). */
const NO_SUGAR_OK = [
  'VAR_PEAR_ICED',
  'VAR_GRAPE_ICED',
  'VAR_CALAMANSI_ICED',
  'VAR_CHRYS_ICED',
  'VAR_PLAIN_BLACK',
  'VAR_PLAIN_JASMINE',
  'VAR_PLAIN_WHITE',
  'VAR_ORANGE_MINT_ICED',
  'VAR_PINEAPPLE_GINGER_ICED',
  'VAR_RASPBERRY_ICED',
  'VAR_PEACH_OOLONG_ICED',
  'VAR_BLUEBERRY_PEA_ICED',
];

const modifierBase = {
  ...unsynced,
  price_delta: 0,
  is_paid: false,
  kind: 'PREP',
  component_id: null,
  cost_delta: 0,
  removes_packaging_item_id: null,
  adjusts_component_role: null,
  adjust_qty_per_cup: null,
  advisory_th: null,
} as const;

const sweetness = (
  id: string,
  name_th: string,
  role: ComponentRole,
  qty: number,
  variants: string[],
  sort_order: number,
  more: Partial<Modifier> = {},
): Modifier => ({
  ...modifierBase,
  id,
  name_th,
  applies_to_variant_ids: variants,
  qty_per_cup: qty,
  overrides_component_role: role,
  sort_order,
  ...more,
});

const LESS = 'หวานน้อย';
const MUCH_LESS = 'หวานน้อยมาก';
const NO_SUGAR = 'ไม่เติมน้ำตาล';

export const MODIFIERS: Modifier[] = [
  sweetness('PREP_LESS_SWEET', LESS, 'SWEETENER', 2 * PUMP, ICED_DRINKS_3_PUMPS, 1),
  sweetness(
    'PREP_LESS_SWEET_1_PUMP',
    LESS,
    'SWEETENER',
    1 * PUMP,
    ['VAR_PEAR_ICED', 'VAR_LYCHEE_ICED'],
    2,
  ),
  // M2: fewer pumps of longan concentrate, the difference made up in white
  // tea on the bottom pour (60 → 70 → 80 ml).
  sweetness('PREP_LESS_SWEET_LONGAN', LESS, 'CONCENTRATE', 3 * PUMP, ['VAR_LONGAN_ICED'], 3, {
    adjusts_component_role: 'TEA_BASE',
    adjust_qty_per_cup: 10,
  }),
  sweetness(
    'PREP_MUCH_LESS_SWEET',
    MUCH_LESS,
    'SWEETENER',
    1 * PUMP,
    ['VAR_PEAR_ICED', ...ICED_DRINKS_3_PUMPS],
    4,
  ),
  sweetness('PREP_MUCH_LESS_SWEET_NONE', MUCH_LESS, 'SWEETENER', 0, ['VAR_LYCHEE_ICED'], 5),
  sweetness(
    'PREP_MUCH_LESS_SWEET_LONGAN',
    MUCH_LESS,
    'CONCENTRATE',
    2 * PUMP,
    ['VAR_LONGAN_ICED'],
    6,
    { adjusts_component_role: 'TEA_BASE', adjust_qty_per_cup: 20 },
  ),
  sweetness('PREP_NO_SUGAR', NO_SUGAR, 'SWEETENER', 0, NO_SUGAR_OK, 7),
  {
    // 1 bottle, after the base and before the ice. Takes 3 pumps of syrup out
    // of whatever sweetness was asked for, never below none.
    ...modifierBase,
    id: 'MOD_YAKULT',
    name_th: 'ยาคูลท์',
    price_delta: toSatang(15),
    is_paid: true,
    kind: 'PAID',
    applies_to_variant_ids: [
      'VAR_CALAMANSI_ICED',
      'VAR_PASSION_ICED',
      'VAR_GRAPE_ICED',
      'VAR_LYCHEE_ICED',
    ],
    component_id: 'COMP_YAKULT',
    qty_per_cup: 1,
    overrides_component_role: null,
    adjusts_component_role: 'SWEETENER',
    adjust_qty_per_cup: -3 * PUMP,
    sort_order: 8,
  },
  {
    // Plain jasmine with Yakult keeps one pump at normal and none below it.
    ...modifierBase,
    id: 'MOD_YAKULT_JASMINE',
    name_th: 'ยาคูลท์',
    price_delta: toSatang(15),
    is_paid: true,
    kind: 'PAID',
    applies_to_variant_ids: ['VAR_PLAIN_JASMINE'],
    component_id: 'COMP_YAKULT',
    qty_per_cup: 1,
    overrides_component_role: null,
    adjusts_component_role: 'SWEETENER',
    adjust_qty_per_cup: -2 * PUMP,
    sort_order: 9,
  },
];

// ---------------------------------------------------------- purchase items
// The raw ingredients, as bought: what a purchase order is made of. Not
// stock — components enter stock only as production batches (CLAUDE.md
// §6.5, §11). Prices are per buying unit and pre-fill the next order; null
// where the master file has none yet.

const buy = (id: string, name_th: string, unit: string, baht: number | null): PurchaseItem => ({
  ...unsynced,
  id,
  name_th,
  unit,
  pack_size: null,
  packaging_item_id: null,
  default_supplier_id: null,
  last_unit_cost: baht === null ? null : toSatang(baht),
  is_active: true,
});

const KG = 'กก.';

export const PURCHASE_ITEMS: PurchaseItem[] = [
  // Teas and dried flowers
  buy('PI_TEA_BLACK', 'ใบชาแดง', KG, 400),
  buy('PI_TEA_WHITE', 'ใบชาขาว', KG, 1200),
  buy('PI_TEA_JASMINE', 'ใบชาเขียวมะลิ', KG, 500),
  buy('PI_TEA_OOLONG', 'ใบชาอูหลง', KG, 1000),
  buy('PI_BUTTERFLY_PEA', 'ดอกอัญชันแห้ง', KG, 400),
  buy('PI_CHRYSANTHEMUM', 'ดอกเก๊กฮวยแห้ง', KG, null),
  buy('PI_ROSELLE', 'กระเจี๊ยบแห้ง', KG, 300),
  buy('PI_OSMANTHUS', 'ดอกกุ้ยฮวาแห้ง', KG, null),
  buy('PI_ROSE', 'ดอกกุหลาบแห้ง', KG, null),
  // Sweeteners, seasoning, other dry goods
  buy('PI_ROCK_SUGAR', 'น้ำตาลกรวด', KG, null),
  buy('PI_BROWN_SUGAR', 'น้ำตาลทรายแดง', KG, null),
  buy('PI_CANE_SUGAR', 'น้ำตาลอ้อยก้อน', KG, null),
  buy('PI_HONEY', 'น้ำผึ้ง', KG, null),
  buy('PI_SEA_SALT', 'เกลือทะเล', KG, null),
  buy('PI_AGAR', 'ผงวุ้น', KG, null),
  buy('PI_WATER', 'น้ำดื่ม', 'ลิตร', null),
  // Fruit and produce
  buy('PI_ASIAN_PEAR', 'สาลี่', KG, null),
  buy('PI_JUJUBE', 'พุทราจีนแห้ง', KG, null),
  buy('PI_GOJI', 'เก๋ากี้', KG, null),
  buy('PI_LONGAN', 'ลำไยอบแห้ง', KG, null),
  buy('PI_GINGER_SHREDDED', 'ขิงฝอย', KG, null),
  buy('PI_GINGER_FRESH', 'ขิงแก่สด', KG, 60),
  buy('PI_PASSION_FRUIT', 'เสาวรส', 'ลูก', null),
  buy('PI_CALAMANSI', 'ส้มจี๊ด', KG, 60),
  buy('PI_LIME_JUICE', 'น้ำมะนาว', 'ลิตร', null),
  buy('PI_GRAPE', 'องุ่นแดง/ดำไร้เมล็ด', KG, null),
  buy('PI_LYCHEE_CAN', 'ลิ้นจี่ในน้ำเชื่อม', 'กระป๋อง', null),
  buy('PI_ORANGE', 'ส้มสายน้ำผึ้ง', KG, 70),
  buy('PI_LEMON', 'เลมอน', 'ลูก', 15),
  buy('PI_PINEAPPLE', 'สับปะรด', KG, 25),
  buy('PI_LEMONGRASS', 'ตะไคร้', KG, 40),
  buy('PI_MINT', 'มิ้นต์', KG, 200),
  buy('PI_PEACH', 'พีช', KG, 130),
  buy('PI_RASPBERRY', 'ราสเบอร์รีแช่แข็ง', KG, 350),
  buy('PI_STRAWBERRY', 'สตรอว์เบอร์รีแช่แข็ง', KG, 150),
  buy('PI_BLUEBERRY', 'บลูเบอร์รีแช่แข็ง', KG, 300),
  buy('PI_YAKULT', 'ยาคูลท์', 'ขวด', null),
];

// --------------------------------------------------------------- settings
// Money values are satang, quick_tender included, so nothing downstream has to
// remember which settings are baht and which are satang.

export const SETTINGS: Setting[] = [
  { key: 'opening_float', value: toSatang(1500), synced_at: null },
  { key: 'fixed_cost_per_day', value: toSatang(370), synced_at: null },
  { key: 'breakeven_cups', value: 10, synced_at: null },
  { key: 'quick_tender', value: [40, 50, 59, 100, 500, 1000].map(toSatang), synced_at: null },
  { key: 'promo_two_cup_enabled', value: true, synced_at: null },
  { key: 'promo_two_cup_amount', value: toSatang(10), synced_at: null },
  { key: 'promo_rainy_day_enabled', value: false, synced_at: null },
  { key: 'promo_rainy_day_amount', value: toSatang(5), synced_at: null },
  // Which drink the rainy-day price applies to. A setting, not a constant, so
  // a drink can take it without a code change. None on the current menu: it
  // was hot pear, and there is no hot drink now.
  { key: 'promo_rainy_day_variant_id', value: null, synced_at: null },
  { key: 'loyalty_stamps_required', value: 10, synced_at: null },
  { key: 'vat_registered', value: false, synced_at: null },
  { key: 'annual_revenue_warn_threshold', value: toSatang(1_800_000), synced_at: null },
  // Warn from three-quarters of the way to the VAT threshold: registering is
  // a compliance event with lead time, not something to learn about on the day.
  { key: 'annual_revenue_warn_ratio', value: 0.75, synced_at: null },
  { key: 'branding_line_th', value: 'ชาต้มเอง วันต่อวัน', synced_at: null },
  { key: 'promptpay_qr_image', value: null, synced_at: null },
  { key: 'operators', value: ['เจ้าของ'], synced_at: null },
  // Offered as one-tap choices when voiding. Editable: the shop knows better
  // than the code why bills actually get cancelled.
  {
    key: 'void_reasons',
    value: ['ลูกค้าเปลี่ยนใจ', 'กดผิด', 'ทำหก', 'ชำระเงินผิดวิธี'],
    synced_at: null,
  },
];
