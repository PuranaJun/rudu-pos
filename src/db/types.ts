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
export type Temp = 'ICED' | 'HOT';
export type Lifecycle = 'SIMPLE' | 'STEEP' | 'SOAK_BLANCH' | 'SLAB_CUT';
export type ModifierKind = 'PAID' | 'PREP';
export type PaymentMethod = 'CASH' | 'PROMPTPAY';

export type BatchState =
  'STEEPING' | 'SOAKING' | 'BLANCHED' | 'SLAB' | 'CUT' | 'READY' | 'EXPIRED' | 'DISCARDED';

/** The states a batch can be sold from (CLAUDE.md §2.3). A SLAB is not one. */
export const SELLABLE_STATES: readonly BatchState[] = ['BLANCHED', 'CUT', 'READY'];

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
  /** Mandatory whenever line_discount is non-zero or unit_price is 0. */
  discount_reason: DiscountReason | null;
  unit_cost: Satang;
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
