/**
 * Stands in for `virtual:pwa-register/react` under test, where there is no
 * service worker and the plugin's virtual module does not resolve. Reports no
 * update waiting; tests that care about the toast mock useUpdateReady.
 */
import { useState } from 'react';

export function useRegisterSW() {
  return {
    needRefresh: useState(false),
    offlineReady: useState(false),
    updateServiceWorker: async () => {},
  };
}
