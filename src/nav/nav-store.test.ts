import { beforeEach, describe, expect, it } from 'vitest';
import { homeLabel, resetNav, useNav } from './nav-store.ts';

beforeEach(resetNav);

describe('navigation', () => {
  it('starts at home', () => {
    expect(useNav.getState()).toMatchObject({ route: null, closedSessionId: null });
  });

  it('opens one screen at a time, and home is one step from any of them', () => {
    useNav.getState().open('HUB');
    useNav.getState().open('SETTINGS');
    // The hub is a launcher: opening a destination replaces it.
    expect(useNav.getState().route).toBe('SETTINGS');

    useNav.getState().home();
    expect(useNav.getState().route).toBeNull();
  });

  it('closing the day leaves every screen and shows its summary until done', () => {
    useNav.getState().open('CLOSE_DAY');
    useNav.getState().dayClosed('SESSION_1');
    expect(useNav.getState()).toMatchObject({ route: null, closedSessionId: 'SESSION_1' });

    useNav.getState().summaryDone();
    expect(useNav.getState().closedSessionId).toBeNull();
  });

  it('names the way home after where home is', () => {
    expect(homeLabel(true)).toBe('กลับไปขาย');
    expect(homeLabel(false)).toBe('กลับไปหน้าเปิดร้าน');
  });
});
