/**
 * Seed data — transcribed from docs/seed-data.md.
 *
 * This file is read exactly once, on first launch. After that the database
 * owns these values and settings edits them; nothing here may be referenced
 * from business logic at runtime (docs/seed-data.md, CLAUDE.md §13).
 *
 * The recipes have not been taste-tested. Every quantity and cost below is a
 * planning estimate and is expected to change — in the database, not here.
 *
 * Catalog rows keep the stable ids from the document (`VAR_PEAR_HOT`) rather
 * than random UUIDs, because the rules name them: the rainy-day promo applies
 * to `VAR_PEAR_HOT` only. Rows created at runtime use crypto.randomUUID().
 */
import { toSatang } from '../lib/money.ts';
import type {
  Bom,
  Component,
  Modifier,
  PackagingItem,
  PackagingSet,
  Product,
  Setting,
  Variant,
} from '../db/types.ts';

/** Bump to force a reseed of a database that was seeded by an older build. */
export const SEED_VERSION = 7;
export const SEED_VERSION_KEY = 'seed_version';

const unsynced = { synced_at: null } as const;

// ---------------------------------------------------------------- products

export const PRODUCTS: Product[] = [
  {
    ...unsynced,
    id: 'DRINK_TAMARIND',
    name_full_th: 'มะขามแดง',
    name_short_th: 'มะขามแดง',
    name_en: 'Red tamarind',
    base_price: toSatang(40),
    kind: 'DRINK',
    advisory_th: null,
    is_active: true,
    sort_order: 1,
  },
  {
    ...unsynced,
    id: 'DRINK_PEAR',
    name_full_th: 'สาลี่ขาวสมุนไพรจีน',
    name_short_th: 'สาลี่ขาว',
    name_en: 'White pear, Chinese herbs',
    base_price: toSatang(59),
    kind: 'DRINK',
    advisory_th: 'มีคาเฟอีน · สตรีมีครรภ์แนะนำเลี่ยง',
    is_active: true,
    sort_order: 2,
  },
  {
    ...unsynced,
    id: 'BOTTLE_TAMARIND_1L',
    name_full_th: 'ขวดมะขามแดง 1 ลิตร',
    name_short_th: 'ขวดมะขาม 1L',
    name_en: 'Tamarind bottle 1L',
    base_price: toSatang(99),
    kind: 'BOTTLE',
    advisory_th: null,
    is_active: true,
    sort_order: 3,
  },
];

// ---------------------------------------------------------------- variants
// Hot and iced pear are the same price but a different BOM and different
// packaging: separately reportable, one menu button.

export const VARIANTS: Variant[] = [
  {
    ...unsynced,
    id: 'VAR_TAMARIND_ICED',
    product_id: 'DRINK_TAMARIND',
    name_th: 'มะขามแดง',
    temp: 'ICED',
    price_override: null,
    packaging_set_id: 'PKG_ICED_STRAW',
    is_default: true,
    is_active: true,
    sort_order: 1,
  },
  {
    ...unsynced,
    id: 'VAR_PEAR_ICED',
    product_id: 'DRINK_PEAR',
    name_th: 'สาลี่ขาว (เย็น)',
    temp: 'ICED',
    price_override: null,
    packaging_set_id: 'PKG_ICED_STRAW_SPOON',
    is_default: true,
    is_active: true,
    sort_order: 1,
  },
  {
    ...unsynced,
    id: 'VAR_PEAR_HOT',
    product_id: 'DRINK_PEAR',
    name_th: 'สาลี่ขาว (ร้อน)',
    temp: 'HOT',
    price_override: null,
    packaging_set_id: 'PKG_HOT',
    is_default: false,
    is_active: true,
    sort_order: 2,
  },
  {
    ...unsynced,
    id: 'VAR_BOTTLE_TAMARIND',
    product_id: 'BOTTLE_TAMARIND_1L',
    name_th: 'ขวดมะขาม 1L',
    temp: null,
    price_override: null,
    packaging_set_id: 'PKG_BOTTLE',
    is_default: true,
    is_active: true,
    sort_order: 1,
  },
];

// -------------------------------------------------------------- components
// `shelf_life_hours: 24` is how "same day" is stored. Close-day treats
// anything at or under 24 h as a same-day component that defaults to discard.

/** Made from raw ingredients, with no prep reminder. Overridden per row below. */
const fromScratch = {
  source_component_id: null,
  source_qty_per_unit: null,
  prep_start_by: null,
} as const;

