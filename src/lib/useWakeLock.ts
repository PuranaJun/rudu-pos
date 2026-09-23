import { useEffect } from 'react';

/**
 * Hold the screen awake while the sell screen is open (CLAUDE.md §13).
 *
 * The phone locking itself between customers costs a tap and a passcode at
 * exactly the wrong moment. iOS drops the lock whenever the app is
 * backgrounded, so it is re-taken on the way back; there is no timer and no
 * polling, which is what keeps it cheap on battery.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (lock) => {
          if (cancelled) void lock.release();
          else sentinel = lock;
        },
        () => {
          // Denied in a background tab or on low battery. Not worth surfacing.
        },
      );
    };

    acquire();
    document.addEventListener('visibilitychange', acquire);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release();
    };
  }, []);
}
