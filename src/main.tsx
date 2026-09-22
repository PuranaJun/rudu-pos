import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { requestPersistentStorage } from './lib/storage.ts';
import './index.css';

// iOS can evict IndexedDB. Ask for durable storage on first launch; never block on it.
void requestPersistentStorage();

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
