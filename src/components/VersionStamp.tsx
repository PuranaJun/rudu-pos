import { useRef, useState } from 'react';
import { formatBangkok } from '../lib/datetime.ts';
import { resetAndReseed } from '../db/seed.ts';
import { stockSampleDay } from '../db/sample-day.ts';

const LONG_PRESS_MS = 1500;

/**
 * The build timestamp, so a deploy is visible on the phone.
 *
 * In a DEV build a long press reseeds the database and stocks a sample
 * morning, uncut jelly and all. This is the one place a
 * long press is acceptable: it is a developer affordance, not an operator
 * path, and it is deliberately hard to hit by accident with wet hands.
 */
export default function VersionStamp() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'failed'>('idle');

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
      if (!window.confirm('ล้างฐานข้อมูล แล้วโหลดข้อมูลตั้งต้นกับสต็อกตัวอย่าง?')) return;
      setStatus('working');
      resetAndReseed()
        .then(() => stockSampleDay())
        .then(
          () => setStatus('done'),
          () => setStatus('failed'),
        );
    }, LONG_PRESS_MS);
  };

  const label = {
    idle: null,
    working: 'กำลังโหลดข้อมูลตั้งต้น…',
    done: 'โหลดข้อมูลตั้งต้นใหม่แล้ว',
    failed: 'ล้างฐานข้อมูลไม่สำเร็จ',
  }[status];

  return (
    <p
      className="text-ink-soft text-base font-semibold"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      build <time dateTime={__BUILD_TIME__}>{formatBangkok(__BUILD_TIME__)}</time>
      {label ? <span className="text-ink block">{label}</span> : null}
    </p>
  );
}
