/**
 * One cup on the drink page: what it starts as, what each choice does to it,
 * what it costs, and when two cups are the same cup.
 */
import { describe, expect, it } from 'vitest';
import { buildCostCatalog } from '../cost.ts';
import {
  chooseSweetness,
  chooseVariant,
  cupChoices,
  cupOfLine,
  cupOptions,
  cupTotal,
  newCup,
  paidCups,
  sameCup,
  setFree,
  stepCup,
  sweetnessOf,
  toggleOption,
  MAX_CUPS,
  type CupDraft,
} from '../cup.ts';
import * as LEGACY from '../../data/legacy-seed-v9.ts';
import * as MENU from '../../data/seed.ts';
import type { Modifier } from '../../db/types.ts';

/** Tamarind and pear, hot and iced, with toppings and ways of making it. */
const legacy = buildCostCatalog({
  products: LEGACY.PRODUCTS,
  variants: LEGACY.VARIANTS,
  components: LEGACY.COMPONENTS,
  bom: LEGACY.BOM_ROWS,
  packagingSets: LEGACY.PACKAGING_SETS,
  packagingItems: LEGACY.PACKAGING_ITEMS,
  modifiers: LEGACY.MODIFIERS,
});

/** The menu of Oct 2026: five sweetness levels, three plain teas. */
function menu(modifiers: readonly Modifier[] = MENU.MODIFIERS) {
  return buildCostCatalog({
    products: MENU.PRODUCTS,
    variants: MENU.VARIANTS,
    components: MENU.COMPONENTS,
    bom: MENU.BOM_ROWS,
    packagingSets: MENU.PACKAGING_SETS,
    packagingItems: MENU.PACKAGING_ITEMS,
    modifiers,
  });
}

const pear = (over: Partial<CupDraft> = {}): CupDraft => ({
  variantId: 'VAR_PEAR_ICED',
  modifierIds: [],
  qty: 1,
  freeReason: null,
  ...over,
});

describe('a new cup', () => {
  it('is the usual one: the default variant, made the normal way, one of it', () => {
    expect(newCup(legacy, 'DRINK_PEAR')).toEqual(pear());
  });

  it('is nothing for a product with no variant to ring', () => {
    expect(newCup(legacy, 'NO_SUCH_PRODUCT')).toBeNull();
  });

  it('comes back from a basket line as it was', () => {
    expect(
      cupOfLine({ variant_id: 'VAR_PEAR_HOT', qty: 2, manual_discount_reason: 'STAFF_DRINK' }, [
        'PREP_LESS_SWEET',
      ]),
    ).toEqual(
      pear({
        variantId: 'VAR_PEAR_HOT',
        modifierIds: ['PREP_LESS_SWEET'],
        qty: 2,
        freeReason: 'STAFF_DRINK',
      }),
    );
  });
});

describe('the choices offered', () => {
  it('splits a variant’s modifiers into sweetness, ways of making it and toppings', () => {
    const options = cupOptions(legacy, 'VAR_PEAR_ICED');
    expect(options.variants.map((variant) => variant.id)).toEqual([
      'VAR_PEAR_ICED',
      'VAR_PEAR_HOT',
    ]);
    expect(options.sweetness.map((modifier) => modifier.id)).toEqual(['PREP_LESS_SWEET']);
    expect(options.prep.map((modifier) => modifier.id)).toEqual(
      expect.arrayContaining(['PREP_NO_ICE', 'PREP_NO_SOLIDS']),
    );
    expect(options.prep.map((modifier) => modifier.id)).not.toContain('PREP_LESS_SWEET');
    expect(options.toppings.map((modifier) => modifier.id)).toEqual(['MOD_PEACH_GUM']);
  });

  it('lists every sweetness level of the menu in order, หวานมาก first after normal', () => {
    expect(
      cupOptions(menu(), 'VAR_CALAMANSI_ICED').sweetness.map((modifier) => modifier.name_th),
    ).toEqual(['หวานมาก', 'หวานน้อย', 'หวานน้อยมาก', 'ไม่เติมน้ำตาล']);
  });

  it('offers no choice of variant on a drink that has one', () => {
    expect(cupOptions(legacy, 'VAR_TAMARIND_ICED').variants).toHaveLength(1);
  });
});

