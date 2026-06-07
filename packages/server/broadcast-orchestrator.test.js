import { describe, it, expect, vi } from 'vitest';
import { createBroadcastOrchestrator } from './broadcast-orchestrator.js';

function make({ bindings = [], destinations = [], liveSources = [] } = {}) {
  const enq = [];
  const supervisor = { enqueue: (i) => enq.push(i), cancel: vi.fn() };
  const relayManager = { stopForSource: vi.fn(), stop: vi.fn(), stopForDestination: vi.fn() };
  const orch = createBroadcastOrchestrator({
    supervisor,
    relayManager,
    listBindings: () => bindings,
    listDestinations: () => destinations,
    isSourceLive: (key) => liveSources.includes(key),
  });
  return { orch, enq, supervisor, relayManager };
}

const YT = { id: 'yt', url: 'rtmp://x', streamKey: 'k', enabled: true };
const KICK = { id: 'kick', url: 'rtmp://y', streamKey: 'k2', enabled: true };

describe('broadcast-orchestrator', () => {
  it('enqueues every active+enabled destination for a published source', () => {
    const { orch, enq } = make({
      bindings: [
        { sourceKey: 'grid', destinationId: 'yt', active: true },
        { sourceKey: 'grid', destinationId: 'kick', active: false },
      ],
      destinations: [YT, KICK],
    });
    orch.onSourcePublished('grid');
    expect(enq).toEqual([{ sourceKey: 'grid', destination: YT }]);
  });

  it('skips disabled destinations even when the binding is active', () => {
    const { orch, enq } = make({
      bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }],
      destinations: [{ ...YT, enabled: false }],
    });
    orch.onSourcePublished('grid');
    expect(enq).toHaveLength(0);
  });

  it('on unpublish cancels pending and stops running relays for that source', () => {
    const { orch, supervisor, relayManager } = make();
    orch.onSourceUnpublished('grid');
    expect(supervisor.cancel).toHaveBeenCalledWith('grid');
    expect(relayManager.stopForSource).toHaveBeenCalledWith('grid');
  });

  it('safely skips a dangling binding whose destination no longer exists', () => {
    const { orch, enq } = make({
      bindings: [{ sourceKey: 'grid', destinationId: 'ghost', active: true }],
      destinations: [YT], // 'ghost' is not present
    });
    expect(() => orch.onSourcePublished('grid')).not.toThrow();
    expect(enq).toHaveLength(0);
  });

  it('onBindingAdded enqueues when the source is live and the destination enabled', () => {
    const { orch, enq } = make({ liveSources: ['grid'] });
    orch.onBindingAdded('grid', YT);
    expect(enq).toEqual([{ sourceKey: 'grid', destination: YT }]);
  });

  it('onBindingAdded does NOT enqueue when the source is offline (pre-wiring)', () => {
    const { orch, enq } = make({ liveSources: [] });
    orch.onBindingAdded('grid', YT);
    expect(enq).toHaveLength(0);
  });

  it('onBindingAdded does NOT enqueue a disabled destination even if the source is live', () => {
    const { orch, enq } = make({ liveSources: ['grid'] });
    orch.onBindingAdded('grid', { ...YT, enabled: false });
    expect(enq).toHaveLength(0);
  });

  it('onBindingAdded safely ignores a null destination even if the source is live', () => {
    const { orch, enq } = make({ liveSources: ['grid'] });
    expect(() => orch.onBindingAdded('grid', null)).not.toThrow();
    expect(enq).toHaveLength(0);
  });

  it('onBindingRemoved cancels the pending reconnect and stops the running relay', () => {
    const { orch, supervisor, relayManager } = make();
    orch.onBindingRemoved('grid', 'yt');
    expect(supervisor.cancel).toHaveBeenCalledWith('grid', 'yt');
    expect(relayManager.stop).toHaveBeenCalledWith('grid', 'yt');
  });

  it('onDestinationRemoved stops every relay for that destination', () => {
    const { orch, relayManager } = make();
    orch.onDestinationRemoved('yt');
    expect(relayManager.stopForDestination).toHaveBeenCalledWith('yt');
  });
});
