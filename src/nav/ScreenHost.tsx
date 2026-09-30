import MenuHubScreen from '../screens/MenuHubScreen.tsx';
import SalesListScreen from '../screens/SalesListScreen.tsx';
import ProductionScreen from '../screens/ProductionScreen.tsx';
import ReportsScreen from '../screens/ReportsScreen.tsx';
import SettingsScreen from '../screens/SettingsScreen.tsx';
import CloseDayScreen from '../screens/CloseDayScreen.tsx';
import type { BackTo } from '../components/Screen.tsx';
import type { CashSession } from '../db/types.ts';
import { homeLabel, useNav } from './nav-store.ts';

/**
 * The one screen open over home, if any. Rendered once, beside the home
 * screen, so it stays put when home changes underneath it — restoring a
 * backup from settings does not throw the operator out of settings.
 *
 * Every screen here gets the same way out: straight home, named for where
 * home is.
 */
export default function ScreenHost({ session }: { session: CashSession | null }) {
  const route = useNav((state) => state.route);
  const home = useNav((state) => state.home);
  const dayClosed = useNav((state) => state.dayClosed);

  const back: BackTo = { label: homeLabel(session !== null), onClick: home };

  switch (route) {
    case null:
      return null;
    case 'HUB':
      return <MenuHubScreen session={session} back={back} />;
    case 'SALES':
      return session ? <SalesListScreen session={session} back={back} /> : null;
    case 'PRODUCTION':
      return <ProductionScreen back={back} />;
    case 'REPORTS':
      return <ReportsScreen back={back} />;
    case 'SETTINGS':
      return <SettingsScreen back={back} />;
    case 'CLOSE_DAY':
      return session ? <CloseDayScreen session={session} back={back} onClosed={dayClosed} /> : null;
  }
}
