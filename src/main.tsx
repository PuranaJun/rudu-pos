import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ensureDeviceId } from './db/device.ts';
import { ensureSeeded } from './db/seed.ts';
import { promoteReadyBatches } from './db/stock-repo.ts';
import { requestPersistentStorage } from './lib/storage.ts';
import './index.css';

// iOS can evict IndexedDB. Ask for durable storage on first launch; never block on it.
void requestPersistentStorage();

// First launch loads the catalog. Deliberately not awaited: the shell renders
// immediately and useLiveQuery picks the rows up the moment they land.
void ensureSeeded();
void ensureDeviceId();
// Bring finished steeps' stored state into line. Reads already treat them as
// ready; this runs once per launch, never on a timer.
void promoteReadyBatches();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
