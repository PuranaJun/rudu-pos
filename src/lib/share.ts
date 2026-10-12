export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hand a file to the iOS share sheet — iCloud Drive, Files, LINE — or, where
 * there is no share sheet, download it.
 *
 * Call it straight from the tap with a file already built. iOS only allows
 * the share sheet from a user gesture, and an await on the database before
 * this call can outlast the gesture and get the share refused.
 *
 * A share sheet that exists but refuses this file — desktop Chrome and Edge
 * turn down a .json backup with "Permission denied" — is treated like no share
 * sheet at all: the file is downloaded instead. A backup that cannot leave
 * the device is the one outcome that must not happen.
 */
export async function shareFile(file: File): Promise<ShareOutcome> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
      // Refused rather than cancelled: fall through to the download.
    }
  }

  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  // One-shot, after the download has started — not a timer that wakes the app.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

/**
 * Hand text to the share sheet — an order to a supplier on LINE — or, where
 * there is no share sheet, or it refuses, copy it. Call it straight from the tap.
 */
export async function shareText(text: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
      // Refused rather than cancelled: fall through to the clipboard.
    }
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
