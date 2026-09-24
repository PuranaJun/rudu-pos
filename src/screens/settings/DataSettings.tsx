import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ShareFileButton from '../../components/ShareFileButton.tsx';
import { Choice } from '../../components/form.tsx';
import { formatTHB } from '../../lib/money.ts';
import { formatBangkok } from '../../lib/datetime.ts';
import { revenuePeriods } from '../../domain/sales-csv.ts';
import { db } from '../../db/database.ts';
import { useLastBackup } from '../../db/hooks.ts';
import {
  BackupError,
  backupAsFile,
  describeBackup,
  loadSalesForYear,
  loadSalesYears,
  markBackedUp,
  parseBackup,
  restoreBackup,
  salesCsvFile,
  type BackupFile,
} from '../../db/backup.ts';

const DAY = 86_400_000;

/**
 * The data (CLAUDE.md §13): this phone holds the only copy of the business's
 * records, and a backup is what keeps them alive.
 */
export default function DataSettings() {
  return (
    <div className="pb-6">
      <BackupSection />
      <TaxSection />
      <RestoreSection />
    </div>
  );
}

function BackupSection() {
  const lastBackup = useLastBackup();
  // Judged against when the screen opened; nothing here needs to tick.
  const [openedAt] = useState(() => Date.now());
  const stale =
    lastBackup === null ||
    (lastBackup !== undefined && openedAt - Date.parse(lastBackup) > 2 * DAY);

  return (
    <section aria-label="สำรองข้อมูล" className="pt-4">
      <h2 className="text-2xl font-bold">สำรองข้อมูล</h2>
      <p
        className={`mt-2 rounded-xl px-4 py-3 text-lg font-bold ${stale ? 'bg-today' : 'bg-paper-sunk'}`}
      >
        {lastBackup === undefined
          ? '…'
          : lastBackup === null
            ? 'ยังไม่เคยสำรองข้อมูล'
            : `สำรองล่าสุด ${formatBangkok(lastBackup)}`}
      </p>
      <p className="mt-2 text-lg font-bold">
        ทุกอย่างในเครื่องเป็นไฟล์เดียว — ส่งไป iCloud Drive, Files หรือ LINE
      </p>
      <div className="mt-3">
        <ShareFileButton
          label="บันทึกไฟล์สำรอง"
          build={() => backupAsFile()}
          onDone={() => void markBackedUp()}
        />
      </div>
    </section>
  );
}

/**
 * The figures for the personal income tax filing, and the sales behind them.
 * Revenue only: no tax is calculated, no expense is claimed (CLAUDE.md §5).
 */
