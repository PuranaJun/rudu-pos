import { describe, expect, it } from 'vitest';
import { moveEntry, orderBySales, unitsByProduct } from '../menu-order.ts';
import { PRODUCTS } from '../../data/legacy-seed-v9.ts';

describe('moveEntry', () => {
  it('swaps with the neighbour, and leaves the ends alone', () => {
    expect(moveEntry(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveEntry(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveEntry(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveEntry(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('orderBySales', () => {
  const [tamarind, pear, bottle] = ['DRINK_TAMARIND', 'DRINK_PEAR', 'BOTTLE_TAMARIND_1L'].map(
    (id) => PRODUCTS.find((product) => product.id === id)!,
  );

  it('puts the most sold first and keeps the unsold in their order', () => {
    const units = new Map([[pear!.id, 12]]);
    expect(orderBySales([tamarind!, bottle!, pear!], units).map((p) => p.id)).toEqual([
      pear!.id,
      tamarind!.id,
      bottle!.id,
    ]);
  });

  it('changes nothing pressed twice', () => {
    const units = new Map([
      [pear!.id, 5],
      [tamarind!.id, 5],
    ]);
    const once = orderBySales([tamarind!, pear!, bottle!], units);
    expect(orderBySales(once, units)).toEqual(once);
  });
});

describe('unitsByProduct', () => {
  it('counts cups of sales that stood, per product', () => {
    const lines = [
      { sale_id: 'S1', variant_id: 'VAR_PEAR_ICED', qty: 2 },
      { sale_id: 'S1', variant_id: 'VAR_PEAR_HOT', qty: 1 },
      { sale_id: 'VOIDED', variant_id: 'VAR_PEAR_ICED', qty: 9 },
    ];
    const units = unitsByProduct(lines, new Set(['S1']), () => 'DRINK_PEAR');
    expect(units.get('DRINK_PEAR')).toBe(3);
  });
});
