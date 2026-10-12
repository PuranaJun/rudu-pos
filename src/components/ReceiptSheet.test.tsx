/**
 * The receipt, sent as a picture: one tap from the receipt to the share
 * sheet, with the file already made so iOS does not refuse the share.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceiptSheet from './ReceiptSheet.tsx';
import { fakeCanvas, RECEIPT } from '../test/receipt-fixtures.ts';
import { BACK } from '../test/helpers.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

function withCanvasAndShareSheet() {
  const { canvas } = fakeCanvas();
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(
    (tag: string, options?: ElementCreationOptions) =>
      tag === 'canvas' ? canvas : real(tag, options),
  );
  const share = vi.fn(async (_data: ShareData) => {});
  Object.assign(navigator, { canShare: () => true, share });
  return share;
}

describe('ReceiptSheet', () => {
  it('shows the queue number and where they eat', () => {
    render(<ReceiptSheet receipt={RECEIPT} back={BACK} />);
    expect(screen.getByText('คิว 12')).toBeInTheDocument();
    expect(screen.getByText('ทานที่ร้าน')).toBeInTheDocument();
  });

  it('sends the receipt to the share sheet as a PNG in one tap', async () => {
    const share = withCanvasAndShareSheet();
    const user = userEvent.setup();
    render(<ReceiptSheet receipt={RECEIPT} back={BACK} />);

    const button = await screen.findByRole('button', { name: 'ส่งใบเสร็จ' });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = (share.mock.calls[0]![0].files ?? [])[0]!;
    expect(file.name).toBe('rudu-receipt-2026-10-12-q12.png');
    expect(file.type).toBe('image/png');
    expect(await screen.findByRole('button', { name: 'ส่งใบเสร็จ แล้ว ✓' })).toBeInTheDocument();
  });

  it('says so, rather than sending nothing, when the picture cannot be made', async () => {
    render(<ReceiptSheet receipt={RECEIPT} back={BACK} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('เตรียมไฟล์ไม่สำเร็จ');
    expect(screen.getByRole('button', { name: 'กำลังเตรียมไฟล์…' })).toBeDisabled();
  });
});
