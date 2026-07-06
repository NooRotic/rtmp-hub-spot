import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { makeFakeIpc } from '../test/fakeIpc';
import { useBroadcastSettings } from './useBroadcastSettings';

describe('useBroadcastSettings', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults when nothing is persisted', () => {
    const { result, unmount } = renderHook(() => useBroadcastSettings(null));
    expect(result.current.bitrate).toBe('2500k');
    expect(result.current.preset).toBe('ultrafast');
    expect(result.current.hwAccel).toBe('none');
    unmount();
  });

  it('reads persisted values on init', () => {
    localStorage.setItem('hub-broadcast-bitrate', '6000k');
    localStorage.setItem('hub-broadcast-preset', 'veryfast');
    localStorage.setItem('hub-hwaccel', 'amf');
    const { result, unmount } = renderHook(() => useBroadcastSettings(null));
    expect(result.current.bitrate).toBe('6000k');
    expect(result.current.preset).toBe('veryfast');
    expect(result.current.hwAccel).toBe('amf');
    unmount();
  });

  it('persists a changed setting to localStorage', () => {
    const { result, unmount } = renderHook(() => useBroadcastSettings(null));
    act(() => result.current.setBitrate('8000k'));
    act(() => result.current.setPreset('veryfast'));
    act(() => result.current.setHwAccel('nvenc'));
    expect(localStorage.getItem('hub-broadcast-bitrate')).toBe('8000k');
    expect(localStorage.getItem('hub-broadcast-preset')).toBe('veryfast');
    expect(localStorage.getItem('hub-hwaccel')).toBe('nvenc');
    unmount();
  });

  it('GPU detect sets detectedEncoder and auto-selects best when hwAccel is still none', async () => {
    const { ipc } = makeFakeIpc();
    (ipc.invoke as any).mockResolvedValue({ best: 'amf', bestLabel: 'AMD AMF', available: ['amf', 'libx264'] });
    const { result, unmount } = renderHook(() => useBroadcastSettings(ipc));
    await act(async () => {});
    expect(ipc.invoke).toHaveBeenCalledWith('detect-gpu-encoder');
    expect(result.current.detectedEncoder?.best).toBe('amf');
    expect(result.current.hwAccel).toBe('amf');
    unmount();
  });

  it('GPU detect does NOT override a persisted choice that is still available', async () => {
    localStorage.setItem('hub-hwaccel', 'nvidia');
    const { ipc } = makeFakeIpc();
    (ipc.invoke as any).mockResolvedValue({ best: 'amd', bestLabel: 'AMD AMF', available: ['nvidia', 'amd'] });
    const { result, unmount } = renderHook(() => useBroadcastSettings(ipc));
    await act(async () => {});
    expect(result.current.hwAccel).toBe('nvidia'); // still usable here → respected
    unmount();
  });

  it('GPU detect resets a stale persisted encoder that is no longer available', async () => {
    localStorage.setItem('hub-hwaccel', 'amd'); // stale: chosen on a different machine
    const { ipc } = makeFakeIpc();
    (ipc.invoke as any).mockResolvedValue({ best: 'nvidia', bestLabel: 'NVIDIA NVENC', available: ['nvidia'] });
    const { result, unmount } = renderHook(() => useBroadcastSettings(ipc));
    await act(async () => {});
    expect(result.current.hwAccel).toBe('nvidia'); // 'amd' not usable here → reset to best
    unmount();
  });

  it('GPU detect keeps a persisted choice when the probe returns no encoders', async () => {
    localStorage.setItem('hub-hwaccel', 'nvidia');
    const { ipc } = makeFakeIpc();
    (ipc.invoke as any).mockResolvedValue({ best: 'none', bestLabel: 'Software x264', available: [] });
    const { result, unmount } = renderHook(() => useBroadcastSettings(ipc));
    await act(async () => {});
    expect(result.current.hwAccel).toBe('nvidia'); // empty available → don't wipe the user's choice
    unmount();
  });
});
