import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ensureDeviceId } from './db/device.ts';
import { ensureSeeded } from './db/seed.ts';
import { promoteReadyBatches } from './db/stock-repo.ts';
import { requestPersistentStorage } from './lib/storage.ts';
import { recordStorageDurability } from './db/storage-note.ts';
import { startSync } from './sync/sync-client.ts';
import { lockWhenAway } from './nav/owner-lock.ts';
import './index.css';

// iOS can evict IndexedDB. Ask for durable storage on launch, never block on
// it, and leave a one-time note for the operator if the answer is no.
void requestPersistentStorage().then((result) => recordStorageDurability(result));

// First launch loads the catalog. Deliberately not awaited: the shell renders
// immediately and useLiveQuery picks the rows up the moment they land.
void ensureSeeded();
void ensureDeviceId();
// Bring finished steeps' stored state into line. Reads already treat them as
// ready; this runs once per launch, never on a timer.
void promoteReadyBatches();
// Online sync, if it is switched on: a send shortly after changes, and a round
// whenever the app is opened or the signal comes back. Never a loop, never
// awaited by anything the operator is doing (CLAUDE.md §1, §8).
startSync();

// The owner's PIN, once typed, does not outlast the phone going back in a
// pocket. A listener, not a timer.
lockWhenAway();

// iOS Safari only applies :active — the pressed look on every button — when
// something is listening for touches. A passive no-op costs nothing.
document.addEventListener('touchstart', () => {}, { passive: true });

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
