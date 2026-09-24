/**
 * Writing the catalog: everything the settings screen can change.
 *
 * Every edit is effective forward only (CLAUDE.md §2.1.8). That holds by
 * construction rather than by care here: a sale line carries its own
 * unit_price and unit_cost, a waste event its own cost, and nothing that
 * reports on the past reads a price or a cost back out of the catalog.
 *
 * Nothing is deleted that history points at. A product or variant is switched
 * off, not removed; a component stays; a BOM row or a packaging line — which
 * no sale refers to — can go.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import type {
  Bom,
  Component,
  Modifier,
  PackagingItem,
  PackagingSet,
  Product,
  ProductKind,
  SettingValue,
  Variant,
} from './types.ts';
import {
  checkBomRow,
  checkComponent,
  checkModifier,
  checkProduct,
  checkVariant,
} from '../domain/catalog-rules.ts';
import type { Satang } from '../lib/money.ts';
import { newId } from '../lib/id.ts';

/** An edit the rules refused, with the reasons in Thai for the screen. */
export class CatalogError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(problems.join(' · '));
    this.name = 'CatalogError';
    this.problems = problems;
  }
}

function refuse(problems: string[]): void {
  if (problems.length > 0) throw new CatalogError(problems);
}

async function nextSortOrder(rows: { sort_order: number }[]): Promise<number> {
  return rows.reduce((max, row) => Math.max(max, row.sort_order), 0) + 1;
}

// ---------------------------------------------------------------- products

export async function saveProduct(product: Product, db: RuduPosDB = defaultDb): Promise<void> {
  refuse(checkProduct(product));
  await db.product.put(product);
}

export interface NewProduct {
  name_short_th: string;
  name_full_th: string;
  base_price: Satang;
  kind: ProductKind;
  packaging_set_id: string;
}

/**
 * A new menu item, with the one variant every product needs to be sold. The
 * third drink arrives this way (CLAUDE.md §12): its recipe is then its BOM
 * rows, added on the variant.
 */
export async function createProduct(
  input: NewProduct,
  db: RuduPosDB = defaultDb,
): Promise<{ product: Product; variant: Variant }> {
  return db.transaction('rw', [db.product, db.variant], async () => {
    const product: Product = {
      id: newId(),
      name_full_th: input.name_full_th.trim() || input.name_short_th.trim(),
      name_short_th: input.name_short_th.trim(),
      name_en: '',
      base_price: input.base_price,
      kind: input.kind,
      advisory_th: null,
      is_active: true,
      sort_order: await nextSortOrder(await db.product.toArray()),
      synced_at: null,
    };
    refuse(checkProduct(product));

    const variant: Variant = {
      id: newId(),
      product_id: product.id,
      name_th: product.name_short_th,
      temp: input.kind === 'DRINK' ? 'ICED' : null,
      price_override: null,
      packaging_set_id: input.packaging_set_id,
      is_default: true,
      is_active: true,
      sort_order: 1,
      synced_at: null,
    };
    refuse(checkVariant(variant));

    await db.product.add(product);
    await db.variant.add(variant);
    return { product, variant };
  });
}

/**
 * Save a variant. Exactly one variant of a product is the default — the one a
 * tap on the menu button rings — so making this one default unmakes the rest.
 */
export async function saveVariant(variant: Variant, db: RuduPosDB = defaultDb): Promise<void> {
  refuse(checkVariant(variant));
  await db.transaction('rw', [db.variant], async () => {
    if (variant.is_default) {
      const siblings = await db.variant.where('product_id').equals(variant.product_id).toArray();
      for (const sibling of siblings) {
        if (sibling.id !== variant.id && sibling.is_default) {
          await db.variant.update(sibling.id, { is_default: false });
        }
      }
    }
    await db.variant.put(variant);
  });
}

/** Another temperature or size of an existing product, starting from its default. */
export async function createVariant(
  productId: string,
  db: RuduPosDB = defaultDb,
): Promise<Variant> {
  return db.transaction('rw', [db.product, db.variant], async () => {
    const product = await db.product.get(productId);
    if (!product) throw new Error(`product ${productId} not found`);
    const siblings = await db.variant.where('product_id').equals(productId).toArray();
    const template = siblings.find((sibling) => sibling.is_default) ?? siblings[0];

    const variant: Variant = {
      id: newId(),
      product_id: productId,
      name_th: `${product.name_short_th} (ร้อน)`,
      temp: 'HOT',
      price_override: null,
      packaging_set_id: template?.packaging_set_id ?? '',
      is_default: siblings.length === 0,
      is_active: true,
      sort_order: await nextSortOrder(siblings),
      synced_at: null,
    };
    await db.variant.add(variant);
    return variant;
  });
}

