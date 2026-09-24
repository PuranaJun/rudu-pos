export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hand a file to the iOS share sheet — iCloud Drive, Files, LINE — or, where
 * there is no share sheet, download it.
 *
 * Call it straight from the tap with a file already built. iOS only allows
 * the share sheet from a user gesture, and an await on the database before
 * this call can outlast the gesture and get the share refused.
 */
export async function shareFile(file: File): Promise<ShareOutcome> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return 'cancelled';
      throw cause;
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
