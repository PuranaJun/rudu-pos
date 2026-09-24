import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { ensureSeeded } from './seed.ts';
import { loadSettings } from './settings-repo.ts';
import { addDrink, loadCart } from './cart-repo.ts';
import { CartChangedError, completeSale, priceCart } from './sale-repo.ts';

let db: RuduPosDB;
let dbName: string;

beforeEach(async () => {
  dbName = `rudu-sale-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
});

afterEach(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

describe('a cart that moved under the tap', () => {
  it('is not rung: nothing is recorded and the cup that was added is kept', async () => {
    const catalog = await loadCostCatalog(db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);

    // What the screen drew: one tamarind, ฿40.
    const drawn = await loadCart(db);
    const priced = priceCart(catalog, await loadSettings(db), drawn);

    // The second tap landed, but the screen had not repainted.
    await addDrink('VAR_TAMARIND_ICED', {}, db);

    await expect(
      completeSale(
        catalog,
        drawn,
        priced,
        {
          method: 'CASH',
          cashReceived: priced.totalNet,
          operatorId: 'เจ้าของ',
          deviceId: 'phone',
          brandingLineTh: '',
        },
        db,
      ),
    ).rejects.toBeInstanceOf(CartChangedError);

    expect(await db.sale.count()).toBe(0);
    expect(await db.stock_movement.count()).toBe(0);
    expect((await loadCart(db))[0]?.line.qty).toBe(2);
  });

  it('is rung once the screen has caught up', async () => {
    const catalog = await loadCostCatalog(db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);
    await addDrink('VAR_TAMARIND_ICED', {}, db);

    const cart = await loadCart(db);
    const priced = priceCart(catalog, await loadSettings(db), cart);
    await completeSale(
      catalog,
      cart,
      priced,
      {
        method: 'CASH',
        cashReceived: priced.totalNet,
        operatorId: 'เจ้าของ',
        deviceId: 'phone',
        brandingLineTh: '',
      },
      db,
    );

    expect((await db.sale.toArray())[0]?.total_net).toBe(7_000);
    expect(await loadCart(db)).toHaveLength(0);
  });
});
