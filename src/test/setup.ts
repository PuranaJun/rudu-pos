import '@testing-library/jest-dom/vitest';
// Dexie needs an IndexedDB implementation; jsdom does not ship one.
import 'fake-indexeddb/auto';

import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';
import { resetNav } from '../nav/nav-store.ts';

// The whole suite runs files in parallel against IndexedDB in memory; a live
// query can take longer than the one-second default to repaint under that
// load. Three seconds is headroom, not a hiding place: a real hang still fails.
configure({ asyncUtilTimeout: 3000 });

// jsdom has no canvas and says so on every receipt. No 2D context is the
// honest answer; tests that draw one bring their own stand-in.
// (Server tests run without a DOM at all.)
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof HTMLCanvasElement.prototype.getContext;
}

// Navigation lives in a module-level store, which outlives a test's render.
// Unmount first, so nothing on screen reacts to the reset, then start the next
// test at home — never on the summary of a day the last test closed.
afterEach(() => {
  cleanup();
  resetNav();
});
