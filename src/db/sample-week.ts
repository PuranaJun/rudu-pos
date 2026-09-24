/**
 * A realistic week, for development only (BUILD-PROMPTS step 14).
 *
 * Five market days out of the last seven, 25–45 sales each, rung through the
 * same code the operator uses — production the evening before, the jelly cut
 * at open, sales through the cart, one void, one loyalty cup, one rainy day,
 * and close-day with its default decisions — so the reports it produces are
 * the reports a real week would. Seeded, so the same seed is the same week.
 *
 * Reached from the dev menu and nowhere else; a production build has no path
 * to it.
 */
import type { RuduPosDB } from './database.ts';
import { db as defaultDb } from './database.ts';
import { loadCostCatalog } from './catalog.ts';
import { loadSettings } from './settings-repo.ts';
import {
  addDrink,
  loadCart,
  setLineDiscountReason,
  setVariant,
  toggleModifier,
} from './cart-repo.ts';
import { completeSale, priceCart } from './sale-repo.ts';
import {
  blanchBatch,
  commitCut,
  loadStockSnapshot,
  recordProduction,
  voidSale,
} from './stock-repo.ts';
import { openSession, sessionBusinessDate } from './session-repo.ts';
import { closeDay, loadExpectedCash } from './close-repo.ts';
import { closingLines } from '../domain/close-day.ts';
import { availableCups, componentRemaining, modifierAvailable, stateAt } from '../domain/stock.ts';
import type { CostCatalog } from '../domain/cost.ts';
import { addHours, bangkokAt, bangkokDate } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import type { CashSession, Component } from './types.ts';

export interface SampleWeek {
  days: number;
  sales: number;
}

/** Days before today the market ran: five of the last seven. */
const MARKET_DAYS = [-7, -6, -4, -3, -1];
const OPEN = '16:00';
const CLOSE = '21:15';
/** Which market day (0-based) gets the void, the loyalty cup, the rain. */
const VOID_DAY = 1;
const LOYALTY_DAY = 3;
const RAINY_DAY = 2;

export async function generateSampleWeek(
  db: RuduPosDB = defaultDb,
  today: string = nowIso(),
  seed = 42,
): Promise<SampleWeek> {
  const random = mulberry32(seed);
  const todayDate = bangkokDate(today);
  let sales = 0;

  for (const [index, offset] of MARKET_DAYS.entries()) {
    const date = shiftDate(todayDate, offset);
    const eve = shiftDate(date, -1);

    await prepare(db, eve, date);
    const catalog = await loadCostCatalog(db);
    await cutJelly(db, catalog, bangkokAt(date, '15:45'));

    const session = await openSession(
      { operatorId: 'เจ้าของ', openingFloat: 150_000, rainyDay: index === RAINY_DAY },
      db,
      bangkokAt(date, '15:50'),
    );

    const count = 25 + Math.floor(random() * 21);
    const times = saleTimes(random, date, count);
    for (const [n, at] of times.entries()) {
      const loyalty = index === LOYALTY_DAY && n === 10;
      const saleId = await ringOne(db, catalog, session, at, random, index === RAINY_DAY, loyalty);
      if (!saleId) continue;
      sales += 1;
      if (index === VOID_DAY && n === 4) {
        await voidSale(saleId, 'กดผิด', db, addHours(at, 2 / 60));
      }
    }

    await close(db, catalog, session, date, index, random);
  }

  return { days: MARKET_DAYS.length, sales };
}

// ------------------------------------------------------------- production

/**
 * The evening before and the morning of: tea steeping overnight, concentrate
 * when it runs low, jelly set, pear sliced and basil soaked on the day.
 */