// -------------------------------------------------------------- components

export async function saveComponent(
  component: Component,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  refuse(checkComponent(component));
  await db.component.put(component);
}

/** A new component, ready to be named, costed and put into a recipe. */
export async function createComponent(
  input: Pick<Component, 'name_th' | 'unit' | 'lifecycle' | 'role'>,
  db: RuduPosDB = defaultDb,
): Promise<Component> {
  const component: Component = {
    id: newId(),
    name_th: input.name_th.trim(),
    unit: input.unit,
    default_batch_qty: 1000,
    yield_cups: null,
    shelf_life_hours: 24,
    cut_shelf_life_hours: input.lifecycle === 'SLAB_CUT' ? 24 : null,
    lead_time_hours: 0,
    cost_per_unit: 0,
    lifecycle: input.lifecycle,
    role: input.role,
    recipe_note_th: null,
    is_batch_tracked: true,
    source_component_id: null,
    source_qty_per_unit: null,
    prep_start_by: null,
    sort_order: await nextSortOrder(await db.component.toArray()),
    synced_at: null,
  };
  refuse(checkComponent(component));
  await db.component.add(component);
  return component;
}

// --------------------------------------------------------------------- BOM

/** Change how much of a component goes into one cup of a variant. */
export async function saveBomRow(row: Bom, db: RuduPosDB = defaultDb): Promise<void> {
  await db.transaction('rw', [db.bom], async () => {
    const others = await db.bom.where('variant_id').equals(row.variant_id).toArray();
    refuse(checkBomRow(row, others));
    await db.bom.put(row);
  });
}

export async function addBomRow(
  variantId: string,
  componentId: string,
  qtyPerCup: number,
  db: RuduPosDB = defaultDb,
): Promise<Bom> {
  const row: Bom = {
    id: newId(),
    variant_id: variantId,
    component_id: componentId,
    qty_per_cup: qtyPerCup,
    synced_at: null,
  };
  await saveBomRow(row, db);
  return row;
}

/** A recipe line can go: no sale points at a BOM row — each carries its own cost. */
export async function removeBomRow(id: string, db: RuduPosDB = defaultDb): Promise<void> {
  await db.bom.delete(id);
}

// --------------------------------------------------------------- packaging

export async function savePackagingItem(
  item: PackagingItem,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  if (item.name_th.trim() === '') throw new CatalogError(['ต้องมีชื่อ']);
  if (!Number.isInteger(item.unit_cost) || item.unit_cost < 0) {
    throw new CatalogError(['ต้นทุนต้องไม่ติดลบ']);
  }
  await db.packaging_item.put(item);
}

export async function createPackagingItem(
  name: string,
  unitCost: Satang,
  db: RuduPosDB = defaultDb,
): Promise<PackagingItem> {
  const item: PackagingItem = {
    id: newId(),
    name_th: name.trim(),
    unit_cost: unitCost,
    synced_at: null,
  };
  await savePackagingItem(item, db);
  return item;
}

export async function savePackagingSet(
  set: PackagingSet,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  if (set.name.trim() === '') throw new CatalogError(['ต้องมีชื่อ']);
  if (set.items.some((line) => !(line.qty > 0))) {
    throw new CatalogError(['จำนวนต้องมากกว่า 0']);
  }
  await db.packaging_set.put(set);
}

export async function createPackagingSet(
  name: string,
  db: RuduPosDB = defaultDb,
): Promise<PackagingSet> {
  const set: PackagingSet = { id: newId(), name: name.trim(), items: [], synced_at: null };
  await savePackagingSet(set, db);
  return set;
}

// --------------------------------------------------------------- modifiers

export async function saveModifier(modifier: Modifier, db: RuduPosDB = defaultDb): Promise<void> {
  refuse(checkModifier(modifier));
  await db.modifier.put(modifier);
}

export async function createModifier(name: string, db: RuduPosDB = defaultDb): Promise<Modifier> {
  const modifier: Modifier = {
    id: newId(),
    name_th: name.trim(),
    price_delta: 0,
    is_paid: true,
    kind: 'PAID',
    applies_to_variant_ids: [],
    component_id: null,
    qty_per_cup: null,
    cost_delta: 0,
    overrides_component_role: null,
    removes_packaging_item_id: null,
    advisory_th: null,
    sort_order: await nextSortOrder(await db.modifier.toArray()),
    synced_at: null,
  };
  await saveModifier(modifier, db);
  return modifier;
}

// ---------------------------------------------------------------- settings

export async function saveSetting(
  key: string,
  value: SettingValue,
  db: RuduPosDB = defaultDb,
): Promise<void> {
  await db.setting.put({ key, value, synced_at: null });
}
