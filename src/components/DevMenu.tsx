import { useState } from 'react';
import { resetAndReseed } from '../db/seed.ts';
import { stockSampleDay } from '../db/sample-day.ts';
import { generateSampleWeek } from '../db/sample-week.ts';
import { auditDatabase } from '../db/audit-repo.ts';
import type { Finding } from '../domain/audit.ts';

/**
 * Development only: reached by a long press on the build stamp in a DEV
 * build, and not at all in production. Everything destructive asks first.
 */
export default function DevMenu({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);

  function run(question: string | null, label: string, work: () => Promise<string>) {
    if (question && !window.confirm(question)) return;
    setStatus(label);
    setFindings(null);
    work().then(setStatus, (cause: unknown) => setStatus(`ไม่สำเร็จ: ${String(cause)}`));
  }

  const action = 'bg-ink min-h-touch-lg w-full rounded-2xl px-4 text-lg font-bold text-white';

  return (
    <div
      role="dialog"
      aria-label="เมนูนักพัฒนา"
      className="safe-x text-ink fixed inset-0 z-50 flex flex-col bg-white"
    >
      <header className="safe-top border-line border-b px-4 pb-2">
        <h1 className="text-2xl font-bold">เมนูนักพัฒนา</h1>
        <p className="text-ink-soft text-base font-bold">DEV build เท่านั้น</p>
      </header>

      <main className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <button
          type="button"
          className={action}
          onClick={() =>
            run('ล้างฐานข้อมูล แล้วโหลดข้อมูลตั้งต้นกับสต็อกเช้านี้?', 'กำลังโหลด…', async () => {
              await resetAndReseed();
              await stockSampleDay();
              return 'โหลดข้อมูลตั้งต้นและสต็อกเช้านี้แล้ว';
            })
          }
        >
          ล้าง + สต็อกเช้านี้
        </button>

        <button
          type="button"
          className={action}
          onClick={() =>
            run(
              'ล้างฐานข้อมูล แล้วสร้างข้อมูลตัวอย่าง 1 สัปดาห์?',
              'กำลังสร้าง 1 สัปดาห์…',
              async () => {
                await resetAndReseed();
                const week = await generateSampleWeek();
                return `สร้างแล้ว ${week.days} วัน ${week.sales} บิล`;
              },
            )
          }
        >
          ล้าง + สร้างข้อมูลตัวอย่าง 1 สัปดาห์
        </button>

        <button
          type="button"
          className={action}
          onClick={() =>
            run(null, 'กำลังตรวจ…', async () => {
              const found = await auditDatabase();
              setFindings(found);
              return found.length === 0 ? 'ตรวจแล้ว ไม่พบความผิดปกติ' : `พบ ${found.length} รายการ`;
            })
          }
        >
          ตรวจรายงาน
        </button>

        {status ? (
          <p role="status" className="bg-paper-sunk rounded-xl px-4 py-3 text-lg font-bold">
            {status}
          </p>
        ) : null}

        {findings && findings.length > 0 ? (
          <ul className="space-y-2">
            {findings.map((finding, index) => (
              <li key={index} className="bg-today rounded-xl px-3 py-2 text-base font-bold">
                {finding.check}: {finding.detail}
              </li>
            ))}
          </ul>
        ) : null}
      </main>

      <footer className="safe-bottom border-line border-t px-4 pt-3">
        <button
          type="button"
          onClick={onClose}
          className="border-line min-h-touch-lg w-full rounded-2xl border-2 text-xl font-bold"
        >
          ปิด
        </button>
      </footer>
    </div>
  );
}
