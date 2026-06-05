import { describe, it, expect } from 'vitest';
import { renderHook } from '../test/testUtils';
import { isElectron, getIpc, useElectronBridge } from './useElectronBridge';

describe('useElectronBridge (non-Electron / jsdom)', () => {
  it('isElectron is false under jsdom', () => {
    expect(isElectron).toBe(false);
  });
  it('getIpc() returns null when not in Electron', () => {
    expect(getIpc()).toBeNull();
  });
  it('the hook returns { isElectron: false, ipc: null }', () => {
    const { result, unmount } = renderHook(() => useElectronBridge());
    expect(result.current).toEqual({ isElectron: false, ipc: null });
    unmount();
  });
});
