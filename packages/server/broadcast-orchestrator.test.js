import { describe, it, expect, vi } from 'vitest';
import { createBroadcastOrchestrator } from './broadcast-orchestrator.js';

function make({ bindings = [], destinations = [] } = {}) {
  const enq = [];
  const supervisor = { enqueue: (i) => enq.push(i), cancel: vi.fn() };
  const relayManager = { stopForSource: vi.fn() };
  const orch = createBroadcastOrchestrator({
    supervisor,
    relayManager,
    listBindings: () => bindings,
    listDestinations: () => destinations,
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
});
