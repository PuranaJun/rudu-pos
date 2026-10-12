/**
 * The owner's own promotions, through the same engine as the 2-cup discount
 * and the rainy-day price — and the order they apply in, so no cup is
 * discounted twice by accident.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCostCatalog, type CostCatalog } from '../cost.ts';
import {
  applyPromotions,
  discountLabel,
  promotionLive,
  type PriceableLine,
  type PromotionSettings,
} from '../promotions.ts';
import {
  BOM_ROWS,
  COMPONENTS,
  MODIFIERS,
  PACKAGING_ITEMS,
  PACKAGING_SETS,
  PRODUCTS,
  VARIANTS,
} from '../../data/seed.ts';
import type { Promotion } from '../../db/types.ts';

// 2026-10-13 is a Tuesday; 03:00 UTC is 10:00 in Bangkok.
const TUESDAY_10AM = '2026-10-13T03:00:00.000Z';

const OFF: PromotionSettings = {
  twoCupEnabled: false,
  twoCupAmount: 1000,
  rainyDayEnabled: false,
  rainyDayAmount: 500,
  rainyDayVariantId: 'VAR_PEAR_HOT',
};

function promotion(overrides: Partial<Promotion>): Promotion {
  return {
    id: 'P1',
    name_th: 'โปรทดลอง',
    kind: 'AMOUNT_OFF',
    amount: 1_000,
    percent: 0,
    buy_qty: 0,
    free_qty: 0,
    variant_ids: [],
    activation: 'AUTO',
    manual_on: false,
    starts_on: null,
    ends_on: null,
    weekdays: [],
    hours_from: null,
    hours_to: null,
    stacks_with_two_cup: true,
    is_active: true,
    sort_order: 0,
    synced_at: null,
    ...overrides,
  };
}

function catalogWith(...promotions: Promotion[]): CostCatalog {
  return buildCostCatalog({
    products: PRODUCTS,
    variants: VARIANTS,
    components: COMPONENTS,
    bom: BOM_ROWS,
    packagingSets: PACKAGING_SETS,
    packagingItems: PACKAGING_ITEMS,
    modifiers: MODIFIERS,
    promotions,
  });
}

let seq = 0;
function line(variantId: string, qty: number, unitPrice: number): PriceableLine {
  seq += 1;
  return { lineId: `L${seq}`, variantId, qty, unitPrice, manualReason: null };
}

let plain: CostCatalog;
beforeAll(() => {
  plain = catalogWith();
});

describe('฿ and % off', () => {
  it('takes ฿ off each cup of the chosen drink, under the promotion’s own name', () => {
    const catalog = catalogWith(promotion({ variant_ids: ['VAR_TAMARIND_ICED'] }));
    const result = applyPromotions(
      catalog,
      OFF,
      [line('VAR_TAMARIND_ICED', 2, 4_000), line('VAR_PEAR_ICED', 1, 5_900)],
      TUESDAY_10AM,
    );
    expect(result.totalNet).toBe(8_000 - 2_000 + 5_900);
    expect(result.byReason).toEqual([
      { reason: 'PROMO_CUSTOM', promotionId: 'P1', label: 'โปรทดลอง', amount: 2_000 },
    ]);
    expect(discountLabel(result.byReason[0]!)).toBe('โปรทดลอง');
  });

  it('takes a percentage, rounded to the satang', () => {
    const catalog = catalogWith(promotion({ kind: 'PERCENT_OFF', percent: 15 }));
    const result = applyPromotions(catalog, OFF, [line('VAR_PEAR_ICED', 1, 5_900)], TUESDAY_10AM);
    expect(result.totalDiscount).toBe(885);
  });

  it('never touches a bottle unless the bottle is chosen', () => {
    const catalog = catalogWith(promotion({}));
    const result = applyPromotions(
      catalog,
      OFF,
      [line('VAR_BOTTLE_TAMARIND', 1, 9_900)],
      TUESDAY_10AM,
    );
    expect(result.totalDiscount).toBe(0);
  });

  it('gives a cup the single best offer — never two — and the rainy day keeps a tie', () => {
    const rainy = { ...OFF, rainyDayEnabled: true };
    const bigger = catalogWith(promotion({ amount: 800 }));
    expect(
      applyPromotions(bigger, rainy, [line('VAR_PEAR_HOT', 1, 5_900)], TUESDAY_10AM).byReason,
    ).toEqual([{ reason: 'PROMO_CUSTOM', promotionId: 'P1', label: 'โปรทดลอง', amount: 800 }]);

    const same = catalogWith(promotion({ amount: 500 }));
    expect(
      applyPromotions(same, rainy, [line('VAR_PEAR_HOT', 1, 5_900)], TUESDAY_10AM).byReason,
    ).toEqual([{ reason: 'PROMO_RAINY_DAY', amount: 500 }]);
  });
});

describe('buy X get Y', () => {
  const b2g1 = promotion({
    id: 'B2G1',
    name_th: 'ซื้อ 2 แถม 1',
    kind: 'BUY_X_GET_Y',
    buy_qty: 2,
    free_qty: 1,
  });

  it('frees one in every three, and the cheapest one', () => {
    const catalog = catalogWith(b2g1);
    const result = applyPromotions(
      catalog,
      OFF,
      [line('VAR_PEAR_ICED', 2, 5_900), line('VAR_TAMARIND_ICED', 1, 4_000)],
      TUESDAY_10AM,
    );
    expect(result.totalNet).toBe(11_800);
    expect(result.lines[1]!.net).toBe(0);
  });

  it('frees two in six, and never more than were bought', () => {
    const catalog = catalogWith(b2g1);
    expect(
      applyPromotions(catalog, OFF, [line('VAR_TAMARIND_ICED', 6, 4_000)], TUESDAY_10AM).totalNet,
    ).toBe(16_000);
    expect(
      applyPromotions(catalog, OFF, [line('VAR_TAMARIND_ICED', 2, 4_000)], TUESDAY_10AM)
        .totalDiscount,
    ).toBe(0);
  });

  it('counts only the paid cups towards the 2-cup discount', () => {
    const catalog = catalogWith(b2g1);
    const result = applyPromotions(
      catalog,
      { ...OFF, twoCupEnabled: true },
      [line('VAR_TAMARIND_ICED', 3, 4_000)],
      TUESDAY_10AM,
    );
    // One cup free, two paid: one pair, ฿10 off.
    expect(result.totalNet).toBe(12_000 - 4_000 - 1_000);
  });
});

describe('the 2-cup discount', () => {
  it('stacks on top by default', () => {
    const catalog = catalogWith(promotion({ amount: 500 }));
    const result = applyPromotions(
      catalog,
      { ...OFF, twoCupEnabled: true },
      [line('VAR_TAMARIND_ICED', 2, 4_000)],
      TUESDAY_10AM,
    );
    expect(result.totalNet).toBe(8_000 - 1_000 - 1_000);
  });

  it('leaves out cups on a promotion that says it does not combine', () => {
    const catalog = catalogWith(promotion({ amount: 500, stacks_with_two_cup: false }));
    const result = applyPromotions(
      catalog,
      { ...OFF, twoCupEnabled: true },
      [line('VAR_TAMARIND_ICED', 2, 4_000)],
      TUESDAY_10AM,
    );
    expect(result.byReason.map((d) => d.reason)).toEqual(['PROMO_CUSTOM']);
  });

  it('is untouched with no promotions at all', () => {
    const result = applyPromotions(
      plain,
      { ...OFF, twoCupEnabled: true },
      [line('VAR_TAMARIND_ICED', 2, 4_000)],
      TUESDAY_10AM,
    );
    expect(result.byReason).toEqual([{ reason: 'PROMO_TWO_CUP', amount: 1_000 }]);
  });
});

describe('when a promotion runs', () => {
  it('respects its dates, its weekdays and its hours', () => {
    expect(promotionLive(promotion({}), TUESDAY_10AM)).toBe(true);
    expect(promotionLive(promotion({ starts_on: '2026-10-14' }), TUESDAY_10AM)).toBe(false);
    expect(promotionLive(promotion({ ends_on: '2026-10-12' }), TUESDAY_10AM)).toBe(false);
    expect(promotionLive(promotion({ ends_on: '2026-10-13' }), TUESDAY_10AM)).toBe(true);
    expect(promotionLive(promotion({ weekdays: [1] }), TUESDAY_10AM)).toBe(true); // Tuesday
    expect(promotionLive(promotion({ weekdays: [5, 6] }), TUESDAY_10AM)).toBe(false);
    expect(promotionLive(promotion({ hours_from: '09:00', hours_to: '11:00' }), TUESDAY_10AM)).toBe(
      true,
    );
    expect(promotionLive(promotion({ hours_from: '10:00', hours_to: '10:00' }), TUESDAY_10AM)).toBe(
      false,
    );
    expect(promotionLive(promotion({ hours_from: '14:00', hours_to: '16:00' }), TUESDAY_10AM)).toBe(
      false,
    );
  });

  it('runs a manual one only when switched on, and never one that is switched off in settings', () => {
    expect(promotionLive(promotion({ activation: 'MANUAL' }), TUESDAY_10AM)).toBe(false);
    expect(promotionLive(promotion({ activation: 'MANUAL', manual_on: true }), TUESDAY_10AM)).toBe(
      true,
    );
    expect(promotionLive(promotion({ is_active: false }), TUESDAY_10AM)).toBe(false);
  });

  it('prices nothing off outside its hours', () => {
    const catalog = catalogWith(promotion({ hours_from: '14:00', hours_to: '16:00' }));
    expect(
      applyPromotions(catalog, OFF, [line('VAR_TAMARIND_ICED', 1, 4_000)], TUESDAY_10AM)
        .totalDiscount,
    ).toBe(0);
  });
});
