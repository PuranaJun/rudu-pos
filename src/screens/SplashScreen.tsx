import { formatBangkok } from '../lib/format.ts';
import { useOfflineReady } from '../lib/useOfflineReady.ts';

/**
 * Placeholder screen. Its only job is to prove a deploy landed on the phone:
 * the build timestamp changes on every build, and the offline badge says
 * whether the shell will survive airplane mode.
 */
export default function SplashScreen() {
  const offlineReady = useOfflineReady();

  return (
    <div className="safe-x bg-paper text-ink flex h-full flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight">ฤดูชา POS</h1>
        <p className="text-ink-soft text-lg font-semibold">ชาต้มเอง วันต่อวัน</p>
      </main>

      <footer className="safe-bottom safe-x border-line flex flex-col items-center gap-2 border-t px-6 pt-3 text-center">
        <p
          className={`rounded-full px-4 py-2 text-base font-bold ${
            offlineReady ? 'bg-brand-2 text-paper' : 'bg-paper-sunk text-ink'
          }`}
        >
          {offlineReady ? 'พร้อมใช้ออฟไลน์' : 'ยังไม่พร้อมออฟไลน์ — เปิดค้างไว้สักครู่'}
        </p>
        <p className="text-ink-soft text-base font-semibold">
          build <time dateTime={__BUILD_TIME__}>{formatBangkok(__BUILD_TIME__)}</time>
        </p>
      </footer>
    </div>
  );
}
