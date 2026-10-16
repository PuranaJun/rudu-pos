import { useEffect, useRef } from 'react';

/** The history entry the open pages share, so the back gesture has something to undo. */
const MARK = 'rudu-page';

function ours(state: unknown): boolean {
  return typeof state === 'object' && state !== null && (state as { rudu?: unknown }).rudu === MARK;
}

/** Open pages, bottom first. Only the top one hears the back gesture. */
const open: { current: () => void }[] = [];
let listening = false;

/** One entry of ours on top of the history, or none to add if there is one already. */
function ensureEntry(): void {
  if (!ours(window.history.state)) window.history.pushState({ rudu: MARK }, '');
}

function onPop(): void {
  open[open.length - 1]?.current();
}

/**
 * Android's back gesture (or button) does what the page's own back button
 * does, instead of leaving the app.
 *
 * The app has no URLs: every page over home is React state. Without a history
 * entry of its own, a back gesture anywhere closes the whole app — the data
 * survives, but the operator lands on the phone's home screen mid-task. So
 * while a page is open there is one entry of ours on top of the history, and a
 * back gesture pops it and goes back from the top page only: a receipt opened
 * from the day's bills goes back to the bills, not out of both. When a page
 * closes that way and one is still open beneath it, the entry goes back on
 * for that one.
 *
 * Closed by its own button, the page leaves the entry where it is and the next
 * page reuses it, so history never grows past one extra step. Taking it off
 * with history.back() would race the next page's own entry — and React's
 * development double-mount, which opens a page twice. The cost is that one back
 * gesture at home, after such a close, does nothing: the harmless direction to
 * be wrong in.
 *
 * `null` registers nothing: a footer with no way back. A listener, never a
 * timer (CLAUDE.md §1).
 */
export function useBackGesture(onBack: (() => void) | null | undefined): void {
  const latest = useRef(onBack);
  useEffect(() => {
    latest.current = onBack;
  });

  const active = Boolean(onBack);
  useEffect(() => {
    if (!active) return;
    const page = { current: () => latest.current?.() };
    open.push(page);
    if (!listening) {
      window.addEventListener('popstate', onPop);
      listening = true;
    }
    ensureEntry();

    return () => {
      open.splice(open.indexOf(page), 1);
      // Closed by a back gesture with a page still open beneath: that one
      // needs an entry of its own for the next gesture.
      if (open.length > 0) ensureEntry();
    };
  }, [active]);
}
