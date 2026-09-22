import { formatTHB, toBaht, toSatang } from './money.ts';

describe('toSatang', () => {
  it('converts whole baht', () => {
    expect(toSatang(40)).toBe(4000);
    expect(toSatang(0)).toBe(0);
  });

  it('rounds away binary floating point error', () => {
    // 1.18 * 100 === 117.99999999999999
    expect(toSatang(1.18)).toBe(118);
    expect(toSatang(0.0214286 * 35)).toBe(75);
    expect(toSatang(7.73)).toBe(773);
  });
});

describe('toBaht', () => {
  it('converts satang back to baht', () => {
    expect(toBaht(4000)).toBe(40);
    expect(toBaht(684)).toBe(6.84);
  });
});

describe('formatTHB', () => {
  it('formats a whole baht price with no decimals', () => {
    expect(formatTHB(4000)).toBe('฿40');
    expect(formatTHB(5900)).toBe('฿59');
    expect(formatTHB(0)).toBe('฿0');
  });

  it('never renders a trailing .00', () => {
    expect(formatTHB(9900)).not.toContain('.');
  });

  it('keeps satang precision on costs', () => {
    expect(formatTHB(684)).toBe('฿6.84');
    expect(formatTHB(5)).toBe('฿0.05');
    expect(formatTHB(1160)).toBe('฿11.60');
  });

  it('groups thousands and handles negatives', () => {
    expect(formatTHB(150000)).toBe('฿1,500');
    expect(formatTHB(-1000)).toBe('-฿10');
  });
});
