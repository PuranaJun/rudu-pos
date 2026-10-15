import { useState } from 'react';
import BackupFileButton from './BackupFileButton.tsx';
import { formatBangkok } from '../lib/datetime.ts';
import { nowIso } from '../lib/id.ts';
import { useLastBackup, usePendingCount, useSyncState } from '../db/hooks.ts';
import { backupIsStale, lastSafeCopy } from '../db/backup.ts';

/**
 * Where the records are safe besides this phone, and one tap to save a file
 * (CLAUDE.md §13). Loud only when nothing has been safe elsewhere for too
 * long:
 *
 * - the shop phone with sync on is backed up by the cloud — current whenever
 *   nothing is waiting to go — so the staff are not nagged about a file;
 * - a view-only phone shows how fresh its copy is, and saves it as a file;
 * - a phone without sync holds the only copy, and the file is its backup.
 *
 * The file carries every cost: with an owner PIN set it is the owner's to send.
 */
export default function BackupCard({
  label = 'บันทึกไฟล์สำรอง',
  backLabel = 'กลับไปเมนู',
}: {
  label?: string;
  /** Where the PIN pad's back button goes, when the card is locked. */
  backLabel?: string;
}) {
  const lastBackup = useLastBackup();
  const sync = useSyncState();
  const pending = usePendingCount();
  // Judged against when the card appeared; nothing here needs to tick.
  const [shownAt] = useState(nowIso);

  if (lastBackup === undefined || sync === undefined || pending === undefined) {
    return <p className="bg-paper-sunk rounded-xl px-4 py-3 text-lg font-bold">…</p>;
  }

  const shop = sync.mode === 'SHOP';
  const safe = lastSafeCopy(
    lastBackup,
    shop ? { lastSent: sync.lastSent, pending } : null,
    shownAt,
  );
  const stale = backupIsStale(safe, Date.parse(shownAt));

  return (
    <div>
      <p
        className={`rounded-xl px-4 py-3 text-lg font-bold ${stale ? 'bg-today' : 'bg-paper-sunk'}`}
      >
        {shop ? (
          <span className="block">
            {pending === 0
              ? 'ข้อมูลอยู่บนคลาวด์ครบแล้ว'
              : `รอส่งขึ้นคลาวด์ ${pending} รายการ${
                  sync.lastSent ? ` · ส่งล่าสุด ${formatBangkok(sync.lastSent)}` : ''
                }`}
          </span>
        ) : sync.mode === 'VIEWER' ? (
          <span className="block">
            ข้อมูลถึง {sync.lastFetched ? formatBangkok(sync.lastFetched) : '—'}
          </span>
        ) : null}
        {/* Waiting with a reason is not the same as waiting for signal: say which. */}
        {shop && pending > 0 && sync.error ? (
          <span className="block">ส่งครั้งล่าสุดไม่สำเร็จ: {sync.error}</span>
        ) : null}
        <span className="block">
          {lastBackup === null
            ? shop
              ? 'ยังไม่เคยสำรองเป็นไฟล์'
              : 'ยังไม่เคยสำรองข้อมูล'
            : `สำรองล่าสุด ${formatBangkok(lastBackup)}`}
        </span>
      </p>
      <div className="mt-2">
        <BackupFileButton
          label={label}
          backLabel={backLabel}
          tone={stale ? 'primary' : 'plain'}
          // A view-only phone's copy moves with each update: the file follows it.
          buildKey={sync.lastFetched ?? ''}
        />
      </div>
    </div>
  );
}
