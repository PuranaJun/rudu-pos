/**
 * Online sync end to end: a shop phone and a view-only device, each with its
 * own database, talking to the real server code over a stand-in network, with
 * the server's SQL running on SQLite. What the shop rings, the viewer sees;
 * what belongs to one phone stays on it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuduPosDB } from '../db/database.ts';
import { ensureSeeded } from '../db/seed.ts';
import { ensureDeviceId, DEVICE_ID_KEY } from '../db/device.ts';
import { loadCostCatalog } from '../db/catalog.ts';
import { loadSettings } from '../db/settings-repo.ts';
import { addDrink, loadCart } from '../db/cart-repo.ts';
import { completeSale, priceCart } from '../db/sale-repo.ts';
import { voidSale } from '../db/stock-repo.ts';
import {
  handleCheck,
  handlePull,
  handlePush,
  handleRotate,
  handleSetup,
  resetSchemaCache,
  type Env,
} from '../../server/sync.ts';
import { memoryD1 } from '../test/d1-sqlite.ts';
import { formatKey } from './key.ts';
import { exportBackup, parseBackup, restoreBackup } from '../db/backup.ts';
import {
  fetchChanges,
  joinWithKey,
  loadSyncState,
  pendingCount,
  rotateKey,
  sendChanges,
  startAsShop,
} from './sync-client.ts';

let env: Env;
let shop: RuduPosDB;
let viewer: RuduPosDB;
const names: string[] = [];

/** The network: requests to /api/sync/* answered by the server's own handlers. */
function cloud(): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'https://rudu-pos.pages.dev');
    const { signal: _signal, ...rest } = init;
    void _signal;
    const request = new Request(url, rest);
    switch (url.pathname.replace('/api/sync/', '')) {
      case 'setup':
        return handleSetup(env, request);
      case 'check':
        return handleCheck(env, request);
      case 'push':
        return handlePush(env, request);
      case 'pull':
        return handlePull(env, request);
      case 'rotate':
        return handleRotate(env, request);
      default:
        return new Response('not found', { status: 404 });
    }
  }) as typeof fetch;
}
const net = () => cloud();

async function phone(): Promise<RuduPosDB> {
  const name = `rudu-sync-${crypto.randomUUID()}`;
  names.push(name);
  const db = new RuduPosDB(name);
  await db.open();
  await ensureSeeded(db);
  await ensureDeviceId(db);
  return db;
}

beforeEach(async () => {
  resetSchemaCache();
  env = { DB: await memoryD1(), SYNC_SETUP_CODE: 'garden-tea-2569' };
  shop = await phone();
  viewer = await phone();
});

afterEach(async () => {
  for (const db of [shop, viewer]) db.close();
  for (const name of names.splice(0)) await RuduPosDB.delete(name);
});

async function ring(db: RuduPosDB): Promise<string> {
  const catalog = await loadCostCatalog(db);
  await addDrink('VAR_TAMARIND_ICED', {}, db);
  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart);
  const { saleId } = await completeSale(
    catalog,
    cart,
    priced,
    {
      method: 'CASH',
      cashReceived: priced.totalNet,
      operatorId: 'เจ้าของ',
      deviceId: 'shop',
      brandingLineTh: '',
      businessDate: '2026-10-13',
    },
    db,
  );
  return saleId;
}

async function shopKey(): Promise<string> {
  expect(await startAsShop('garden-tea-2569', shop, net())).toBe('ok');
  await sendChanges(shop, net());
  return (await loadSyncState(shop)).key!;
}

/** The read-only key the shop phone shares. */
async function viewKey(): Promise<string> {
  return (await loadSyncState(shop)).viewKey!;
}

describe('the shop phone', () => {
  it('sends everything once, then only what changes', async () => {
    await shopKey();
    expect(await pendingCount(shop)).toBe(0);

    await ring(shop);
    expect(await pendingCount(shop)).toBeGreaterThan(0);
    expect(await sendChanges(shop, net())).toBeGreaterThan(0);
    expect(await pendingCount(shop)).toBe(0);
    expect((await loadSyncState(shop)).lastSent).not.toBeNull();
  });

  it('never loses a change made while a send was in the air', async () => {
    await shopKey();
    const saleId = await ring(shop);
    let first = true;
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first) {
        first = false;
        // The sale is voided in the moment between sending and the reply.
        await shop.sale.update(saleId, { is_voided: true, void_reason: 'กดผิด' });
      }
      return net()(input, init);
    }) as typeof fetch;
    await sendChanges(shop, slow);

    // The first copy went up un-voided; the void went up after it.
    expect(await pendingCount(shop)).toBe(0);
    await joinWithKey(await viewKey(), 'VIEWER', viewer, net());
    expect((await viewer.sale.get(saleId))?.is_voided).toBe(true);
  });

  it('cannot be set up twice', async () => {
    await shopKey();
    expect(await startAsShop('garden-tea-2569', viewer, net())).toBe('exists');
  });

  it('cannot be set up without the setup password', async () => {
    expect(await startAsShop('wrong', shop, net())).toBe('wrong-setup-code');
    expect((await loadSyncState(shop)).mode).toBeNull();
    env = { DB: env.DB! };
    expect(await startAsShop('garden-tea-2569', shop, net())).toBe('no-setup-code');
  });

  it('says so, and keeps everything marked, when there is no signal', async () => {
    await shopKey();
    await ring(shop);
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await sendChanges(shop, offline)).toBe(0);
    expect(await pendingCount(shop)).toBeGreaterThan(0);
    expect((await loadSyncState(shop)).error).toBe('Failed to fetch');
  });
});

