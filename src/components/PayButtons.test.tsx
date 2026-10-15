import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import PayButtons from './PayButtons.tsx';

const TENDER = [4_000, 5_000, 5_900, 10_000, 50_000, 100_000];

afterEach(cleanup);

describe('PayButtons', () => {
  it('offers every note that covers a cheap bill, ฿500 and ฿1,000 included', () => {
    render(
      <PayButtons
        due={3_900}
        quickTender={TENDER}
        disabled={false}
        onCash={() => {}}
        onQr={() => {}}
      />,
    );
    for (const name of ['฿40', '฿50', '฿59', '฿100', '฿500', '฿1,000']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('offers only notes above the bill', () => {
    render(
      <PayButtons
        due={10_500}
        quickTender={TENDER}
        disabled={false}
        onCash={() => {}}
        onQr={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: '฿100' })).toBeNull();
    expect(screen.getByRole('button', { name: '฿500' })).toBeInTheDocument();
  });
});
