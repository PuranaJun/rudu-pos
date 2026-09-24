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
  ['white', 'soldout'],
  ['white', 'expired'],
  ['fresh', 'white'],
];

describe('sunlight contrast', () => {
  const palette = tokens();

  it.each(PAIRS)('%s on %s is 7:1 or better', (text, background) => {
    const fg = palette.get(text);
    const bg = palette.get(background);
    expect(fg, `--color-${text}`).toBeDefined();
    expect(bg, `--color-${background}`).toBeDefined();
    expect(contrast(fg!, bg!)).toBeGreaterThanOrEqual(7);
  });
});
