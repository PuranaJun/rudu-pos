import { useEffect, useState } from 'react';
import { shareFile, type ShareOutcome } from '../lib/share.ts';

interface Props {
  label: string;
  /** Builds the file. Run as soon as the button appears, not on the tap. */
  build: () => Promise<File>;
  /** Rebuild when this changes — the year of a CSV, say. */
  buildKey?: string;
  onDone?: (outcome: Exclude<ShareOutcome, 'cancelled'>) => void;
  tone?: 'primary' | 'plain';
}

/**
 * One tap to the share sheet.
 *
 * The file is built when the button appears, so the tap goes straight to
 * `navigator.share`. iOS only opens the share sheet from a user gesture, and
 * reading the whole database first could outlast it and get the share
 * refused.
 */
export default function ShareFileButton({
  label,
  build,
  buildKey = '',
  onDone,
  tone = 'primary',
}: Props) {
  // Tagged with the key it was built for, so a file for last year's CSV is
  // never handed out once the year has changed.
  const [built, setBuilt] = useState<{ key: string; file: File } | null>(null);
  const file = built?.key === buildKey ? built.file : null;
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    build().then(
      (made) => {
        if (current) setBuilt({ key: buildKey, file: made });
      },
      (cause: unknown) => {
        if (current) setError(`เตรียมไฟล์ไม่สำเร็จ: ${String(cause)}`);
      },
    );
    return () => {
      current = false;
    };
    // `build` is recreated each render; `buildKey` says when the file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildKey]);

  function tap() {
    if (!file) return;
    shareFile(file).then(
      (outcome) => {
        if (outcome === 'cancelled') return;
        setState('done');
        onDone?.(outcome);
      },
      (cause: unknown) => {
        setState('failed');
        setError(`ส่งไฟล์ไม่สำเร็จ: ${String(cause)}`);
      },
    );
  }

  const styles =
    tone === 'primary' ? 'bg-brand-2 border-brand-2 text-white' : 'border-line text-ink bg-white';

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={tap}
        disabled={!file}
        className={`min-h-touch-lg w-full rounded-2xl border-2 px-4 text-xl font-bold disabled:bg-paper-sunk disabled:text-ink-soft disabled:border-line ${styles}`}
      >
        {file ? (state === 'done' ? `${label} แล้ว ✓` : label) : 'กำลังเตรียมไฟล์…'}
      </button>
      {error ? (
        <p role="alert" className="mt-2 text-lg font-bold">
          {error}
        </p>
      ) : null}
    </div>
  );
}
