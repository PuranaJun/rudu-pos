import OpenDayScreen from './screens/OpenDayScreen.tsx';
import SellScreen from './screens/SellScreen.tsx';
import { useOpenSession } from './db/hooks.ts';

/**
 * No open session means the day has not started: open it first. Once it is
 * open the sell screen stays until the day is closed, through a crash, a flat
 * battery or a force-quit — the session and the cart are both in IndexedDB.
 */
export default function App() {
  const session = useOpenSession();

  if (session === undefined) {
    return (
      <div className="text-ink flex h-full items-center justify-center bg-white">
        <p className="text-2xl font-bold">กำลังโหลด…</p>
      </div>
    );
  }

  return session ? <SellScreen session={session} /> : <OpenDayScreen />;
}
