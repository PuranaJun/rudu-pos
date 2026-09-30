/**
 * Sunlight contrast (CLAUDE.md §1): every text/background pair the app uses,
 * read from the stylesheet's own tokens, at 7:1 or better. A colour edit that
 * drops below the line fails here rather than on a bright afternoon.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read from disk: the test run does not process CSS, so an import would be
// empty. Tests run from the project root.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

function tokens(): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)) {
    found.set(match[1]!, match[2]!);
  }
  found.set('white', '#ffffff');
  return found;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** [text, background] as the components pair them. */
const PAIRS: Array<[string, string]> = [
  ['ink', 'white'],
  ['ink', 'paper'],
  ['ink', 'paper-sunk'],
  ['ink', 'today'],
  ['ink-soft', 'white'],
  ['ink-soft', 'paper'],
  ['ink-soft', 'paper-sunk'], // disabled buttons, secondary text on cards
  ['white', 'ink'],
  ['paper', 'ink'],
  ['white', 'brand'],
  ['paper', 'brand'],
  ['white', 'brand-2'],
  ['white', 'drink-1'],
  ['white', 'drink-2'],
  ['white', 'drink-3'],
  ['white', 'bottle'],
  ['white', 'expired'],
  ['white', 'qr'],
];

/**
 * [edge, surface]: the outline of something tappable against what it sits
 * on. WCAG asks 3:1 for the boundary of a control; a button whose edge fades
 * into the page in sunlight reads as a label, not a thing to press.
 */
const EDGES: Array<[string, string]> = [
  ['ink-soft', 'white'], // secondary buttons, unselected chips, inputs
  ['ink-soft', 'paper'],
  ['ink', 'white'], // selected chips, the warning button's edge
  ['brand-2', 'white'],
  ['expired', 'white'],
  ['qr', 'white'],
];

/**
 * [a, b]: two states that must not be mistaken for each other at a glance,
 * told apart by lightness — hue is the first thing direct sun washes out.
 */
const DISTINCT: Array<[string, string]> = [
  // A sold-out drink against every drink that is still selling.
  ['paper-sunk', 'drink-1'],
  ['paper-sunk', 'drink-2'],
  ['paper-sunk', 'drink-3'],
  ['paper-sunk', 'bottle'],
  // The "running low" block on a drink button.
  ['today', 'drink-1'],
  ['today', 'drink-2'],
  ['today', 'drink-3'],
  ['today', 'bottle'],
];

describe('sunlight contrast', () => {
  const palette = tokens();

  function ratio(a: string, b: string): number {
    const first = palette.get(a);
    const second = palette.get(b);
    expect(first, `--color-${a}`).toBeDefined();
    expect(second, `--color-${b}`).toBeDefined();
    return contrast(first!, second!);
  }

  it.each(PAIRS)('%s on %s is 7:1 or better', (text, background) => {
    expect(ratio(text, background)).toBeGreaterThanOrEqual(7);
  });

  it.each(EDGES)('a %s edge on %s is 3:1 or better', (edge, surface) => {
    expect(ratio(edge, surface)).toBeGreaterThanOrEqual(3);
  });

  it.each(DISTINCT)('%s and %s differ by 3:1 or more in lightness', (a, b) => {
    expect(ratio(a, b)).toBeGreaterThanOrEqual(3);
  });
});
