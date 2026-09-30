import { useState } from 'react';
import ShareFileButton from './ShareFileButton.tsx';
import { formatBangkok } from '../lib/datetime.ts';
import { useLastBackup } from '../db/hooks.ts';
import { backupAsFile, backupIsStale, markBackedUp } from '../db/backup.ts';

/**
 * When the records last left the phone, and one tap to send them again
 * (CLAUDE.md §13). Loud when it has been too long: this phone holds the only
 * copy, and iOS can evict it.
 */
export default function BackupCard({ label = 'บันทึกไฟล์สำรอง' }: { label?: string }) {
  const lastBackup = useLastBackup();
  // Judged against when the card appeared; nothing here needs to tick.
  const [shownAt] = useState(() => Date.now());
  const stale = lastBackup !== undefined && backupIsStale(lastBackup, shownAt);

  return (
    <div>
      <p
        className={`rounded-xl px-4 py-3 text-lg font-bold ${stale ? 'bg-today' : 'bg-paper-sunk'}`}
      >
        {lastBackup === undefined
          ? '…'
          : lastBackup === null
            ? 'ยังไม่เคยสำรองข้อมูล'
            : `สำรองล่าสุด ${formatBangkok(lastBackup)}`}
      </p>
      <div className="mt-2">
        <ShareFileButton
          label={label}
          build={() => backupAsFile()}
          onDone={() => void markBackedUp()}
          tone={stale ? 'primary' : 'plain'}
        />
      </div>
    </div>
  );
}
