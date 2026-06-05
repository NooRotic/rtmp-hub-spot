import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { makeFakeIpc } from '../test/fakeIpc';
import { useRecordings } from './useRecordings';
import type { IpcBridge } from './useElectronBridge';

describe('useRecordings', () => {
  let ipc: IpcBridge;
  beforeEach(() => { ipc = makeFakeIpc().ipc; });

  it('startRecording invokes start-recording and adds an active recording on success', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: true, path: 'C:/rec/grid.mp4' });
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(ipc.invoke).toHaveBeenCalledWith('start-recording', { streamKey: 'grid' });
    expect(result.current.activeRecordings.map((r) => r.streamKey)).toEqual(['grid']);
    unmount();
  });

  it('startRecording does not add when the result is unsuccessful', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: false, error: 'boom' });
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });

  it('stopRecording sends stop-recording and removes the entry', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: true, path: 'p' });
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    await act(async () => { await result.current.startRecording('grid'); });
    act(() => result.current.stopRecording('grid'));
    expect(ipc.send).toHaveBeenCalledWith('stop-recording', { streamKey: 'grid' });
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });

  it('openRecordingsDir sends open-recordings-dir', () => {
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    act(() => result.current.openRecordingsDir());
    expect(ipc.send).toHaveBeenCalledWith('open-recordings-dir');
    unmount();
  });

  it('removes an active recording when the server signals recordingStopped for it', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: true, path: 'p' });
    let recordingStopped: { streamKey: string; reason: string } | null = null;
    const { result, rerender, unmount } = renderHook(() => useRecordings(ipc, recordingStopped));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(result.current.activeRecordings).toHaveLength(1);
    recordingStopped = { streamKey: 'grid', reason: 'publisher-disconnect' };
    act(() => rerender());
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });

  it('is a no-op when ipc is null', async () => {
    const { result, unmount } = renderHook(() => useRecordings(null, null));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });
});
