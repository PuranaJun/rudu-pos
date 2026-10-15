import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import ShareFileButton from '../../components/ShareFileButton.tsx';
import SyncPanel from '../../components/SyncPanel.tsx';
import BackupCard from '../../components/BackupCard.tsx';
import BackupFileButton from '../../components/BackupFileButton.tsx';
import { Choice, ListPage, TextField } from '../../components/form.tsx';
import { Button } from '../../components/Button.tsx';
import { buttonClass } from '../../components/button.ts';
import type { BackTo } from '../../components/Screen.tsx';
import { formatTHB } from '../../lib/money.ts';
import { formatBangkok } from '../../lib/datetime.ts';
import { revenuePeriods } from '../../domain/sales-csv.ts';
import { db } from '../../db/database.ts';
import {
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  clearOwnerPin,
  isValidPin,
  setOwnerPin,
} from '../../db/owner-pin.ts';
import { useOwnerLock } from '../../nav/owner-lock.ts';
import { useNav } from '../../nav/nav-store.ts';
import {
  BackupError,
  describeBackup,
  loadSalesForYear,
  loadSalesYears,
  parseBackup,
  restoreBackup,
  salesCsvFile,
  type BackupFile,
} from '../../db/backup.ts';

/**
 * The data (CLAUDE.md §13): where the business's records are kept safe —
 * the cloud for a shop phone that syncs, a backup file otherwise.
 */
export default function DataSettings({ exit }: { exit: BackTo }) {
  return (
    <ListPage exit={exit}>
      <BackupSection />
      <OwnerPinSection />
      <section aria-label="ซิงค์ออนไลน์" className="pt-8">
        <h2 className="text-2xl font-bold">ซิงค์ออนไลน์</h2>
        <SyncPanel />
      </section>
      <TaxSection />
      <RestoreSection />
    </ListPage>
  );
}

function BackupSection() {
  return (
    <section aria-label="สำรองข้อมูล" className="pt-4">
      <h2 className="text-2xl font-bold">สำรองข้อมูล</h2>
      <p className="mt-2 text-lg font-bold">
        ทุกอย่างในเครื่องเป็นไฟล์เดียว รวมต้นทุน — เก็บไว้ที่ของเจ้าของเท่านั้น อย่าส่งเข้ากลุ่ม
        LINE ที่พนักงานอยู่
      </p>
      <div className="mt-3">
        <BackupCard />
      </div>
    </section>
  );
}

/**
 * The owner's PIN (owner-pin.ts). Set, the staff sell exactly as before but
 * see no cost or profit, and settings, reports, purchasing and the backup
 * file wait behind it. There is no reset, so it is typed twice and the
 * screen says so before it is saved.
 */
function OwnerPinSection() {
  const lock = useOwnerLock();
  const unlock = useNav((state) => state.unlockOwner);
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [removing, setRemoving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (lock.pin === undefined) return null;
  const formOpen = !lock.pinSet || editing;

  function save() {
    setDone(null);
    if (!isValidPin(pin)) {
      setError(`รหัสต้องเป็นตัวเลข ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} ตัว`);
      return;
    }
    if (pin !== again) {
      setError('รหัสสองช่องไม่ตรงกัน');
      return;
    }
    // This visit stays open: setting the PIN must not lock the owner out of
    // the very screen it is being set on.
    unlock();
    setOwnerPin(pin)
      .then(() => {
        setPin('');
        setAgain('');
        setEditing(false);
        setError(null);
        setDone('ตั้งรหัสแล้ว');
      })
      .catch((cause: unknown) => setError(`ตั้งรหัสไม่สำเร็จ: ${String(cause)}`));
  }

  function remove() {
    setRemoving(false);
    setDone(null);
    clearOwnerPin()
      .then(() => setDone('เอารหัสออกแล้ว'))
      .catch((cause: unknown) => setError(`เอารหัสออกไม่สำเร็จ: ${String(cause)}`));
  }

  return (
    <section aria-label="รหัสเจ้าของ" className="pt-8">
      <h2 className="text-2xl font-bold">รหัสเจ้าของ</h2>
      <p className="mt-2 text-lg font-bold">
        {lock.pinSet
          ? 'ตั้งรหัสแล้ว — พนักงานขายได้ตามปกติ แต่ไม่เห็นต้นทุนและกำไร เปิดตั้งค่า รายงาน สั่งของ และส่งไฟล์สำรองไม่ได้'
          : 'ยังไม่ได้ตั้งรหัส — ทุกคนที่ใช้เครื่องนี้เห็นต้นทุนและกำไร'}
      </p>

      {done ? (
        <p
          role="status"
          className="bg-brand-2 mt-2 rounded-xl px-4 py-3 text-lg font-bold text-white"
        >
          {done}
        </p>
      ) : null}

      {formOpen ? (
        <>
          <TextField
            label="รหัสใหม่"
            value={pin}
            onChange={setPin}
            inputMode="numeric"
            hint={`ตัวเลข ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} ตัว`}
          />
          <TextField
            label="ใส่รหัสใหม่อีกครั้ง"
            value={again}
            onChange={setAgain}
            inputMode="numeric"
          />
          <p className="bg-today mt-3 rounded-xl px-4 py-3 text-lg font-bold">
            ลืมรหัสแล้วตั้งใหม่ไม่ได้ — ตั้งค่า รายงาน สั่งของ
            และสำรองข้อมูลบนเครื่องนี้จะเปิดไม่ได้อีก จดรหัสเก็บไว้ที่ปลอดภัย
          </p>
          <div className="mt-3 flex gap-2">
            {editing ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setPin('');
                  setAgain('');
                  setError(null);
                }}
                className="flex-1"
              >
                ไม่เปลี่ยน
              </Button>
            ) : null}
            <Button variant="primary" onClick={save} className="flex-[1.4]">
              {editing ? 'เปลี่ยนรหัส' : 'ตั้งรหัส'}
            </Button>
          </div>
        </>
      ) : removing ? (
        <div
          role="alertdialog"
          aria-label="ยืนยันเอารหัสออก"
          className="border-expired mt-3 rounded-2xl border-4 p-4"
        >
          <p className="text-xl font-bold">เอารหัสออกแล้ว ทุกคนจะเห็นต้นทุนและกำไร</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setRemoving(false)} className="flex-1">
              ไม่เอาออก
            </Button>
            <Button variant="danger" onClick={remove} className="flex-[1.4]">
              เอารหัสออก
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setDone(null);
              setEditing(true);
            }}
            className="flex-1"
          >
            เปลี่ยนรหัส
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setDone(null);
              setRemoving(true);
            }}
            className="flex-1"
          >
            เอารหัสออก
          </Button>
        </div>
      )}

      {error ? (
        <p
          role="alert"
          className="bg-expired mt-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
        >
          {error}
        </p>
      ) : null}
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
        <label
          className={`${buttonClass('secondary', 'md')} mt-3 flex w-full items-center justify-center`}
        >
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
            <BackupFileButton
              label="สำรองข้อมูลตอนนี้ก่อน"
              backLabel="กลับไปตั้งค่า"
              tone="plain"
            />
          </div>

          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setPending(null)} className="flex-1">
              ยกเลิก
            </Button>
            <Button
              variant="danger"
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
              className="flex-[1.6]"
            >
              แทนที่ข้อมูลในเครื่อง
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <p
          role="alert"
          className="bg-expired mt-3 rounded-xl px-4 py-3 text-lg font-bold text-white"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
