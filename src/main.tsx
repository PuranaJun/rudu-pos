import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ensureSeeded } from './db/seed.ts';
import { requestPersistentStorage } from './lib/storage.ts';
import './index.css';

// iOS can evict IndexedDB. Ask for durable storage on first launch; never block on it.
void requestPersistentStorage();

// First launch loads the catalog. Deliberately not awaited: the shell renders
// immediately and useLiveQuery picks the rows up the moment they land.
void ensureSeeded();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
