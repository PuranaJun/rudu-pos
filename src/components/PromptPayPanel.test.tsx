/**
 * The PromptPay screen: a QR with the bill's amount when the shop's ID is
 * set, the printed QR when it is not, and never a claim that the money came.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PromptPayPanel from './PromptPayPanel.tsx';

function renderPanel(promptPayId: string | null, qrImage: string | null = null) {
  return render(
    <PromptPayPanel
      due={5_900}
      promptPayId={promptPayId}
      qrImage={qrImage}
      onConfirm={() => {}}
      onCancel={() => {}}
      busy={false}
    />,
  );
}

describe('PromptPayPanel', () => {
  it('draws a QR with the amount in it from the shop’s PromptPay ID', () => {
    renderPanel('0812345678', 'data:image/png;base64,printed');
    const qr = screen.getByRole('img', { name: 'QR พร้อมเพย์ ฿59' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByText('ใส่ยอด ฿59 ให้แล้ว')).toBeInTheDocument();
    // Enough to recognise the account, not the whole number.
    expect(screen.getByText('พร้อมเพย์ •••• 5678')).toBeInTheDocument();
    expect(screen.queryByText(/0812345678/)).not.toBeInTheDocument();
  });

  it('falls back to the printed QR without an ID', () => {
    renderPanel(null, 'data:image/png;base64,printed');
    expect(screen.getByRole('img', { name: 'PromptPay QR' })).toHaveAttribute(
      'src',
      'data:image/png;base64,printed',
    );
  });

  it('still says nothing was verified', () => {
    renderPanel('0812345678');
    expect(screen.getByText(/ระบบไม่ได้ตรวจสอบการโอน/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ลูกค้าจ่ายแล้ว' })).toBeEnabled();
  });
});
