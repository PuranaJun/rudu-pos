import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB, asRemoteWrites } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { seedLegacyCatalog } from './legacy-catalog.ts';
import { markDeletedRecipeLines } from './seed.ts';
import {
  CatalogError,
  createPackagingItem,
  removeBomRow,
  removeComponent,
  removePackagingItem,
  removeProduct,
  restoreComponent,
  restorePackagingItem,
  restoreProduct,
} from './catalog-repo.ts';

let db: RuduPosDB;
let dbName: string;
const AT = '2026-10-15T10:00:00.000Z';

beforeEach(async () => {
  dbName = `rudu-removal-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await seedLegacyCatalog(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

describe('removing a recipe line', () => {
  it('keeps the row, marked, so the next send tells the cloud', async () => {
    const [line] = await db.bom.where('variant_id').equals('VAR_TAMARIND_ICED').toArray();
    // As if sent already: the way sync itself clears the flag.
    await asRemoteWrites(() => db.table('bom').update(line!.id, { sync_dirty: undefined }));
    expect((await db.bom.get(line!.id))?.sync_dirty).toBeUndefined();

    await removeBomRow(line!.id, db, AT);

    const row = await db.bom.get(line!.id);
    expect(row?.removed_at).toBe(AT);
    expect(row?.sync_dirty).toBe(1);
    const catalog = await loadCostCatalog(db);
    expect(catalog.bomByVariant.get('VAR_TAMARIND_ICED')!.map((r) => r.id)).not.toContain(line!.id);
  });
});

describe('removing a drink', () => {
  it('takes it off and brings it back switched off', async () => {
    await removeProduct('DRINK_PEAR', db, AT);
    expect(await db.product.get('DRINK_PEAR')).toMatchObject({ removed_at: AT, is_active: false });
    // Its sales still name it: the row is there.
    expect((await loadCostCatalog(db)).products.get('DRINK_PEAR')?.name_short_th).toBeTruthy();

    await restoreProduct('DRINK_PEAR', db);
    expect(await db.product.get('DRINK_PEAR')).toMatchObject({
      removed_at: null,
      is_active: false,
    });
  });
});

describe('removing a component', () => {
  it('is refused while a recipe uses it, and leaves it untouched', async () => {
    await expect(removeComponent('COMP_CONC_TAMARIND', db, AT)).rejects.toBeInstanceOf(
      CatalogError,
    );
    expect((await db.component.get('COMP_CONC_TAMARIND'))?.removed_at).toBeUndefined();
  });

  it('goes once its recipe lines are out, and comes back', async () => {
    const lines = await db.bom.where('component_id').equals('COMP_CONC_TAMARIND').toArray();
    for (const line of lines) await removeBomRow(line.id, db, AT);

    await removeComponent('COMP_CONC_TAMARIND', db, AT);
    expect(await db.component.get('COMP_CONC_TAMARIND')).toMatchObject({
      removed_at: AT,
      is_active: false,
    });

    await restoreComponent('COMP_CONC_TAMARIND', db);
    expect((await db.component.get('COMP_CONC_TAMARIND'))?.removed_at).toBeNull();
  });
});

describe('removing a packaging item', () => {
  it('is refused while a set uses it', async () => {
    await expect(removePackagingItem('PKGI_LID', db, AT)).rejects.toThrow(/อยู่ในชุด/);
  });

  it('is refused while something bought fills it', async () => {
    const item = await createPackagingItem('ถุงหิ้ว 2 ใบ', 50, db);
    await db.purchase_item.add({
      id: 'PI_BAGS',
      name_th: 'ถุงหิ้ว (แพ็ค 100)',
      unit: 'แพ็ค',
      pack_size: 100,
      packaging_item_id: item.id,
      default_supplier_id: null,
      last_unit_cost: null,
      is_active: true,
      synced_at: null,
    });
    await expect(removePackagingItem(item.id, db, AT)).rejects.toThrow(/ถุงหิ้ว \(แพ็ค 100\)/);
  });

  it('goes when nothing uses it, and comes back', async () => {
    const item = await createPackagingItem('ช้อนยาว', 50, db);
    await removePackagingItem(item.id, db, AT);
    expect((await db.packaging_item.get(item.id))?.removed_at).toBe(AT);
    await restorePackagingItem(item.id, db);
    expect((await db.packaging_item.get(item.id))?.removed_at).toBeNull();
  });
});

describe('markDeletedRecipeLines', () => {
  it('writes back a seeded line deleted the old way, marked removed', async () => {
    const [line] = await db.bom.where('variant_id').equals('VAR_PEAR_ICED').toArray();
    await db.bom.delete(line!.id);
    const untouched = (await db.bom.toArray()).map((row) => ({ ...row }));

    const written = await markDeletedRecipeLines(db, AT);

    expect(written).toBeGreaterThan(0);
    expect(await db.bom.get(line!.id)).toMatchObject({ removed_at: AT, sync_dirty: 1 });
    for (const row of untouched) expect(await db.bom.get(row.id)).toEqual(row);
    // Nothing comes back into a recipe.
    const catalog = await loadCostCatalog(db);
    expect(catalog.bomByVariant.get('VAR_PEAR_ICED')!.map((r) => r.id)).not.toContain(line!.id);
  });

  it('writes nothing the second time', async () => {
    await markDeletedRecipeLines(db, AT);
    expect(await markDeletedRecipeLines(db, AT)).toBe(0);
  });
});