function TaxSection() {
  const years = useLiveQuery(() => loadSalesYears(db), []);
  const [picked, setPicked] = useState<string | null>(null);
  const year = picked ?? years?.[0] ?? null;
  const periods = useLiveQuery(
    async () => (year ? revenuePeriods((await loadSalesForYear(year, db)).sales, year) : null),
    [year],
  );

  if (!years || !year) return null;
  const buddhist = (value: string) => String(Number(value) + 543);

  return (
    <section aria-label="ยอดขายสำหรับยื่นภาษี" className="pt-8">
      <h2 className="text-2xl font-bold">ยอดขายสำหรับยื่นภาษี</h2>
      <Choice
        label="ปี"
        value={year}
        options={years.map((value) => [value, buddhist(value)] as const)}
        onChange={setPicked}
      />
      {periods ? (
        <dl className="mt-3 text-lg font-bold">
          <div className="border-line flex justify-between border-b py-2">
            <dt>ม.ค.–มิ.ย. (ภ.ง.ด.94)</dt>
            <dd className="tabular-nums">{formatTHB(periods.firstHalf)}</dd>
          </div>
          <div className="border-line flex justify-between border-b py-2 text-xl">
            <dt>ทั้งปี (ภ.ง.ด.90)</dt>
            <dd className="tabular-nums">{formatTHB(periods.year)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="mt-2 text-lg font-bold">ยอดขายเท่านั้น ไม่รวมบิลที่ยกเลิก — แอปไม่คำนวณภาษี</p>
      <div className="mt-3">
        <ShareFileButton
          label={`ส่งออก CSV ปี ${buddhist(year)}`}
          build={() => salesCsvFile(year)}
          buildKey={year}
          tone="plain"
        />
      </div>
    </section>
  );
}

function RestoreSection() {
  const [pending, setPending] = useState<BackupFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);

  const summary = pending ? describeBackup(pending) : null;

  return (
    <section aria-label="กู้คืนข้อมูล" className="pt-8">
      <h2 className="text-2xl font-bold">กู้คืนจากไฟล์สำรอง</h2>

      {restored ? (
        <p
          role="status"
          className="bg-brand-2 mt-2 rounded-xl px-4 py-3 text-lg font-bold text-white"
        >
          กู้คืนข้อมูลแล้ว
        </p>
      ) : null}

      {!pending ? (
        <label className="border-ink min-h-touch-lg mt-3 flex w-full items-center justify-center rounded-2xl border-2 text-xl font-bold">
          เลือกไฟล์สำรอง
          <input
            type="file"
            accept="application/json,.json"
            aria-label="ไฟล์สำรองข้อมูล"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setRestored(false);
              file
                .text()
                .then((text) => {
                  setPending(parseBackup(text));
                  setError(null);
                })
                .catch((cause: unknown) =>
                  setError(
                    cause instanceof BackupError
                      ? cause.message
                      : `อ่านไฟล์ไม่สำเร็จ: ${String(cause)}`,
                  ),
                );
            }}
          />
        </label>
      ) : (
        <div
          role="alertdialog"
          aria-label="ยืนยันการกู้คืน"
          className="border-expired mt-3 rounded-2xl border-4 p-4"
        >
          <p className="text-xl font-bold">ข้อมูลทั้งหมดในเครื่องนี้จะถูกแทนที่ด้วยไฟล์นี้</p>
          <p className="text-lg font-bold">
            ยอดขาย สต็อก และการตั้งค่าตอนนี้จะหายไป ย้อนกลับไม่ได้
          </p>
          {summary ? (
            <dl className="bg-paper-sunk mt-3 rounded-xl px-4 py-2 text-lg font-bold">
              <div className="flex justify-between">
                <dt>สำรองเมื่อ</dt>
                <dd>{formatBangkok(summary.exportedAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>บิล</dt>
                <dd className="tabular-nums">{summary.sales}</dd>
              </div>
              <div className="flex justify-between">
                <dt>วันขาย</dt>
                <dd className="tabular-nums">{summary.days}</dd>
              </div>
            </dl>
          ) : null}

          <p className="mt-3 text-lg font-bold">
            ถ้าไม่แน่ใจ สำรองข้อมูลที่อยู่ในเครื่องตอนนี้ไว้ก่อน
          </p>
          <div className="mt-2">
            <ShareFileButton
              label="สำรองข้อมูลตอนนี้ก่อน"
              build={() => backupAsFile()}
              onDone={() => void markBackedUp()}
              tone="plain"
            />
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="border-line min-h-touch-lg rounded-2xl border-2 px-5 text-xl font-bold"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                restoreBackup(pending)
                  .then(() => {
                    setPending(null);
                    setRestored(true);
                  })
                  .catch((cause: unknown) => setError(`กู้คืนไม่สำเร็จ: ${String(cause)}`))
                  .finally(() => setBusy(false));
              }}
              className="bg-expired min-h-touch-lg flex-1 rounded-2xl text-xl font-bold text-white disabled:bg-paper-sunk disabled:text-ink-soft"
            >
              แทนที่ข้อมูลในเครื่อง
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="bg-today mt-3 rounded-xl px-4 py-3 text-lg font-bold">
          {error}
        </p>
      ) : null}
    </section>
  );
}
