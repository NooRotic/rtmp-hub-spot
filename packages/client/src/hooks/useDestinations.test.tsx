import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { makeFakeIpc } from '../test/fakeIpc';
import { useDestinations } from './useDestinations';
import type { RtmpDestination, DestinationBinding } from '../../../shared';

const YT: RtmpDestination = { id: 'yt', name: 'YouTube', platform: 'youtube', url: 'rtmp://x', streamKey: 'k', enabled: true };

// Build a stateful fake backend (the invoke impl) and wrap it with the shared makeFakeIpc.
function makeStore(initial: { destinations?: RtmpDestination[]; bindings?: DestinationBinding[] } = {}) {
  const store = { destinations: initial.destinations ?? [], bindings: initial.bindings ?? [] };
  const invokeImpl = async (channel: string, arg?: any) => {
    switch (channel) {
      case 'destinations:list': return store.destinations;
      case 'bindings:list': return store.bindings;
      case 'destinations:add': store.destinations = [...store.destinations, arg]; return true;
      case 'destinations:update': store.destinations = store.destinations.map((d) => (d.id === arg.id ? arg : d)); return true;
      case 'destinations:remove':
        store.destinations = store.destinations.filter((d) => d.id !== arg);
        store.bindings = store.bindings.filter((b) => b.destinationId !== arg);
        return true;
      case 'bindings:set': {
        const i = store.bindings.findIndex((b) => b.sourceKey === arg.sourceKey && b.destinationId === arg.destinationId);
        store.bindings = i >= 0 ? store.bindings.map((b, j) => (j === i ? arg : b)) : [...store.bindings, arg];
        return true;
      }
      case 'bindings:remove':
        store.bindings = store.bindings.filter((b) => !(b.sourceKey === arg.sourceKey && b.destinationId === arg.destinationId));
        return true;
      default: return undefined;
    }
  };
  const { ipc } = makeFakeIpc(invokeImpl);
  return { ipc, store };
}

describe('useDestinations', () => {
  it('loads destinations and bindings on mount', async () => {
    const { ipc } = makeStore({ destinations: [YT], bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }] });
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    expect(result.current.destinations).toEqual([YT]);
    expect(result.current.bindings).toHaveLength(1);
    unmount();
  });

  it('addDestination optimistically adds then reconciles via re-fetch', async () => {
    const { ipc } = makeStore();
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    await act(async () => { await result.current.addDestination(YT); });
    expect(ipc.invoke).toHaveBeenCalledWith('destinations:add', YT);
    expect(result.current.destinations.map((d) => d.id)).toEqual(['yt']);
    unmount();
  });

  it('removeDestination cascades its bindings out of state', async () => {
    const { ipc } = makeStore({ destinations: [YT], bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }] });
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    await act(async () => { await result.current.removeDestination('yt'); });
    expect(ipc.invoke).toHaveBeenCalledWith('destinations:remove', 'yt');
    // NOTE: this verifies the post-reconcile OUTCOME (bindings gone). The optimistic
    // pre-refresh cascade isn't isolated here (refresh re-fetches the cascaded store).
    expect(result.current.destinations).toHaveLength(0);
    expect(result.current.bindings).toHaveLength(0);
    unmount();
  });

  it('setBinding upserts and removeBinding deletes', async () => {
    const { ipc } = makeStore({ destinations: [YT] });
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    await act(async () => { await result.current.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true }); });
    expect(result.current.bindings).toHaveLength(1);
    await act(async () => { await result.current.removeBinding('grid', 'yt'); });
    expect(ipc.invoke).toHaveBeenCalledWith('bindings:remove', { sourceKey: 'grid', destinationId: 'yt' });
    expect(result.current.bindings).toHaveLength(0);
    unmount();
  });

  it('updateDestination replaces the destination in state', async () => {
    const { ipc } = makeStore({ destinations: [YT] });
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    const renamed = { ...YT, name: 'YT Renamed' };
    await act(async () => { await result.current.updateDestination(renamed); });
    expect(ipc.invoke).toHaveBeenCalledWith('destinations:update', renamed);
    expect(result.current.destinations[0].name).toBe('YT Renamed');
    unmount();
  });

  it('is inert when ipc is null', async () => {
    const { result, unmount } = renderHook(() => useDestinations(null));
    await act(async () => {});
    expect(result.current.destinations).toEqual([]);
    expect(result.current.bindings).toEqual([]);
    unmount();
  });
});
