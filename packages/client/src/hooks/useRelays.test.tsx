import { describe, it, expect, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { makeFakeIpc } from '../test/fakeIpc';
import { useRelays } from './useRelays';

describe('useRelays', () => {
  let fake: ReturnType<typeof makeFakeIpc>;
  beforeEach(() => { fake = makeFakeIpc(); });

  it('adds an entry on relay-status and keys it by "src::dest"', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'connecting' }));
    expect(result.current.relays.get('grid::yt')?.state).toBe('connecting');
    unmount();
  });

  it('merges relay-stats into the existing entry', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }));
    act(() => fake.emit('relay-stats', { sourceKey: 'grid', destinationId: 'yt', fps: 30, bitrate: '2500k', speed: 1, frame: 90, size: '1MB', time: 't', uptimeSec: 3 }));
    const e = result.current.relays.get('grid::yt');
    expect(e?.state).toBe('live');
    expect(e?.stats?.fps).toBe(30);
    unmount();
  });

  it('ignores stats for an unknown relay', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-stats', { sourceKey: 'grid', destinationId: 'ghost', fps: 1, bitrate: 'x', speed: 1, frame: 1, size: 's', time: 't', uptimeSec: 1 }));
    expect(result.current.relays.has('grid::ghost')).toBe(false);
    unmount();
  });

  it('removes an entry when its status becomes stopped', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'stopped' }));
    expect(result.current.relays.has('grid::yt')).toBe(false);
    unmount();
  });

  it('keeps separate entries per (source, destination)', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }));
    act(() => fake.emit('relay-status', { sourceKey: 'feed-cam', destinationId: 'yt', state: 'connecting' }));
    expect(result.current.relays.size).toBe(2);
    unmount();
  });

  it('is inert when ipc is null', () => {
    const { result, unmount } = renderHook(() => useRelays(null));
    expect(result.current.relays.size).toBe(0);
    unmount();
  });

  it('keeps the entry on error state and carries the message', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'error', message: 'Auth failed' }));
    const e = result.current.relays.get('grid::yt');
    expect(e?.state).toBe('error');
    expect(e?.message).toBe('Auth failed');
    unmount();
  });
});