describe('a view-only device', () => {
  it('sees what the shop rang — and a void, after it happens', async () => {
    await shopKey();
    const saleId = await ring(shop);
    await sendChanges(shop, net());

    expect(await joinWithKey(formatKey(await viewKey()), 'VIEWER', viewer, net())).toBe('ok');
    expect((await viewer.sale.get(saleId))?.total_net).toBe(4_000);
    expect(await viewer.sale_line.where('sale_id').equals(saleId).count()).toBe(1);
    // Taken from the cloud, so never marked to send back.
    expect((await viewer.sale.get(saleId))?.sync_dirty).toBeUndefined();

    await voidSale(saleId, 'ลูกค้าเปลี่ยนใจ', shop);
    await sendChanges(shop, net());
    await fetchChanges(viewer, net());
    expect((await viewer.sale.get(saleId))?.is_voided).toBe(true);
  });

  it('a backup file never carries the shop key', async () => {
    const key = await shopKey();
    const file = JSON.stringify(await exportBackup(shop));
    expect(file).not.toContain(key);
    expect(file).not.toContain(await viewKey());
    // And restoring one keeps this phone syncing as it was.
    await restoreBackup(parseBackup(file, shop), shop);
    expect((await loadSyncState(shop)).key).toBe(key);
  });

  it('never gets the shop phone’s own settings, or its cart', async () => {
    await shopKey();
    await addDrink('VAR_PEAR_ICED', {}, shop);
    await sendChanges(shop, net());
    const viewerId = (await viewer.setting.get(DEVICE_ID_KEY))?.value;

    await joinWithKey(await viewKey(), 'VIEWER', viewer, net());
    expect((await viewer.setting.get(DEVICE_ID_KEY))?.value).toBe(viewerId);
    expect(await viewer.cart_line.count()).toBe(0);
    expect((await loadSyncState(viewer)).mode).toBe('VIEWER');
  });

  it('is turned away with a wrong or mistyped key', async () => {
    await shopKey();
    expect(await joinWithKey('K7QM-2XRP-H9TD-W4NC-8FJV', 'VIEWER', viewer, net())).toBe(
      'wrong-key',
    );
    expect(await joinWithKey('not a key', 'VIEWER', viewer, net())).toBe('bad-key');
  });

  it('stops seeing anything once the shop changes its key', async () => {
    await shopKey();
    await joinWithKey(await viewKey(), 'VIEWER', viewer, net());
    expect(await rotateKey(shop, net())).toBe(true);
    await ring(shop);
    await sendChanges(shop, net());

    expect(await fetchChanges(viewer, net())).toBe(0);
    expect((await loadSyncState(viewer)).error).toMatch(/401/);
  });
});

describe('a new shop phone', () => {
  it('takes everything from the cloud, then carries on sending', async () => {
    const key = await shopKey();
    const saleId = await ring(shop);
    await sendChanges(shop, net());

    expect(await joinWithKey(key, 'SHOP', viewer, net())).toBe('ok');
    expect((await viewer.sale.get(saleId))?.total_net).toBe(4_000);
    expect(await pendingCount(viewer)).toBe(0);

    await ring(viewer);
    expect(await sendChanges(viewer, net())).toBeGreaterThan(0);
  });

  it('needs the shop key — the view key only reads', async () => {
    await shopKey();
    expect(await joinWithKey(await viewKey(), 'SHOP', viewer, net())).toBe('view-key');
    expect((await loadSyncState(viewer)).mode).toBeNull();
  });

  it('gets the view key back, to share again', async () => {
    const key = await shopKey();
    await joinWithKey(key, 'SHOP', viewer, net());
    expect((await loadSyncState(viewer)).viewKey).toBe(await viewKey());
  });

  it('is refused on a phone that already has sales of its own', async () => {
    const key = await shopKey();
    await ring(viewer);
    expect(await joinWithKey(key, 'SHOP', viewer, net())).toBe('has-sales');
  });
});