export const COMPONENTS: Component[] = [
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_TEA_RED',
    name_th: 'ชาแดงสกัดเย็น 2x',
    unit: 'ML',
    default_batch_qty: 5000,
    yield_cups: 40,
    shelf_life_hours: 72,
    cut_shelf_life_hours: null,
    lead_time_hours: 10,
    cost_per_unit: 0.004,
    lifecycle: 'STEEP',
    role: 'TEA_BASE',
    recipe_note_th:
      'ชาแดง 50 g ในถุงกรอง + น้ำดื่ม 5.25 L · แช่ตู้เย็น ≤4°C 10 ชม. · ยกถุงขึ้น บีบเบา ๆ ครั้งเดียว',
    is_batch_tracked: true,
    sort_order: 1,
    prep_start_by: '21:00',
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_TEA_WHITE',
    name_th: 'ชาขาวสกัดเย็น 2x',
    unit: 'ML',
    default_batch_qty: 4000,
    yield_cups: 40,
    shelf_life_hours: 72,
    cut_shelf_life_hours: null,
    lead_time_hours: 13,
    cost_per_unit: 0.0078,
    lifecycle: 'STEEP',
    role: 'TEA_BASE',
    recipe_note_th: 'ชาขาวโซ่วเหมย 52 g + น้ำดื่ม 4.3 L · แช่ ≤4°C 12–14 ชม.',
    is_batch_tracked: true,
    sort_order: 2,
    prep_start_by: '19:00',
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_CONC_TAMARIND',
    name_th: 'หัวเชื้อมะขาม',
    unit: 'ML',
    default_batch_qty: 3000,
    yield_cups: 60,
    shelf_life_hours: 168,
    cut_shelf_life_hours: null,
    lead_time_hours: 0,
    cost_per_unit: 0.0482,
    lifecycle: 'SIMPLE',
    role: 'CONCENTRATE',
    recipe_note_th:
      'มะขามเปียก 720 g · น้ำตาลกรวด 1,350 g · น้ำตาลมะพร้าว 225 g · เกลือ 38 g · แช่มะขามในน้ำร้อน 1.2 L ขยำ กรอง 3 ครั้ง ละลายน้ำตาล เติมให้ครบ 3.0 L แช่เย็นเร็ว',
    is_batch_tracked: true,
    sort_order: 3,
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_CONC_PEAR',
    name_th: 'หัวเชื้อสาลี่พุทราจีน',
    unit: 'ML',
    default_batch_qty: 3000,
    yield_cups: 60,
    shelf_life_hours: 168,
    cut_shelf_life_hours: null,
    lead_time_hours: 0,
    cost_per_unit: 0.0954,
    lifecycle: 'SIMPLE',
    role: 'CONCENTRATE',
    recipe_note_th:
      'สาลี่ 3.24 kg (ต้มแล้วทิ้ง) · พุทราจีนแห้ง 105 g · เก๋ากี้ 38 g · น้ำตาลกรวด 645 g · เกลือ 8 g · ต้ม 95–97°C 15 นาที ยกตะกร้าทิ้ง เติมให้ครบ 3.0 L',
    is_batch_tracked: true,
    sort_order: 4,
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_JELLY_CHRYS',
    name_th: 'เยลลี่เก๊กฮวย',
    unit: 'G',
    default_batch_qty: 1000,
    yield_cups: 33,
    shelf_life_hours: 72,
    cut_shelf_life_hours: 24,
    lead_time_hours: 40 / 60,
    cost_per_unit: 0.0136667,
    lifecycle: 'SLAB_CUT',
    role: 'SOLID',
    recipe_note_th:
      'เก๊กฮวยแห้ง 12 g · ผงวุ้น 10 g · น้ำตาลกรวด 60 g · น้ำ 1.1 L · แช่ดอกไม้นอกเตา 5 นาที กรอง พักผงวุ้น 5 นาที ต้มเดือด 2 นาทีเต็ม เทถาดหนา 1.5 cm',
    is_batch_tracked: true,
    sort_order: 5,
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_JELLY_WHITE_GOJI',
    name_th: 'เยลลี่ชาขาวฝังเก๋ากี้',
    unit: 'G',
    default_batch_qty: 1000,
    yield_cups: 33,
    shelf_life_hours: 72,
    cut_shelf_life_hours: 24,
    lead_time_hours: 40 / 60,
    cost_per_unit: 0.0226667,
    lifecycle: 'SLAB_CUT',
    role: 'SOLID',
    recipe_note_th:
      'ใช้ชาขาว 500 ml · น้ำ 500 ml · ผงวุ้น 10 g · น้ำตาลกรวด 70 g · เก๋ากี้แช่ 40 g · ต้มวุ้นในน้ำเปล่าเท่านั้น ลด 60°C ใส่ชาเย็น ลด 50°C ใส่เก๋ากี้ เทถาดทันที',
    is_batch_tracked: true,
    sort_order: 6,
    // ใช้ชาขาว 500 ml per 1,000 g slab (docs/seed-data.md §2).
    source_component_id: 'COMP_TEA_WHITE',
    source_qty_per_unit: 0.5,
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_PEAR_FRESH',
    name_th: 'กอง B สาลี่สด',
    unit: 'G',
    default_batch_qty: 420,
    yield_cups: 20,
    shelf_life_hours: 24,
    cut_shelf_life_hours: null,
    lead_time_hours: 0,
    cost_per_unit: 0.07,
    lifecycle: 'SIMPLE',
    role: 'SOLID',
    recipe_note_th: 'หั่นเช้าวันขาย ห้ามค้างคืน',
    is_batch_tracked: true,
    sort_order: 7,
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_PEACH_GUM',
    name_th: 'ยางพีช',
    unit: 'G',
    default_batch_qty: 350,
    yield_cups: 17,
    shelf_life_hours: 72,
    cut_shelf_life_hours: null,
    lead_time_hours: 11,
    cost_per_unit: 0.04,
    lifecycle: 'SOAK_BLANCH',
    role: 'SOLID',
    recipe_note_th:
      'แช่ 10–12 ชม. ≤4°C → เขี่ยเปลือกไม้ออก → ล้าง → ลวก 3 นาที → แช่น้ำแข็ง → เก็บจมน้ำ เปลี่ยนน้ำทุกวัน',
    is_batch_tracked: true,
    sort_order: 8,
  },
  {
    ...unsynced,
    ...fromScratch,
    id: 'COMP_BASIL_SEED',
    name_th: 'เม็ดแมงลักพอง',
    unit: 'G',
    default_batch_qty: 250,
    yield_cups: 7,
    shelf_life_hours: 24,
    cut_shelf_life_hours: null,
    lead_time_hours: 0,
    cost_per_unit: 0.0214286,
    lifecycle: 'SIMPLE',
    role: 'SOLID',
    recipe_note_th: 'แช่พองเช้าวันขาย',
    is_batch_tracked: true,
    sort_order: 9,
  },
  {
    // Not batch tracked, but it carries a real per-cup cost (0.03 on pear
    // variants) that the margin table in docs/seed-data.md §6.3 depends on.
    ...unsynced,
    ...fromScratch,
    id: 'COMP_CHRYS_GARNISH',
    name_th: 'เก๊กฮวยแห้งโรยหน้า',
    unit: 'PC',
    default_batch_qty: null,
    yield_cups: null,
    shelf_life_hours: null,
    cut_shelf_life_hours: null,
    lead_time_hours: 0,
    cost_per_unit: 0.03,
    lifecycle: 'SIMPLE',
    role: 'GARNISH',
    recipe_note_th: null,
    is_batch_tracked: false,
    sort_order: 10,
  },
];

