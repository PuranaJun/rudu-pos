import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Whether a new version has been downloaded and is waiting, and the way to
 * switch to it.
 *
 * The new service worker waits (skipWaiting is off) until the operator says
 * so: the app is never swapped out from under a sale. The browser checks for
 * a new version when the app is opened — nothing here schedules a check.
 */
export function useUpdateReady(): { ready: boolean; apply: () => void } {
  const {
    needRefresh: [ready],
    updateServiceWorker,
  } = useRegisterSW();

  return { ready, apply: () => void updateServiceWorker(true) };
}
