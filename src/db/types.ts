/**
 * Row types for every table in CLAUDE.md §8.
 *
 * Conventions that hold for every table:
 * - `id` is a client-generated string. Catalog rows seeded from
 *   docs/seed-data.md keep their stable documented ids (`VAR_PEAR_HOT`);
 *   everything created at runtime uses `crypto.randomUUID()`.
 * - `synced_at` is nullable and unused in v1 — there is no server yet.
 * - Timestamps are ISO-8601 UTC strings.
 * - Money is an integer number of satang. Component costs are the one
 *   exception: a float in THB per ml / per g, so BOM edits cannot corrupt
 *   historical costs (CLAUDE.md §3).
 */
import type { Satang } from '../lib/money.ts';

export type Unit = 'ML' | 'G' | 'PC';
/**
 * A cup or a bottle. Not cosmetic: bottles are excluded from PROMO_TWO_CUP
 * (CLAUDE.md §4), and nothing else on the row distinguishes them.
 */
export type ProductKind = 'DRINK' | 'BOTTLE';
export type Temp = 'ICED' | 'HOT';
export type Lifecycle = 'SIMPLE' | 'STEEP' | 'SOAK_BLANCH' | 'SLAB_CUT';
export type ModifierKind = 'PAID' | 'PREP';

/**
 * What a component does in a cup. Data, not a name convention: `PREP_LESS_SWEET`
 * has to find "the concentrate" of whichever variant it is applied to, and
 * `PREP_NO_SOLIDS` has to find the solids. Neither can be derived from an id
 * without compiling recipe knowledge into the code (CLAUDE.md §2.1.7).
 */
export type ComponentRole = 'TEA_BASE' | 'CONCENTRATE' | 'SOLID' | 'GARNISH';
export type PaymentMethod = 'CASH' | 'PROMPTPAY';

export type BatchState =
  'STEEPING' | 'SOAKING' | 'BLANCHED' | 'SLAB' | 'CUT' | 'READY' | 'EXPIRED' | 'DISCARDED';

export type StockMovementReason =
  'SALE' | 'PRODUCTION' | 'WASTE' | 'ADJUSTMENT' | 'OVERRIDE' | 'VOID_REVERSAL';

export type WasteReason = 'EXPIRED' | 'END_OF_DAY_PERISHABLE' | 'QUALITY' | 'SPILLAGE';

export type DiscountReason =
  'PROMO_TWO_CUP' | 'PROMO_RAINY_DAY' | 'LOYALTY_REDEEM' | 'STAFF_DRINK' | 'COMP_GOODWILL';

interface Synced {
  synced_at: string | null;
}