// -------------------------------------------------------------------- BOM
// Variant level. Hot pear omits the jelly (agar melts at ~85 °C) and always
// includes peach gum instead — the invariant most likely to be lost.

const bom = (variant_id: string, component_id: string, qty_per_cup: number): Bom => ({
  ...unsynced,
  id: `BOM_${variant_id}_${component_id}`,
  variant_id,
  component_id,
  qty_per_cup,
});

export const BOM_ROWS: Bom[] = [
  bom('VAR_TAMARIND_ICED', 'COMP_TEA_RED', 125),
  bom('VAR_TAMARIND_ICED', 'COMP_CONC_TAMARIND', 50),
  bom('VAR_TAMARIND_ICED', 'COMP_JELLY_CHRYS', 30),

  bom('VAR_PEAR_ICED', 'COMP_TEA_WHITE', 100),
  bom('VAR_PEAR_ICED', 'COMP_CONC_PEAR', 50),
  bom('VAR_PEAR_ICED', 'COMP_JELLY_WHITE_GOJI', 30),
  bom('VAR_PEAR_ICED', 'COMP_PEAR_FRESH', 21),
  bom('VAR_PEAR_ICED', 'COMP_CHRYS_GARNISH', 1),

  bom('VAR_PEAR_HOT', 'COMP_TEA_WHITE', 100),
  bom('VAR_PEAR_HOT', 'COMP_CONC_PEAR', 50),
  bom('VAR_PEAR_HOT', 'COMP_PEAR_FRESH', 21),
  bom('VAR_PEAR_HOT', 'COMP_PEACH_GUM', 20),
  bom('VAR_PEAR_HOT', 'COMP_CHRYS_GARNISH', 1),

  bom('VAR_BOTTLE_TAMARIND', 'COMP_TEA_RED', 417),
  bom('VAR_BOTTLE_TAMARIND', 'COMP_CONC_TAMARIND', 167),
];

