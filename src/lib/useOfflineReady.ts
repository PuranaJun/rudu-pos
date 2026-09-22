import { useEffect, useState } from 'react';

/**
 * True once a service worker is controlling this page, which is the point at
 * which the shell is genuinely cold-startable with no connectivity.
 *
 * Deliberately passive: no polling, no timers. It listens for the one event
 * that matters and then stops.
 */
export function useOfflineReady(): boolean {
  const [ready, setReady] = useState(() => Boolean(navigator.serviceWorker?.controller));

  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw || ready) return;

    const onChange = () => setReady(Boolean(sw.controller));
    sw.addEventListener('controllerchange', onChange);
    // The worker may finish installing between the first render and here.
    void sw.ready.then(onChange);

    return () => sw.removeEventListener('controllerchange', onChange);
  }, [ready]);

  return ready;
}
