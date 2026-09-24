import { useState } from 'react';
import OpenDayScreen from './screens/OpenDayScreen.tsx';
import SellScreen from './screens/SellScreen.tsx';
import DaySummaryScreen from './screens/DaySummaryScreen.tsx';
import UpdateToast from './components/UpdateToast.tsx';
import { useCart, useOpenSession } from './db/hooks.ts';
import { useWakeLock } from './lib/useWakeLock.ts';

/**
 * No open session means the day has not started: open it first. Once it is
 * open the sell screen stays until the day is closed, through a crash, a flat
 * battery or a force-quit — the session and the cart are both in IndexedDB.
 * Closing the day shows its summary, then comes back round to open day.
 */
export default function App() {
  const session = useOpenSession();
  const cart = useCart();
  const [justClosed, setJustClosed] = useState<string | null>(null);

  // The screen stays on for as long as the day is open, and only then.
  useWakeLock(Boolean(session));

  // Offered only with an empty cart: switching versions reloads the page.
  const toast = <UpdateToast canApply={cart !== undefined && cart.length === 0} />;

  if (justClosed) {
    return (
      <>
        <DaySummaryScreen sessionId={justClosed} onDone={() => setJustClosed(null)} promptBackup />
        {toast}
      </>
    );
  }

  if (session === undefined) {
    return (
      <div className="text-ink flex h-full items-center justify-center bg-white">
        <p className="text-2xl font-bold">กำลังโหลด…</p>
      </div>
    );
  }

  return (
    <>
      {session ? <SellScreen session={session} onDayClosed={setJustClosed} /> : <OpenDayScreen />}
      {toast}
    </>
  );
}