// -------------------------------------------------------------- packaging

export const PACKAGING_ITEMS: PackagingItem[] = [
  {
    ...unsynced,
    id: 'PKGI_CUP_PLASTIC_16OZ',
    name_th: 'แก้วพลาสติก 16 oz',
    unit_cost: toSatang(1.18),
  },
  { ...unsynced, id: 'PKGI_CUP_PAPER_HOT', name_th: 'แก้วกระดาษร้อน', unit_cost: toSatang(1.5) },
  { ...unsynced, id: 'PKGI_LID', name_th: 'ฝา', unit_cost: toSatang(0.59) },
  { ...unsynced, id: 'PKGI_STRAW_NORMAL', name_th: 'หลอดปกติ', unit_cost: toSatang(0.14) },
  { ...unsynced, id: 'PKGI_STRAW_WIDE', name_th: 'หลอดใหญ่', unit_cost: toSatang(0.25) },
  { ...unsynced, id: 'PKGI_SPOON', name_th: 'ช้อน', unit_cost: toSatang(0.35) },
  { ...unsynced, id: 'PKGI_CARRY_BAG', name_th: 'ถุงหิ้ว', unit_cost: toSatang(0.2) },
  { ...unsynced, id: 'PKGI_ICE', name_th: 'น้ำแข็ง', unit_cost: toSatang(1.0) },
  { ...unsynced, id: 'PKGI_LOGO_STICKER', name_th: 'สติกเกอร์โลโก้', unit_cost: toSatang(0.3) },
  { ...unsynced, id: 'PKGI_BOTTLE_PET_1L', name_th: 'ขวด PET 1 ลิตร', unit_cost: toSatang(7.0) },
];

const pkg = (packaging_item_id: string, qty = 1) => ({ packaging_item_id, qty });

