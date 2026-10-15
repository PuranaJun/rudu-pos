import { useState } from 'react';
import ShareFileButton from './ShareFileButton.tsx';
import OwnerOnly from './OwnerOnly.tsx';
import { backupAsFile, markBackedUp } from '../db/backup.ts';
import { sharesJsonFiles } from '../lib/share.ts';
import { useOwnerLock } from '../nav/owner-lock.ts';

/**
 * One tap to send the backup file. The file carries every cost, so with an
 * owner PIN set it is the owner's to send — and where this phone would
 * download it rather than share it (Chrome on Android), the owner is told
 * first that it will sit in Downloads, where the staff can open it.
 */
export default function BackupFileButton({
  label,
  backLabel,
  tone,
  buildKey,
}: {
  label: string;
  /** Where the PIN pad's back button goes, when it is locked. */
  backLabel: string;
  tone?: 'primary' | 'plain';
  /** Rebuild the file when this changes — the viewer's last update, say. */
  buildKey?: string;
}) {
  const lock = useOwnerLock();
  const [shares] = useState(sharesJsonFiles);

  return (
    <OwnerOnly label={label} backLabel={backLabel}>
      <ShareFileButton
        label={label}
        build={() => backupAsFile()}
        onDone={() => void markBackedUp()}
        tone={tone ?? 'primary'}
        buildKey={buildKey ?? ''}
      />
      {lock.pinSet && !shares ? (
        <p className="bg-today mt-2 rounded-xl px-4 py-3 text-lg font-bold">
          เครื่องนี้จะบันทึกไฟล์ไว้ในโฟลเดอร์ดาวน์โหลด — ใครถือเครื่องก็เปิดดูต้นทุนได้
          ย้ายไฟล์ออกแล้วลบทิ้ง หรือสำรองจากเครื่องของเจ้าของแทน
        </p>
      ) : null}
    </OwnerOnly>
  );
}
