import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RuduPosDB } from '../../db/database.ts';
import { loadCostCatalog } from '../../db/catalog.ts';
import { ensureSeeded } from '../../db/seed.ts';
import type { CostCatalog } from '../cost.ts';
import {
  applyPromotions,
  MANUAL_DISCOUNT_REASONS,
  type PriceableLine,
  type PromotionSettings,
} from '../promotions.ts';

let db: RuduPosDB;
let dbName: string;
let catalog: CostCatalog;

beforeAll(async () => {
  dbName = `rudu-promo-${crypto.randomUUID()}`;
  db = new RuduPosDB(dbName);
  await db.open();
  await ensureSeeded(db);
  catalog = await loadCostCatalog(db);
});

afterAll(async () => {
  db.close();
  await RuduPosDB.delete(dbName);
});

const SETTINGS: PromotionSettings = {
  twoCupEnabled: true,
  twoCupAmount: 1000,
  rainyDayEnabled: false,
  rainyDayAmount: 500,
  rainyDayVariantId: 'VAR_PEAR_HOT',
};

let seq = 0;
function line(variantId: string, qty: number, unitPrice: number): PriceableLine {
  seq += 1;
  return { lineId: `L${seq}`, variantId, qty, unitPrice, manualReason: null };
}

describe('PROMO_TWO_CUP', () => {
  it('takes 10 THB off a pair, automatically', () => {
    const result = applyPromotions(catalog, SETTINGS, [line('VAR_TAMARIND_ICED', 2, 4000)]);

    expect(result.totalGross).toBe(8000);
    expect(result.totalDiscount).toBe(1000);
    expect(result.totalNet).toBe(7000);
    expect(result.byReason).toEqual([{ reason: 'PROMO_TWO_CUP', amount: 1000 }]);
  });

  it('gives nothing for a single drink', () => {
    const result = applyPromotions(catalog, SETTINGS, [line('VAR_TAMARIND_ICED', 1, 4000)]);
    expect(result.totalDiscount).toBe(0);
  });

  it('takes 20 THB off four drinks', () => {
    const result = applyPromotions(catalog, SETTINGS, [
      line('VAR_TAMARIND_ICED', 2, 4000),
      line('VAR_PEAR_ICED', 2, 5900),
    ]);
    expect(result.totalDiscount).toBe(2000);
  });

  it('pairs across lines, not only within one', () => {
    const result = applyPromotions(catalog, SETTINGS, [
      line('VAR_TAMARIND_ICED', 1, 4000),
      line('VAR_PEAR_ICED', 1, 5900),
    ]);
    expect(result.totalDiscount).toBe(1000);
  });

  it('leaves the odd cup out — three drinks is one pair', () => {
    const result = applyPromotions(catalog, SETTINGS, [line('VAR_TAMARIND_ICED', 3, 4000)]);
    expect(result.totalDiscount).toBe(1000);
  });

  it('excludes bottles: one drink plus one bottle is no discount', () => {
    const result = applyPromotions(catalog, SETTINGS, [
      line('VAR_TAMARIND_ICED', 1, 4000),
      line('VAR_BOTTLE_TAMARIND', 1, 9900),
    ]);
    expect(result.totalDiscount).toBe(0);
    expect(result.totalNet).toBe(13_900);
  });

  it('does not let two bottles make a pair', () => {
    const result = applyPromotions(catalog, SETTINGS, [line('VAR_BOTTLE_TAMARIND', 2, 9900)]);
    expect(result.totalDiscount).toBe(0);
  });

  it('excludes a 0 THB loyalty cup from the count', () => {
    // One paid drink and one free one is not a qualifying pair.
    const result = applyPromotions(catalog, SETTINGS, [
      line('VAR_TAMARIND_ICED', 1, 4000),
      { ...line('VAR_TAMARIND_ICED', 1, 4000), manualReason: 'LOYALTY_REDEEM' },
    ]);

    expect(result.byReason).toEqual([{ reason: 'LOYALTY_REDEEM', amount: 4000 }]);
    expect(result.totalNet).toBe(4000);
  });

  it('can be switched off in settings', () => {
    const result = applyPromotions(catalog, { ...SETTINGS, twoCupEnabled: false }, [
      line('VAR_TAMARIND_ICED', 2, 4000),
    ]);
    expect(result.totalDiscount).toBe(0);
  });
});

