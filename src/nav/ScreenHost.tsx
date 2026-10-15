import MenuHubScreen from '../screens/MenuHubScreen.tsx';
import SalesListScreen from '../screens/SalesListScreen.tsx';
import QueueScreen from '../screens/QueueScreen.tsx';
import DrawerScreen from '../screens/DrawerScreen.tsx';
import SoldOutScreen from '../screens/SoldOutScreen.tsx';
import PurchasingScreen from '../screens/PurchasingScreen.tsx';
import ProductionScreen from '../screens/ProductionScreen.tsx';
import ReportsScreen from '../screens/ReportsScreen.tsx';
import SettingsScreen from '../screens/SettingsScreen.tsx';
import CloseDayScreen from '../screens/CloseDayScreen.tsx';
import OwnerLockScreen from '../components/OwnerLockScreen.tsx';
import type { BackTo } from '../components/Screen.tsx';
import type { CashSession } from '../db/types.ts';
import { homeLabel, useNav } from './nav-store.ts';
import { OWNER_ROUTES, useOwnerLock } from './owner-lock.ts';

/**
 * The one screen open over home, if any. Rendered once, beside the home
 * screen, so it stays put when home changes underneath it — restoring a
 * backup from settings does not throw the operator out of settings.
 *
 * Every screen here gets the same way out: straight home, named for where
 * home is. The owner's screens wait behind the PIN pad when a PIN is set,
 * whichever way they were opened.
 */
export default function ScreenHost({ session }: { session: CashSession | null }) {
  const route = useNav((state) => state.route);
  const home = useNav((state) => state.home);
  const dayClosed = useNav((state) => state.dayClosed);

  const lock = useOwnerLock();

  const back: BackTo = { label: homeLabel(session !== null), onClick: home };

  const ownerScreen = route === null ? undefined : OWNER_ROUTES[route];
  if (ownerScreen !== undefined && !lock.open) {
    // Loading: nothing yet, rather than a flash of the costs behind the lock.
    return lock.pin ? (
      <OwnerLockScreen pin={lock.pin} purpose={`เปิด${ownerScreen}`} back={back} />
    ) : null;
  }

  switch (route) {
    case null:
      return null;
    case 'HUB':
      return <MenuHubScreen session={session} back={back} />;
    case 'SALES':
      return session ? <SalesListScreen session={session} back={back} /> : null;
    case 'QUEUE':
      return session ? <QueueScreen session={session} back={back} /> : null;
    case 'DRAWER':
      return session ? <DrawerScreen session={session} back={back} /> : null;
    case 'SOLD_OUT':
      return session ? <SoldOutScreen session={session} back={back} /> : null;
    case 'PRODUCTION':
      return <ProductionScreen back={back} />;
    case 'PURCHASING':
      return <PurchasingScreen back={back} />;
    case 'REPORTS':
      return <ReportsScreen back={back} />;
    case 'SETTINGS':
      return <SettingsScreen back={back} />;
    case 'CLOSE_DAY':
      return session ? <CloseDayScreen session={session} back={back} onClosed={dayClosed} /> : null;
  }
}
