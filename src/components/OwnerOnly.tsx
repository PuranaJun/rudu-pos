import { useId, useState, type ReactNode } from 'react';
import OwnerLockScreen from './OwnerLockScreen.tsx';
import { buttonClass } from './button.ts';
import { useOwnerLock } from '../nav/owner-lock.ts';

/**
 * An action only the owner may take — sending the backup file, which carries
 * every cost. Unlocked, it is just the action. Locked, it is a button that
 * says the PIN is needed and opens the pad; the action appears once the PIN
 * is in, for the owner to tap (iOS only opens a share sheet from a tap).
 */
export default function OwnerOnly({
  label,
  backLabel,
  children,
}: {
  /** The action, as the locked button names it: "สำรองข้อมูล". */
  label: string;
  /** Where the pad's back button goes: "กลับไปเมนู". */
  backLabel: string;
  children: ReactNode;
}) {
  const lock = useOwnerLock();
  const [asking, setAsking] = useState(false);
  const id = useId();

  if (lock.open) return <>{children}</>;
  // Loading: neither, so a quick tap never lands on a lock that is not there.
  if (!lock.pin) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-detail`}
        className={`${buttonClass('secondary', 'md')} flex w-full flex-col items-center justify-center py-2`}
      >
        <span id={`${id}-label`}>{label}</span>
        <span id={`${id}-detail`} className="text-ink-soft text-lg">
          ต้องใช้รหัสเจ้าของ
        </span>
      </button>
      {asking ? (
        <OwnerLockScreen
          pin={lock.pin}
          purpose={label}
          back={{ label: backLabel, onClick: () => setAsking(false) }}
        />
      ) : null}
    </>
  );
}
