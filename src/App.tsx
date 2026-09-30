import OpenDayScreen from './screens/OpenDayScreen.tsx';
import SellScreen from './screens/SellScreen.tsx';
import DaySummaryScreen from './screens/DaySummaryScreen.tsx';
import ScreenHost from './nav/ScreenHost.tsx';
import { useNav } from './nav/nav-store.ts';
import { useOpenSession } from './db/hooks.ts';
import { useWakeLock } from './lib/useWakeLock.ts';

/**
 * Home is the sell screen while a day is open and the open-day screen when it
 * is not. The session decides which, from IndexedDB, so a crash, a flat
 * battery or a force-quit comes back to the right one with the cart intact.
 *
 * Everything else opens over home through the เมนู hub, one screen at a time
 * (ScreenHost). Closing the day shows its summary, then comes back round to
 * open day.
 */
export default function App() {
  const session = useOpenSession();
  const closedSessionId = useNav((state) => state.closedSessionId);
  const summaryDone = useNav((state) => state.summaryDone);

  // The screen stays on for as long as the day is open, and only then.
  useWakeLock(Boolean(session));

  if (closedSessionId) {
    return (
      <DaySummaryScreen
        sessionId={closedSessionId}
        back={{ label: 'กลับไปหน้าเปิดร้าน', onClick: summaryDone }}
        promptBackup
      />
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
      {session ? <SellScreen session={session} /> : <OpenDayScreen />}
      <ScreenHost session={session} />
    </>
  );
}