// The carry bag is inside every set. That is why PREP_TAKEAWAY_BAG costs 0 —
// otherwise the bag is counted twice.
export const PACKAGING_SETS: PackagingSet[] = [
  {
    ...unsynced,
    id: 'PKG_ICED_STRAW',
    name: 'แก้วเย็น + หลอด',
    items: [
      pkg('PKGI_CUP_PLASTIC_16OZ'),
      pkg('PKGI_LID'),
      pkg('PKGI_STRAW_WIDE'),
      pkg('PKGI_ICE'),
      pkg('PKGI_LOGO_STICKER'),
      pkg('PKGI_CARRY_BAG'),
    ],
  },
  {
    ...unsynced,
    id: 'PKG_ICED_STRAW_SPOON',
    name: 'แก้วเย็น + หลอด + ช้อน',
    items: [
      pkg('PKGI_CUP_PLASTIC_16OZ'),
      pkg('PKGI_LID'),
      pkg('PKGI_STRAW_WIDE'),
      pkg('PKGI_SPOON'),
      pkg('PKGI_ICE'),
      pkg('PKGI_LOGO_STICKER'),
      pkg('PKGI_CARRY_BAG'),
    ],
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
// A modifier with a component_id draws its cost from that component; only a
// modifier without one (salted plum) uses cost_delta, or the cost is counted
// twice. PREP modifiers change how the drink is made, not what it sells for.

export const MODIFIERS: Modifier[] = [
  {
    ...unsynced,
    id: 'MOD_BASIL_SEED',
    name_th: 'เม็ดแมงลัก',
    price_delta: toSatang(5),
    is_paid: true,
    kind: 'PAID',
    applies_to_variant_ids: ['VAR_TAMARIND_ICED'],
    component_id: 'COMP_BASIL_SEED',
    qty_per_cup: 35,
    overrides_component_role: null,
    cost_delta: 0,
    removes_packaging_item_id: null,
    advisory_th: null,
    sort_order: 1,
  },
  {
    ...unsynced,
    id: 'MOD_SALTED_PLUM',
    name_th: 'บ๊วยเค็ม',
    price_delta: toSatang(5),
    is_paid: true,
    kind: 'PAID',
    applies_to_variant_ids: ['VAR_TAMARIND_ICED'],
    component_id: null,
    qty_per_cup: null,
    overrides_component_role: null,
    cost_delta: toSatang(1.25),
    removes_packaging_item_id: null,
    advisory_th: 'มีเมล็ด ระวังสำลัก',
    sort_order: 2,
  },
  {
    // Hidden on VAR_PEAR_HOT, which already includes peach gum in its BOM.
    ...unsynced,
    id: 'MOD_PEACH_GUM',
    name_th: 'เพิ่มวุ้นยางท้อ',
    price_delta: toSatang(10),
    is_paid: true,
    kind: 'PAID',
    applies_to_variant_ids: ['VAR_PEAR_ICED'],
    component_id: 'COMP_PEACH_GUM',
    qty_per_cup: 20,
    overrides_component_role: null,
    cost_delta: 0,
    removes_packaging_item_id: null,
    advisory_th: null,
    sort_order: 3,
  },
  {
    // Concentrate 50 → 35 ml, more dilution water. Never add plain water to a
    // finished cup. qty_per_cup is the replacement quantity, not an addition.
    ...unsynced,
    id: 'PREP_LESS_SWEET',
    name_th: 'หวานน้อย',
    price_delta: 0,
    is_paid: false,
    kind: 'PREP',
    applies_to_variant_ids: ['VAR_TAMARIND_ICED', 'VAR_PEAR_ICED', 'VAR_PEAR_HOT'],
    component_id: null,
    qty_per_cup: 35,
    overrides_component_role: 'CONCENTRATE',
    cost_delta: 0,
    removes_packaging_item_id: null,
    advisory_th: 'ลดหัวเชื้อเหลือ 35 ml เพิ่มน้ำเจือจาง',
    sort_order: 4,
  },
  {
    ...unsynced,
    id: 'PREP_NO_ICE',
    name_th: 'ไม่ใส่น้ำแข็ง',
    price_delta: 0,
    is_paid: false,
    kind: 'PREP',
    applies_to_variant_ids: ['VAR_TAMARIND_ICED', 'VAR_PEAR_ICED'],
    component_id: null,
    qty_per_cup: null,
    overrides_component_role: null,
    cost_delta: 0,
    removes_packaging_item_id: 'PKGI_ICE',
    advisory_th: null,
    sort_order: 5,
  },
  {
    // Still deducts the components by default — they were portioned for this
    // cup. The operator may mark it waste-free.
    ...unsynced,
    id: 'PREP_NO_SOLIDS',
    name_th: 'ไม่ใส่เนื้อ',
    price_delta: 0,
    is_paid: false,
    kind: 'PREP',
    applies_to_variant_ids: ['VAR_TAMARIND_ICED', 'VAR_PEAR_ICED', 'VAR_PEAR_HOT'],
    component_id: null,
    qty_per_cup: null,
    overrides_component_role: null,
    cost_delta: 0,
    removes_packaging_item_id: null,
    advisory_th: null,
    sort_order: 6,
  },
  {
    ...unsynced,
    id: 'PREP_TAKEAWAY_BAG',
    name_th: 'ใส่ถุง',
    price_delta: 0,
    is_paid: false,
    kind: 'PREP',
    applies_to_variant_ids: [
      'VAR_TAMARIND_ICED',
      'VAR_PEAR_ICED',
      'VAR_PEAR_HOT',
      'VAR_BOTTLE_TAMARIND',
    ],
    component_id: null,
    qty_per_cup: null,
    overrides_component_role: null,
    cost_delta: 0,
    removes_packaging_item_id: null,
    advisory_th: null,
    sort_order: 7,
  },
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
  // the seasonal third drink can take it without a code change.
  { key: 'promo_rainy_day_variant_id', value: 'VAR_PEAR_HOT', synced_at: null },
  { key: 'loyalty_stamps_required', value: 10, synced_at: null },
  { key: 'vat_registered', value: false, synced_at: null },
  { key: 'annual_revenue_warn_threshold', value: toSatang(1_800_000), synced_at: null },
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
