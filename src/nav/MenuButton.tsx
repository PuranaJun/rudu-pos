import { Button } from '../components/Button.tsx';
import { useNav } from './nav-store.ts';

/**
 * The one door to everything that is not selling or opening the day: the
 * day's bills, production, reports, settings, backup, closing the day.
 * Labelled in words — an icon alone is a guess in direct sun.
 */
export default function MenuButton() {
  const open = useNav((state) => state.open);
  return (
    <Button variant="secondary" size="md" onClick={() => open('HUB')} className="shrink-0">
      <span aria-hidden="true">☰ </span>เมนู
    </Button>
  );
}
