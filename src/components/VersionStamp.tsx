import { useRef, useState } from 'react';
import { formatBangkok } from '../lib/datetime.ts';
import { useOfflineReady } from '../lib/useOfflineReady.ts';
import DevMenu from './DevMenu.tsx';

const LONG_PRESS_MS = 1500;

/**
 * The build timestamp, so a deploy is visible on the phone.
 *
 * In a DEV build a long press opens the developer menu: reseed with a sample
 * morning, generate a sample week, audit the books. This is the one place a
 * long press is acceptable: it is a developer affordance, not an operator
 * path, and it is deliberately hard to hit by accident with wet hands.
 */
export default function VersionStamp() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState(false);
  // Visible proof, once installed, that the shell will cold-start in airplane mode.
  const offline = useOfflineReady();

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const start = () => {
    if (!import.meta.env.DEV) return;
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      setMenu(true);
    }, LONG_PRESS_MS);
  };

  return (
    <>
      <p
        className="text-ink-soft text-base font-bold"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        build <time dateTime={__BUILD_TIME__}>{formatBangkok(__BUILD_TIME__)}</time>
        {offline ? ' · พร้อมใช้ออฟไลน์' : ''}
      </p>
      {import.meta.env.DEV && menu ? <DevMenu onClose={() => setMenu(false)} /> : null}
    </>
  );
}