async function prepare(db: RuduPosDB, eve: string, date: string): Promise<void> {
  const component = async (id: string) => (await db.component.get(id)) as Component;
  const make = (id: string, qty: number, at: string, sourceBatchId: string | null = null) =>
    component(id).then((row) => recordProduction(row, { qty, madeAt: at, sourceBatchId }, db));

  const white = await make('COMP_TEA_WHITE', 4000, bangkokAt(eve, '19:00'));
  await make('COMP_TEA_RED', 5000, bangkokAt(eve, '21:00'));

  const evening = await loadStockSnapshot(db, bangkokAt(eve, '21:30'));
  for (const id of ['COMP_CONC_TAMARIND', 'COMP_CONC_PEAR']) {
    if (componentRemaining(evening, id) < 1500) await make(id, 3000, bangkokAt(eve, '20:00'));
  }
  if (componentRemaining(evening, 'COMP_PEACH_GUM') < 150) {
    const gum = await make('COMP_PEACH_GUM', 350, bangkokAt(eve, '20:00'));
    await blanchBatch(gum.id, db, bangkokAt(date, '08:00'));
  }

  await make('COMP_JELLY_CHRYS', 1000, bangkokAt(date, '09:00'));
  // Out of the white tea that finished steeping at 08:00 (CLAUDE.md §2.1.3).
  await make('COMP_JELLY_WHITE_GOJI', 1000, bangkokAt(date, '09:00'), white.id);
  await make('COMP_PEAR_FRESH', 840, bangkokAt(date, '10:00'));
  await make('COMP_BASIL_SEED', 250, bangkokAt(date, '10:00'));
}

/** Open day: cut every slab in the fridge, as the open-day screen insists. */
async function cutJelly(db: RuduPosDB, catalog: CostCatalog, at: string): Promise<void> {
  const snapshot = await loadStockSnapshot(db, at);
  for (const batch of snapshot.batches) {
    if (stateAt(batch, at) !== 'SLAB') continue;
    const remaining = snapshot.movements
      .filter((movement) => movement.component_batch_id === batch.id)
      .reduce((total, movement) => total + movement.qty_delta, 0);
    if (remaining > 0 && batch.expires_at > at)
      await commitCut(catalog, batch.id, remaining, db, at);
  }
}

// ------------------------------------------------------------------ sales

/** Sale times between open and close, busiest around half past six. */
function saleTimes(random: () => number, date: string, count: number): string[] {
  const open = Date.parse(bangkokAt(date, OPEN));
  const span = 5 * 3_600_000;
  return Array.from({ length: count }, () => open + span * ((random() + random()) / 2))
    .sort((a, b) => a - b)
    .map((at) => new Date(Math.round(at / 1000) * 1000).toISOString());
}

interface Pick {
  variantId: string;
  modifierIds: string[];
}

/**
 * One customer: mostly one cup, sometimes two or three, now and then a
 * bottle; toppings at roughly the rates the plan assumes. A drink that is out
 * is not sold — the operator would not pour what is not there.
 */
async function ringOne(
  db: RuduPosDB,
  catalog: CostCatalog,
  session: CashSession,
  at: string,
  random: () => number,
  rainy: boolean,
  loyalty: boolean,
): Promise<string | null> {
  const size = loyalty ? 1 : random() < 0.7 ? 1 : random() < 0.8 ? 2 : 3;
  const picks: Pick[] = [];
  for (let n = 0; n < size; n += 1) picks.push(pickDrink(random, rainy, loyalty));
  if (!loyalty && random() < 0.06)
    picks.push({ variantId: 'VAR_BOTTLE_TAMARIND', modifierIds: [] });

  const snapshot = await loadStockSnapshot(db, at);
  const wanted = new Map<string, number>();
  for (const pick of picks) wanted.set(pick.variantId, (wanted.get(pick.variantId) ?? 0) + 1);
  const ringable = picks.filter(
    (pick) =>
      availableCups(catalog, snapshot, pick.variantId).cups >=
      (wanted.get(pick.variantId) ?? 1) + 1,
  );
  if (ringable.length === 0) return null;

  for (const pick of ringable) {
    const lineId = await addDrink(
      pick.variantId === 'VAR_PEAR_HOT' ? 'VAR_PEAR_ICED' : pick.variantId,
      {},
      db,
    );
    if (pick.variantId === 'VAR_PEAR_HOT') {
      const allowed = [...catalog.modifiers.values()]
        .filter((modifier) => modifier.applies_to_variant_ids.includes('VAR_PEAR_HOT'))
        .map((modifier) => modifier.id);
      await setVariant(lineId, 'VAR_PEAR_HOT', allowed, db);
    }
    for (const modifierId of pick.modifierIds) {
      if (modifierAvailable(catalog, snapshot, modifierId, 2))
        await toggleModifier(lineId, modifierId, db);
    }
    if (loyalty) await setLineDiscountReason(lineId, 'LOYALTY_REDEEM', db);
  }

  const cart = await loadCart(db);
  const priced = priceCart(catalog, await loadSettings(db), cart);
  const cashSale = random() < 0.7;
  const { saleId } = await completeSale(
    catalog,
    cart,
    priced,
    {
      method: cashSale ? 'CASH' : 'PROMPTPAY',
      cashReceived: cashSale ? tender(priced.totalNet, random) : null,
      operatorId: session.operator_id,
      deviceId: 'sample',
      brandingLineTh: '',
      businessDate: sessionBusinessDate(session),
    },
    db,
    at,
  );
  return saleId;
}

