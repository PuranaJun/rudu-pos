/**
 * After install, the app fetches nothing it needs (CLAUDE.md §1, §13): every
 * sale completes with zero connectivity and no user path awaits a network
 * call. The one exception is online sync (§8) — switched on by the owner, in
 * one module, and never imported by anything on the sell path.
 *
 * Checked at the source, so a stray fetch, a CDN font or a runtime-cached
 * API route fails here rather than on a market with no signal. The one
 * request the platform makes on its own — the browser's check for a newer
 * service worker when the app is opened — is not the app's, is never
 * awaited, and fails silently offline.
 */
/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'test' ? [] : sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const NETWORK = [
  /\bfetch\s*\(/,
  // A fetch handed over to be called later counts too.
  /=\s*fetch\b/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /https?:\/\//,
];

/** The only module allowed to talk to the network: online sync. */
const SYNC_MODULE = join('src', 'sync', 'sync-client.ts');

/** The sale, from the tap to the drawer. None of it may know sync exists. */
const SELL_PATH = [
  'src/screens/SellScreen.tsx',
  'src/components/DrinkButton.tsx',
  'src/components/CartLineRow.tsx',
  'src/components/PayButtons.tsx',
  'src/components/PromptPayPanel.tsx',
  'src/db/cart-repo.ts',
  'src/db/sale-repo.ts',
  'src/db/stock-repo.ts',
];

describe('no network at runtime', () => {
  it('no source file but the sync module makes a request or names a remote URL', () => {
    const offenders = sourceFiles(resolve(ROOT, 'src'))
      .filter((path) => path.slice(ROOT.length + 1) !== SYNC_MODULE)
      .flatMap((path) => {
        const text = readFileSync(path, 'utf8');
        return NETWORK.filter((pattern) => pattern.test(text)).map(
          (pattern) => `${path.slice(ROOT.length + 1)}: ${pattern}`,
        );
      });
    expect(offenders).toEqual([]);
  });

  it('nothing on the sell path imports sync, so a sale can never wait on it', () => {
    const offenders = SELL_PATH.filter((path) =>
      /from\s+['"][^'"]*\/sync\//.test(readFileSync(resolve(ROOT, path), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('the page loads nothing from anywhere else — no fonts, no scripts, no styles', () => {
    const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/(src|href)=["']?(https?:)?\/\//);
  });

  it('the service worker caches the shell and routes nothing to the network', () => {
    const config = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/globPatterns/);
    expect(config).not.toMatch(/runtimeCaching/);
    // Updates wait for the operator; nothing swaps the app mid-sale.
    expect(config).toMatch(/skipWaiting:\s*false/);
  });
});