describe('choosing', () => {
  it('drops a topping the other variant already has in its recipe', () => {
    const iced = pear({ modifierIds: ['MOD_PEACH_GUM', 'PREP_LESS_SWEET'] });
    expect(chooseVariant(legacy, iced, 'VAR_PEAR_HOT').modifierIds).toEqual(['PREP_LESS_SWEET']);
  });

  it('keeps the sweetness across variants by name, when each has its own row', () => {
    // A white tea whose หวานน้อย is a row of its own, as pear's is.
    const own: Modifier = {
      ...MENU.MODIFIERS.find((modifier) => modifier.id === 'PREP_LESS_SWEET')!,
      id: 'PREP_LESS_SWEET_WHITE',
      applies_to_variant_ids: ['VAR_PLAIN_WHITE'],
    };
    const catalog = menu([
      ...MENU.MODIFIERS.map((modifier) =>
        modifier.id === 'PREP_LESS_SWEET'
          ? {
              ...modifier,
              applies_to_variant_ids: modifier.applies_to_variant_ids.filter(
                (id) => id !== 'VAR_PLAIN_WHITE',
              ),
            }
          : modifier,
      ),
      own,
    ]);
    const black = pear({ variantId: 'VAR_PLAIN_BLACK', modifierIds: ['PREP_LESS_SWEET'] });

    expect(chooseVariant(catalog, black, 'VAR_PLAIN_WHITE').modifierIds).toEqual([
      'PREP_LESS_SWEET_WHITE',
    ]);
  });

  it('takes one sweetness at a time, and null is back to normal', () => {
    const catalog = menu();
    const calamansi = pear({ variantId: 'VAR_CALAMANSI_ICED', modifierIds: ['MOD_YAKULT'] });

    const less = chooseSweetness(catalog, calamansi, 'PREP_LESS_SWEET');
    expect(sweetnessOf(catalog, less)).toBe('PREP_LESS_SWEET');
    const extra = chooseSweetness(catalog, less, 'PREP_EXTRA_SWEET');
    expect(extra.modifierIds).toEqual(['MOD_YAKULT', 'PREP_EXTRA_SWEET']);
    const normal = chooseSweetness(catalog, extra, null);
    expect(normal.modifierIds).toEqual(['MOD_YAKULT']);
    expect(sweetnessOf(catalog, normal)).toBeNull();
  });

  it('turns an option on and off, and two that set the same thing never both', () => {
    const plum = toggleOption(legacy, pear({ variantId: 'VAR_TAMARIND_ICED' }), 'MOD_SALTED_PLUM');
    expect(plum.modifierIds).toEqual(['MOD_SALTED_PLUM']);
    expect(toggleOption(legacy, plum, 'MOD_SALTED_PLUM').modifierIds).toEqual([]);

    // Both replace the concentrate: the second takes the first's place.
    const one: Modifier = { ...LEGACY.MODIFIERS[0]!, id: 'A', overrides_component_role: 'SOLID' };
    const two: Modifier = { ...one, id: 'B' };
    const catalog = buildCostCatalog({
      products: LEGACY.PRODUCTS,
      variants: LEGACY.VARIANTS,
      components: LEGACY.COMPONENTS,
      bom: LEGACY.BOM_ROWS,
      packagingSets: LEGACY.PACKAGING_SETS,
      packagingItems: LEGACY.PACKAGING_ITEMS,
      modifiers: [one, two],
    });
    expect(toggleOption(catalog, pear({ modifierIds: ['A'] }), 'B').modifierIds).toEqual(['B']);
  });

  it('steps between one and the most', () => {
    expect(stepCup(pear(), -1).qty).toBe(1);
    expect(stepCup(pear(), 1).qty).toBe(2);
    expect(stepCup(pear({ qty: MAX_CUPS }), 1).qty).toBe(MAX_CUPS);
  });
});

describe('what the cup comes to', () => {
  it('is its price with its toppings, times the cups', () => {
    expect(cupTotal(legacy, pear({ modifierIds: ['MOD_PEACH_GUM'], qty: 2 }))).toBe(2 * 6_900);
  });

  it('leaves out the one cup given away, and only that one', () => {
    expect(paidCups(setFree(pear({ qty: 3 }), 'LOYALTY_REDEEM'))).toBe(2);
    expect(cupTotal(legacy, setFree(pear(), 'LOYALTY_REDEEM'))).toBe(0);
    expect(cupTotal(legacy, setFree(setFree(pear(), 'STAFF_DRINK'), null))).toBe(5_900);
  });
});

describe('the same cup', () => {
  it('is the same variant with the same choices, in any order', () => {
    expect(
      sameCup(
        { variantId: 'V', modifierIds: ['A', 'B'] },
        { variantId: 'V', modifierIds: ['B', 'A'] },
      ),
    ).toBe(true);
    expect(
      sameCup({ variantId: 'V', modifierIds: ['A'] }, { variantId: 'V', modifierIds: ['A', 'B'] }),
    ).toBe(false);
    expect(sameCup({ variantId: 'V', modifierIds: [] }, { variantId: 'W', modifierIds: [] })).toBe(
      false,
    );
  });
});

describe('the choices in words, for the basket line', () => {
  it('says the variant when there is a choice of one, then sweetness, then the rest', () => {
    expect(cupChoices(legacy, 'VAR_PEAR_HOT', ['PREP_NO_SOLIDS', 'PREP_LESS_SWEET'])).toEqual([
      'ร้อน',
      'หวานน้อย',
      'ไม่ใส่เนื้อ',
    ]);
    expect(cupChoices(legacy, 'VAR_TAMARIND_ICED', [])).toEqual([]);
    expect(cupChoices(menu(), 'VAR_PLAIN_JASMINE', [])).toEqual(['ชามะลิ']);
  });
});
