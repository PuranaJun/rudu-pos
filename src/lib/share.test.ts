/**
 * Sharing a file or a message: the share sheet when there is one, and a
 * download or the clipboard when there is none — or when it says no.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shareFile, shareText } from './share.ts';

const FILE = new File(['{}'], 'rudu-backup-2026-10-12.json', { type: 'application/json' });

function shareSheet(result: 'ok' | 'cancel' | 'refuse') {
  const share = vi.fn(async () => {
    if (result === 'cancel') throw new DOMException('Share canceled', 'AbortError');
    if (result === 'refuse') throw new DOMException('Permission denied', 'NotAllowedError');
  });
  Object.assign(navigator, { canShare: () => true, share });
  return share;
}

function watchDownloads() {
  Object.assign(URL, { createObjectURL: () => 'blob:backup', revokeObjectURL: () => {} });
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(navigator, { canShare: undefined, share: undefined });
});

describe('shareFile', () => {
  it('uses the share sheet when it takes the file', async () => {
    shareSheet('ok');
    const click = watchDownloads();
    expect(await shareFile(FILE)).toBe('shared');
    expect(click).not.toHaveBeenCalled();
  });

  it('downloads the file when the share sheet refuses it — a backup always gets out', async () => {
    shareSheet('refuse');
    const click = watchDownloads();
    expect(await shareFile(FILE)).toBe('downloaded');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('does nothing more when the operator cancels', async () => {
    shareSheet('cancel');
    const click = watchDownloads();
    expect(await shareFile(FILE)).toBe('cancelled');
    expect(click).not.toHaveBeenCalled();
  });
});

describe('shareText', () => {
  it('copies the message when the share sheet refuses it', async () => {
    shareSheet('refuse');
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    expect(await shareText('สั่งของ ฤดูชา')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('สั่งของ ฤดูชา');
  });
});
