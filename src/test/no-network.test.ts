/**
 * After install, the app fetches nothing (CLAUDE.md §1, §13): every sale
 * completes with zero connectivity and no user path awaits a network call.
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
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bEventSource\b/,
  /\bsendBeacon\b/,
  /https?:\/\//,
];

describe('no network at runtime', () => {
  it('no source file makes a request or names a remote URL', () => {
    const offenders = sourceFiles(resolve(ROOT, 'src')).flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      return NETWORK.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${path.slice(ROOT.length + 1)}: ${pattern}`,
      );
    });
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
