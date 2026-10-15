import { useState } from 'react';
import { Button } from './Button.tsx';
import { Screen, ScreenBody, ScreenFooter, type BackTo } from './Screen.tsx';
import { PIN_MAX_LENGTH, pinMatches } from '../db/owner-pin.ts';
import { useNav } from '../nav/nav-store.ts';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * The owner's PIN pad, in front of whatever the staff should not see.
 *
 * Its own keys, at the bottom in thumb reach: no phone keyboard over half the
 * screen, no password manager offering to save it. The right PIN opens the
 * moment its last digit goes in; ตกลง is there to say a wrong one is wrong.
 */
export default function OwnerLockScreen({
  pin,
  purpose,
  back,
}: {
  /** The stored PIN record. */
  pin: string;
  /** What it opens, in words: "เปิดตั้งค่า". */
  purpose: string;
  back: BackTo;
}) {
  const unlock = useNav((state) => state.unlockOwner);
  const [typed, setTyped] = useState('');
  const [wrong, setWrong] = useState(false);

  function press(digit: string) {
    if (typed.length >= PIN_MAX_LENGTH) return;
    const next = typed + digit;
    setTyped(next);
    setWrong(false);
    void pinMatches(pin, next).then((match) => {
      if (match) unlock();
    });
  }

  function check() {
    void pinMatches(pin, typed).then((match) => {
      if (match) {
        unlock();
        return;
      }
      setWrong(true);
      setTyped('');
    });
  }

  return (
    <Screen title="รหัสเจ้าของ" subtitle={purpose}>
      <ScreenBody className="flex flex-col">
        <p className="mt-4 text-center text-4xl font-bold" aria-live="polite">
          <span aria-hidden="true" className="tracking-[0.3em]">
            {typed.length > 0 ? '●'.repeat(typed.length) : '–'}
          </span>
          <span className="sr-only">ใส่แล้ว {typed.length} ตัว</span>
        </p>
        {wrong ? (
          <p
            role="alert"
            className="bg-expired mt-3 rounded-xl px-4 py-3 text-center text-xl font-bold text-white"
          >
            รหัสไม่ถูก — ลองใหม่
          </p>
        ) : null}

        <div role="group" aria-label="ปุ่มตัวเลข" className="mt-auto grid grid-cols-3 gap-3 pt-4">
          {DIGITS.map((digit) => (
            <Button
              key={digit}
              variant="secondary"
              size="xl"
              onClick={() => press(digit)}
              className="w-full tabular-nums"
            >
              {digit}
            </Button>
          ))}
          <Button
            variant="secondary"
            size="xl"
            disabled={typed.length === 0}
            onClick={() => setTyped(typed.slice(0, -1))}
            className="w-full"
          >
            ลบ
          </Button>
          <Button
            variant="secondary"
            size="xl"
            onClick={() => press('0')}
            className="w-full tabular-nums"
          >
            0
          </Button>
          <Button
            variant="primary"
            size="xl"
            disabled={typed.length === 0}
            onClick={check}
            className="w-full"
          >
            ตกลง
          </Button>
        </div>
      </ScreenBody>
      <ScreenFooter back={back} />
    </Screen>
  );
}