describe('PROMO_RAINY_DAY', () => {
  it('does nothing while the operator has it switched off', () => {
    const result = applyPromotions(catalog, SETTINGS, [line('VAR_PEAR_HOT', 1, 5900)]);
    expect(result.totalDiscount).toBe(0);
  });

  it('takes 5 THB off hot pear once the operator switches it on', () => {
    const result = applyPromotions(catalog, { ...SETTINGS, rainyDayEnabled: true }, [
      line('VAR_PEAR_HOT', 1, 5900),
    ]);

    expect(result.totalNet).toBe(5400);
    expect(result.byReason).toEqual([{ reason: 'PROMO_RAINY_DAY', amount: 500 }]);
  });

  it('applies per cup', () => {
    const result = applyPromotions(catalog, { ...SETTINGS, rainyDayEnabled: true }, [
      line('VAR_PEAR_HOT', 2, 5900),
    ]);

    // 5 THB off each cup, then 10 THB off the pair.
    expect(result.totalNet).toBe(11_800 - 1000 - 1000);
  });

  it('touches only the variant named in settings', () => {
    const rainy = { ...SETTINGS, rainyDayEnabled: true };

    expect(applyPromotions(catalog, rainy, [line('VAR_PEAR_ICED', 1, 5900)]).totalDiscount).toBe(0);
    expect(
      applyPromotions(catalog, rainy, [line('VAR_TAMARIND_ICED', 1, 4000)]).totalDiscount,
    ).toBe(0);
  });

  it('follows the setting if the shop ever moves it to another drink', () => {
    const result = applyPromotions(
      catalog,
      { ...SETTINGS, rainyDayEnabled: true, rainyDayVariantId: 'VAR_TAMARIND_ICED' },
      [line('VAR_TAMARIND_ICED', 1, 4000)],
    );
    expect(result.totalNet).toBe(3500);
  });
});

describe('giving a cup away', () => {
  it.each(MANUAL_DISCOUNT_REASONS)('zeroes the line and records %s', (reason) => {
    const result = applyPromotions(catalog, SETTINGS, [
      { ...line('VAR_PEAR_ICED', 1, 5900), manualReason: reason },
    ]);

    expect(result.totalNet).toBe(0);
    expect(result.byReason).toEqual([{ reason, amount: 5900 }]);
  });

  it('keeps the gross, so the giveaway is visible rather than invisible', () => {
    const result = applyPromotions(catalog, SETTINGS, [
      { ...line('VAR_PEAR_ICED', 2, 5900), manualReason: 'STAFF_DRINK' },
    ]);

    expect(result.totalGross).toBe(11_800);
    expect(result.totalDiscount).toBe(11_800);
    expect(result.totalNet).toBe(0);
  });
});

describe('several reasons on one line', () => {
  it('records both the rainy-day price and the pair discount separately', () => {
    const result = applyPromotions(catalog, { ...SETTINGS, rainyDayEnabled: true }, [
      line('VAR_PEAR_HOT', 2, 5900),
    ]);

    const reasons = result.lines[0]!.discounts.map((discount) => discount.reason).sort();
    expect(reasons).toEqual(['PROMO_RAINY_DAY', 'PROMO_TWO_CUP']);
    // This is exactly what a single discount_reason column cannot express.
    expect(result.byReason).toHaveLength(2);
  });
});

describe('arithmetic that must not go wrong', () => {
  it('never discounts a line past zero', () => {
    const result = applyPromotions(catalog, { ...SETTINGS, twoCupAmount: 100_000 }, [
      line('VAR_TAMARIND_ICED', 2, 4000),
    ]);

    expect(result.totalNet).toBe(0);
    expect(result.lines.every((priced) => priced.net >= 0)).toBe(true);
  });

  it('adds up: gross minus discount is always net', () => {
    const result = applyPromotions(catalog, { ...SETTINGS, rainyDayEnabled: true }, [
      line('VAR_TAMARIND_ICED', 3, 4000),
      line('VAR_PEAR_HOT', 2, 5900),
      line('VAR_BOTTLE_TAMARIND', 1, 9900),
      { ...line('VAR_PEAR_ICED', 1, 5900), manualReason: 'LOYALTY_REDEEM' },
    ]);

    expect(result.totalGross - result.totalDiscount).toBe(result.totalNet);
    const summed = result.byReason.reduce((total, discount) => total + discount.amount, 0);
    expect(summed).toBe(result.totalDiscount);
  });

  it('is pure — the same cart twice gives the same answer', () => {
    const lines = [line('VAR_TAMARIND_ICED', 2, 4000)];
    expect(applyPromotions(catalog, SETTINGS, lines)).toEqual(
      applyPromotions(catalog, SETTINGS, lines),
    );
  });
});