function pickDrink(random: () => number, rainy: boolean, loyalty: boolean): Pick {
  if (loyalty) return { variantId: 'VAR_TAMARIND_ICED', modifierIds: [] };

  const roll = random();
  const hot = rainy ? 0.35 : 0.12;
  if (roll < 0.55) {
    const modifierIds: string[] = [];
    if (random() < 0.3) modifierIds.push('MOD_BASIL_SEED');
    if (random() < 0.12) modifierIds.push('MOD_SALTED_PLUM');
    if (random() < 0.1) modifierIds.push('PREP_LESS_SWEET');
    return { variantId: 'VAR_TAMARIND_ICED', modifierIds };
  }
  if (roll < 0.55 + hot) return { variantId: 'VAR_PEAR_HOT', modifierIds: [] };
  const modifierIds: string[] = [];
  if (random() < 0.2) modifierIds.push('MOD_PEACH_GUM');
  if (random() < 0.1) modifierIds.push('PREP_LESS_SWEET');
  return { variantId: 'VAR_PEAR_ICED', modifierIds };
}

/** Exact money about half the time; otherwise the smallest note that covers it, mostly. */
function tender(due: number, random: () => number): number {
  if (random() < 0.45) return due;
  const notes = [5_000, 10_000, 50_000, 100_000].filter((note) => note >= due);
  if (notes.length === 0) return due;
  const roll = random();
  return notes[roll < 0.6 ? 0 : roll < 0.9 ? Math.min(1, notes.length - 1) : notes.length - 1]!;
}

// ------------------------------------------------------------------ close

/**
 * Close with the defaults — same-day things out, the rest kept — an eyeballed
 * count now and then, and a drawer that is usually right and sometimes not.
 */
async function close(
  db: RuduPosDB,
  catalog: CostCatalog,
  session: CashSession,
  date: string,
  index: number,
  random: () => number,
): Promise<void> {
  const at = bangkokAt(date, CLOSE);
  const lines = closingLines(catalog, await loadStockSnapshot(db, at), at);
  const decisions = lines.map((line) => ({
    batchId: line.batch.id,
    counted: Math.max(
      0,
      line.remaining - (index === 2 && line.component.id === 'COMP_PEAR_FRESH' ? 10 : 0),
    ),
    decision: line.decision,
    reason: line.reason,
  }));

  const expected = await loadExpectedCash(session, db);
  const variances = [0, 0, 0, -500, 0, -2_000, 500];
  const variance = variances[Math.floor(random() * variances.length)]!;

  await closeDay(
    { sessionId: session.id, decisions, countedCash: expected + variance, note: null },
    catalog,
    db,
    at,
  );
}

// ------------------------------------------------------------------ helpers

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** A small seeded generator: the same seed is the same week, every time. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
