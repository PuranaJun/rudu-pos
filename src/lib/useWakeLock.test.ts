import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWakeLock } from './useWakeLock.ts';

/** A stand-in for navigator.wakeLock that records what was asked of it. */
function fakeWakeLock() {
  const locks: Array<{ released: boolean; release: () => Promise<void> }> = [];
  const request = vi.fn(async () => {
    const lock = {
      released: false,
      release: vi.fn(async () => {
        lock.released = true;
      }),
    };
    locks.push(lock);
    return lock;
  });
  return { locks, request };
}

let visibility: DocumentVisibilityState = 'visible';
let wake: ReturnType<typeof fakeWakeLock>;

beforeEach(() => {
  visibility = 'visible';
  wake = fakeWakeLock();
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request: wake.request },
    configurable: true,
  });
  Object.defineProperty(document, 'visibilityState', { get: () => visibility, configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
});

function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('the screen wake lock', () => {
  it('is held while the day is open and let go when it closes', async () => {
    const { rerender } = renderHook(({ open }) => useWakeLock(open), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(wake.request).toHaveBeenCalledWith('screen'));

    rerender({ open: false });
    await waitFor(() => expect(wake.locks[0]!.released).toBe(true));
  });

  it('is not taken at all with no day open', () => {
    renderHook(() => useWakeLock(false));
    expect(wake.request).not.toHaveBeenCalled();
  });

  it('is taken again when the app comes back from the background', async () => {
    renderHook(() => useWakeLock(true));
    await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(1));

    // iOS drops the lock when the app is backgrounded.
    wake.locks[0]!.released = true;
    show('hidden');
    show('visible');

    await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(2));
  });

  it('does not take a second lock while it still holds one', async () => {
    renderHook(() => useWakeLock(true));
    await waitFor(() => expect(wake.request).toHaveBeenCalledTimes(1));

    show('visible');
    await Promise.resolve();

    expect(wake.request).toHaveBeenCalledTimes(1);
  });
});
