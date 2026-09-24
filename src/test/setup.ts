import '@testing-library/jest-dom/vitest';
// Dexie needs an IndexedDB implementation; jsdom does not ship one.
import 'fake-indexeddb/auto';

import { configure } from '@testing-library/react';

// The whole suite runs files in parallel against IndexedDB in memory; a live
// query can take longer than the one-second default to repaint under that
// load. Three seconds is headroom, not a hiding place: a real hang still fails.
configure({ asyncUtilTimeout: 3000 });
