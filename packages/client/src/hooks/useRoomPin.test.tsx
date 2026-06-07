import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '../test/testUtils';
import { useRoomPin } from './useRoomPin';

function fakeIpc(locked = false) {
  return {
    send: vi.fn(),
    invoke: vi.fn(async (ch: string) => (ch === 'get-room-pin' ? { locked } : undefined)),
    on: vi.fn(() => () => {}),
    removeListener: vi.fn(),
  } as any;
}

afterEach(cleanup);

describe('useRoomPin', () => {
  it('reads initial locked state via get-room-pin', async () => {
    const ipc = fakeIpc(true);
    const { result } = renderHook(() => useRoomPin(ipc));
    await act(async () => {});
    expect(ipc.invoke).toHaveBeenCalledWith('get-room-pin');
    expect(result.current.locked).toBe(true);
  });

  it('setPin sends set-room-pin and marks locked', async () => {
    const ipc = fakeIpc(false);
    const { result } = renderHook(() => useRoomPin(ipc));
    await act(async () => { await result.current.setPin('1234'); });
    expect(ipc.send).toHaveBeenCalledWith('set-room-pin', { pin: '1234' });
    expect(result.current.locked).toBe(true);
  });

  it('clearPin sends empty + marks open', async () => {
    const ipc = fakeIpc(true);
    const { result } = renderHook(() => useRoomPin(ipc));
    await act(async () => { await result.current.clearPin(); });
    expect(ipc.send).toHaveBeenCalledWith('set-room-pin', { pin: '' });
    expect(result.current.locked).toBe(false);
  });

  it('no-ops without ipc', () => {
    const { result } = renderHook(() => useRoomPin(null));
    expect(result.current.locked).toBe(false);
  });
});
