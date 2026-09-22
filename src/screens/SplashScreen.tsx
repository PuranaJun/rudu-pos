import { useLiveQuery } from 'dexie-react-hooks';
import VersionStamp from '../components/VersionStamp.tsx';
import { db } from '../db/database.ts';
import { useOfflineReady } from '../lib/useOfflineReady.ts';

/**
 * Placeholder screen. Its only job is to prove that a deploy landed and that
 * the catalog is in IndexedDB on this device.
 */
export default function SplashScreen() {
  const offlineReady = useOfflineReady();
  const variantCount = useLiveQuery(() => db.variant.count(), [], null);

  return (
    <div className="safe-x bg-paper text-ink flex h-full flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-5xl font-bold tracking-tight">ฤดูชา POS</h1>
        <p className="text-ink-soft text-lg font-semibold">ชาต้มเอง วันต่อวัน</p>
        <p className="text-ink text-lg font-bold">
          {variantCount === null ? 'กำลังโหลดข้อมูล…' : `เมนู ${variantCount} รายการ`}
        </p>
      </main>

      <footer className="safe-bottom safe-x border-line flex flex-col items-center gap-2 border-t px-6 pt-3 text-center">
        <p
          className={`rounded-full px-4 py-2 text-base font-bold ${
            offlineReady ? 'bg-brand-2 text-paper' : 'bg-paper-sunk text-ink'
          }`}
        >
          {offlineReady ? 'พร้อมใช้ออฟไลน์' : 'ยังไม่พร้อมออฟไลน์ — เปิดค้างไว้สักครู่'}
        </p>
        <VersionStamp />
      </footer>
    </div>
  );
}
