import { useEffect, useRef } from 'react';

/** The history entry a page puts under itself, so the back gesture has something to undo. */
const MARK = 'rudu-page';

function ours(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { rudu?: unknown }).rudu === MARK;
}

/**
 * Android's back gesture (or button) closes the page this is called from,
 * instead of leaving the app.
 *
 * The app has no URLs: a page over the sell screen is React state. Without a
 * history entry of its own, a back gesture on the drink page closes the whole
 * app — the basket survives, but the operator lands on the home screen
 * mid-order. So the page puts one entry under itself while it is open, and a
 * back gesture pops that entry and closes the page.
 *
 * Closed any other way (ใส่ตะกร้า, ยกเลิก), the entry stays and the next page
 * reuses it rather than adding another, so history never grows past one extra
 * step. Taking it off with history.back() would race the next page's own
 * entry — and React's development double-mount, which opens a page twice. The
 * cost is that one back gesture on the sell screen, after such a close, does
 * nothing: the harmless direction to be wrong in.
 *
 * A listener, never a timer (CLAUDE.md §1).
 */
export function useBackGesture(onBack: () => void): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });

  useEffect(() => {
    if (ours(window.history.state)) {
      window.history.replaceState({ rudu: MARK }, '');
    } else {
      window.history.pushState({ rudu: MARK }, '');
    }

    const onPop = () => latest.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}
