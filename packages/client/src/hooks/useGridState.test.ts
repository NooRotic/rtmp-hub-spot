import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '../test/testUtils';
import { useGridState } from './useGridState';

afterEach(cleanup);

describe('useGridState', () => {
  it('seeds gridMembers with "local" and defaults the toggles', () => {
    const { result } = renderHook(() => useGridState(false));
    expect(result.current.gridMembers.has('local')).toBe(true);
    expect(result.current.gridMembers.size).toBe(1);
    expect(result.current.gridAutoLayout).toBe(true);
    expect(result.current.spotlightId).toBeNull();
    expect(result.current.previewOpen.size).toBe(0);
    expect(result.current.gridStream).toBeNull();
    expect(result.current.isGridShared).toBe(false);
  });

  it('showGrid initial value follows the isElectron arg', () => {
    const browser = renderHook(() => useGridState(false));
    expect(browser.result.current.showGrid).toBe(false);

    const electron = renderHook(() => useGridState(true));
    expect(electron.result.current.showGrid).toBe(true);
  });

  it('addGridMember / removeGridMember mutate membership', () => {
    const { result } = renderHook(() => useGridState(false));

    act(() => { result.current.addGridMember('rtmp-1'); });
    expect(result.current.gridMembers.has('rtmp-1')).toBe(true);
    expect(result.current.gridMembers.has('local')).toBe(true);

    act(() => { result.current.removeGridMember('rtmp-1'); });
    expect(result.current.gridMembers.has('rtmp-1')).toBe(false);
    expect(result.current.gridMembers.has('local')).toBe(true);
  });

  it('toggleGridMember adds then removes the same id', () => {
    const { result } = renderHook(() => useGridState(false));

    // Not present → toggle adds.
    act(() => { result.current.toggleGridMember('feed-x'); });
    expect(result.current.gridMembers.has('feed-x')).toBe(true);

    // Present → toggle removes.
    act(() => { result.current.toggleGridMember('feed-x'); });
    expect(result.current.gridMembers.has('feed-x')).toBe(false);

    // Toggling the seeded 'local' removes it (the "Include Admin" checkbox).
    act(() => { result.current.toggleGridMember('local'); });
    expect(result.current.gridMembers.has('local')).toBe(false);
  });

  it('returns immutable Set snapshots (new identity per change)', () => {
    const { result } = renderHook(() => useGridState(false));
    const before = result.current.gridMembers;
    act(() => { result.current.addGridMember('rtmp-2'); });
    expect(result.current.gridMembers).not.toBe(before);
    expect(before.has('rtmp-2')).toBe(false); // old snapshot untouched
  });

  it('drives the simple toggles (autoLayout / showGrid / gridShared / spotlight)', () => {
    const { result } = renderHook(() => useGridState(false));

    act(() => { result.current.setGridAutoLayout(false); });
    expect(result.current.gridAutoLayout).toBe(false);

    act(() => { result.current.setShowGrid(true); });
    expect(result.current.showGrid).toBe(true);

    act(() => { result.current.setIsGridShared(true); });
    expect(result.current.isGridShared).toBe(true);

    act(() => { result.current.setSpotlightId('peer-9'); });
    expect(result.current.spotlightId).toBe('peer-9');
  });
});
