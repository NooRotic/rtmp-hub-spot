import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { useFfmpegPipeline } from './useFfmpegPipeline';
import type { IpcBridge } from './useElectronBridge';

function makeFakeIpc() {
  const listeners: Record<string, Function[]> = {};
  const ipc = {
    send: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn((ch: string, l: Function) => { (listeners[ch] ??= []).push(l); }),
    removeListener: vi.fn((ch: string, l: Function) => {
      listeners[ch] = (listeners[ch] ?? []).filter((x) => x !== l);
    }),
  } as unknown as IpcBridge;
  const emit = (ch: string, ...args: any[]) => (listeners[ch] ?? []).forEach((l) => l(null, ...args));
  return { ipc, emit, listeners };
}

describe('useFfmpegPipeline', () => {
  let fake: ReturnType<typeof makeFakeIpc>;
  beforeEach(() => { fake = makeFakeIpc(); });

  it('starts idle and ignores everything when ipc is null', () => {
    const { result, unmount } = renderHook(() => useFfmpegPipeline(null));
    expect(result.current.status).toEqual({ state: 'idle', streamKey: null });
    expect(result.current.stats).toBeNull();
    unmount();
  });

  it('updates status on ffmpeg-status and stats on ffmpeg-stats', () => {
    const { result, unmount } = renderHook(() => useFfmpegPipeline(fake.ipc));
    act(() => fake.emit('ffmpeg-status', { state: 'running', streamKey: 'grid' }));
    expect(result.current.status).toEqual({ state: 'running', streamKey: 'grid' });
    act(() => fake.emit('ffmpeg-stats', { frame: 90, fps: 30, bitrate: '2500k', speed: 1, time: '00:00:03', size: '1MB', streamKey: 'grid' }));
    expect(result.current.stats?.fps).toBe(30);
    unmount();
  });

  it('clears stats when status is not running', () => {
    const { result, unmount } = renderHook(() => useFfmpegPipeline(fake.ipc));
    act(() => fake.emit('ffmpeg-stats', { frame: 1, fps: 30, bitrate: 'x', speed: 1, time: 't', size: 's', streamKey: 'grid' }));
    act(() => fake.emit('ffmpeg-status', { state: 'stopped', streamKey: 'grid' }));
    expect(result.current.stats).toBeNull();
    unmount();
  });

  it('removes its listeners on unmount', () => {
    const { unmount } = renderHook(() => useFfmpegPipeline(fake.ipc));
    unmount();
    expect(fake.ipc.removeListener).toHaveBeenCalledWith('ffmpeg-status', expect.any(Function));
    expect(fake.ipc.removeListener).toHaveBeenCalledWith('ffmpeg-stats', expect.any(Function));
  });
});
