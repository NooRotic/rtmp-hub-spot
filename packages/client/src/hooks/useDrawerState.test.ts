import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '../test/testUtils';
import { useDrawerState } from './useDrawerState';

afterEach(cleanup);

describe('useDrawerState', () => {
  it('starts with all three drawers closed', () => {
    const { result } = renderHook(() => useDrawerState());
    expect(result.current.settingsOpen).toBe(false);
    expect(result.current.recOpen).toBe(false);
    expect(result.current.addFeedOpen).toBe(false);
  });

  it('open/close handlers flip each drawer independently', () => {
    const { result } = renderHook(() => useDrawerState());

    act(() => { result.current.openSettings(); });
    expect(result.current.settingsOpen).toBe(true);
    expect(result.current.recOpen).toBe(false);
    expect(result.current.addFeedOpen).toBe(false);

    act(() => { result.current.openRecordings(); });
    expect(result.current.recOpen).toBe(true);

    act(() => { result.current.openAddFeed(); });
    expect(result.current.addFeedOpen).toBe(true);

    act(() => { result.current.closeSettings(); });
    expect(result.current.settingsOpen).toBe(false);
    // The others are untouched.
    expect(result.current.recOpen).toBe(true);
    expect(result.current.addFeedOpen).toBe(true);

    act(() => { result.current.closeRecordings(); });
    act(() => { result.current.closeAddFeed(); });
    expect(result.current.recOpen).toBe(false);
    expect(result.current.addFeedOpen).toBe(false);
  });

  it('raw setters also drive the booleans', () => {
    const { result } = renderHook(() => useDrawerState());
    act(() => { result.current.setSettingsOpen(true); });
    expect(result.current.settingsOpen).toBe(true);
    act(() => { result.current.setRecOpen(true); });
    expect(result.current.recOpen).toBe(true);
    act(() => { result.current.setAddFeedOpen(true); });
    expect(result.current.addFeedOpen).toBe(true);
  });
});
