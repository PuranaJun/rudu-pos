import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UpdateToast from './UpdateToast.tsx';

const update = { ready: true, apply: vi.fn() };
vi.mock('../lib/useUpdateReady.ts', () => ({ useUpdateReady: () => update }));

beforeEach(() => {
  update.ready = true;
  update.apply.mockClear();
});

describe('the update toast', () => {
  it('says a new version is ready, and switches only when asked', async () => {
    const user = userEvent.setup();
    render(<UpdateToast canApply />);

    expect(screen.getByRole('status', { name: 'อัปเดต' })).toHaveTextContent('อัปเดตแล้ว');
    expect(update.apply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'ใช้เวอร์ชันใหม่' }));
    expect(update.apply).toHaveBeenCalledOnce();
  });

  it('is not offered mid-sale, when switching would reload over a cart', () => {
    render(<UpdateToast canApply={false} />);
    expect(screen.queryByRole('status', { name: 'อัปเดต' })).not.toBeInTheDocument();
  });

  it('can be put off, and says nothing when there is nothing new', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<UpdateToast canApply />);
    await user.click(screen.getByRole('button', { name: 'ไว้ทีหลัง' }));
    expect(screen.queryByRole('status', { name: 'อัปเดต' })).not.toBeInTheDocument();
    unmount();

    update.ready = false;
    render(<UpdateToast canApply />);
    expect(screen.queryByRole('status', { name: 'อัปเดต' })).not.toBeInTheDocument();
  });
});