export interface Product extends Synced {
  id: string;
  /** Marketing copy. Printed A3 menu board only — never a POS button. */
  name_full_th: string;
  /** What the POS renders everywhere. Never truncated (CLAUDE.md §9). */
  name_short_th: string;
  name_en: string;
  base_price: Satang;
  kind: ProductKind;
  advisory_th: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface Variant extends Synced {
  id: string;
  product_id: string;
  name_th: string;
  /** Null for products with no temperature, such as the bottle. */
  temp: Temp | null;
  /** Null means "use the product's base_price". */
  price_override: Satang | null;
  packaging_set_id: string;
  /** The variant pre-selected when the product is tapped (pear defaults ICED). */
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface Component extends Synced {
  id: string;
  name_th: string;
  unit: Unit;
  /** Null for components that are not batch tracked. */
  default_batch_qty: number | null;
  yield_cups: number | null;
  /** Null for components that never expire on their own. */
  shelf_life_hours: number | null;
  /** Only set for SLAB_CUT components: the clock after the slab is cut. */
  cut_shelf_life_hours: number | null;
  lead_time_hours: number;
  /** THB per `unit`. A float, deliberately — never per cup (CLAUDE.md §3). */
  cost_per_unit: number;
  lifecycle: Lifecycle;
  role: ComponentRole;
  recipe_note_th: string | null;
  is_batch_tracked: boolean;
  sort_order: number;
}

export interface Bom extends Synced {
  id: string;
  /** Variant level, never product level. Hot pear differs from iced pear. */
  variant_id: string;
  component_id: string;
  qty_per_cup: number;
}

export interface PackagingItem extends Synced {
  id: string;
  name_th: string;
  unit_cost: Satang;
}

export interface PackagingSetItem {
  packaging_item_id: string;
  qty: number;
}

export interface PackagingSet extends Synced {
  id: string;
  name: string;
  items: PackagingSetItem[];
}

export interface Modifier extends Synced {
  id: string;
  name_th: string;
  price_delta: Satang;
  is_paid: boolean;
  kind: ModifierKind;
  applies_to_variant_ids: string[];
  /** When set, the cost comes from the component, not from `cost_delta`. */
  component_id: string | null;
  qty_per_cup: number | null;
  /** Only used by modifiers with no component of their own (salted plum). */
  cost_delta: Satang;
  /**
   * Replaces the per-cup quantity of every BOM component with this role, using
   * `qty_per_cup` — how `PREP_LESS_SWEET` cuts the concentrate to 35 ml without
   * the engine having to know which component is the concentrate of which
   * drink, or that the modifier is called PREP_LESS_SWEET.
   */
  overrides_component_role: ComponentRole | null;
  /**
   * Drops one item from the variant's packaging set — how `PREP_NO_ICE` works.
   * Removing the item rather than subtracting a fixed amount keeps it correct
   * when the price of ice changes in settings.
   */
  removes_packaging_item_id: string | null;
  advisory_th: string | null;
  sort_order: number;
}

export interface ComponentBatch extends Synced {
  id: string;
  component_id: string;
  made_at: string;
  qty_made: number;
  state: BatchState;
  /** made_at + lead_time_hours. Before this the batch is not sellable. */
  ready_at: string;
  expires_at: string;
  /** Set when this batch was produced out of another (goji jelly ← white tea). */
  parent_batch_id: string | null;
  note: string | null;
}

export interface Sale extends Synced {
  id: string;
  created_at: string;
  /** The cash_session's date, not the UTC date (CLAUDE.md §8). */
  business_date: string;
  operator_id: string;
  total_gross: Satang;
  total_discount: Satang;
  total_net: Satang;
  total_cost: Satang;
  payment_method: PaymentMethod;
  cash_received: Satang | null;
  cash_change: Satang | null;
  is_voided: boolean;
  void_reason: string | null;
  device_id: string;
}

export interface SaleLine extends Synced {
  id: string;
  sale_id: string;
  variant_id: string;
  qty: number;
  /** Snapshot. Never recomputed from the catalog (CLAUDE.md §2.1.8). */
  unit_price: Satang;
  line_discount: Satang;
  /**
   * The reason, when exactly one applies. Null when a line carries more than
   * one — a rainy-day hot pear that is also half of a two-cup pair — in which
   * case sale_line_discount holds them all. Never null while line_discount is
   * non-zero and singular (CLAUDE.md §4).
   */
  discount_reason: DiscountReason | null;
  unit_cost: Satang;
}

/**
 * One reason's worth of discount on a line.
 *
 * §8 gives sale_line a single line_discount and a single reason, which cannot
 * express a line that is both rainy-day priced and half of a two-cup pair. The
 * money would still add up; the discounts-by-reason report would not, and
 * telling shrinkage from generosity is the whole point of recording a reason.
 */
export interface SaleLineDiscount extends Synced {
  id: string;
  sale_line_id: string;
  reason: DiscountReason;
  /** Total for the line, not per cup. */
  amount: Satang;
}

export interface SaleLineMod extends Synced {
  id: string;
  sale_line_id: string;
  modifier_id: string;
  price_delta: Satang;
  cost_delta: Satang;
}

export interface StockMovement extends Synced {
  id: string;
  /** Set for SALE and VOID_REVERSAL movements, null for everything else. */
  sale_line_id: string | null;
  component_batch_id: string;
  /** Negative consumes, positive restores. The ledger, never a counter. */
  qty_delta: number;
  reason: StockMovementReason;
  /**
   * The movement this one undoes, set on VOID_REVERSAL rows. Without the link
   * a second void re-inverts the original SALE rows and credits the stock
   * twice, which no later report could detect.
   */
  reverses_movement_id: string | null;
  /** Not in §8, but PRODUCTION and WASTE rows have no sale to date them by. */
  created_at: string;
}

export interface WasteEvent extends Synced {
  id: string;
  component_batch_id: string;
  qty_discarded: number;
  reason: WasteReason;
  recorded_at: string;
  note: string | null;
}

export interface CashSession extends Synced {
  id: string;
  opened_at: string;
  closed_at: string | null;
  operator_id: string;
  opening_float: Satang;
  expected_cash: Satang | null;
  counted_cash: Satang | null;
  variance: Satang | null;
  note: string | null;
}

export type SettingValue = string | number | boolean | number[] | string[] | null;

export interface Setting {
  key: string;
  value: SettingValue;
  synced_at: string | null;
}

/**
 * The cart, persisted the moment a line is added rather than at payment, so a
 * flat battery or a force-quit mid-service loses nothing (CLAUDE.md §1).
 * Converted to sale_line at payment and then cleared.
 */
export interface CartLine extends Synced {
  id: string;
  variant_id: string;
  qty: number;
  /** Set when the operator rang past the available stock and confirmed it. */
  sold_out_override: boolean;
  /**
   * Set by the operator to give the line away — a loyalty redemption, a staff
   * drink, goodwill. Never settable without choosing which (CLAUDE.md §4).
   */
  manual_discount_reason: DiscountReason | null;
  added_at: string;
}

export interface CartLineMod extends Synced {
  id: string;
  cart_line_id: string;
  modifier_id: string;
}
