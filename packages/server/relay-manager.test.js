import { describe, it, expect, vi } from 'vitest';
import { createRelayManager } from './relay-manager.js';
import { buildRelayArgs } from './relay-args.js';

function makeManager(overrides = {}) {
  const spawned = [];
  const broadcasts = [];
  const live = [];
  const transient = [];
  const spawnRelay = vi.fn((args, handlers) => {
    const proc = { kill: vi.fn() };
    spawned.push({ args, handlers, proc });
    return proc;
  });
  const manager = createRelayManager({
    spawnRelay,
    buildRelayArgs,
    broadcastIPC: (channel, data) => broadcasts.push({ channel, data }),
    rtmpPort: 1935,
    now: () => 1000,
    onLive: (s, d) => live.push({ s, d }),
    onTransientFailure: (item) => transient.push(item),
    ...overrides,
  });
  return { manager, spawned, broadcasts, live, transient, spawnRelay };
}

const DEST = { id: 'd1', url: 'rtmp://x/live2', streamKey: 'key1' };

describe('relay-manager', () => {
  it('starts a relay, broadcasts connecting then live, and fires onLive', () => {
    const { manager, spawned, broadcasts, live } = makeManager();
    manager.start('grid', DEST);
    expect(broadcasts[0]).toEqual({
      channel: 'relay-status',
      data: { sourceKey: 'grid', destinationId: 'd1', state: 'connecting' },
    });
    spawned[0].handlers.onStart();
    expect(broadcasts.at(-1).data.state).toBe('live');
    expect(live).toEqual([{ s: 'grid', d: 'd1' }]);
    expect(manager.has('grid', 'd1')).toBe(true);
    expect(manager.size()).toBe(1);
  });

  it('emits relay-stats parsed from stderr with uptime', () => {
    const times = [1000, 4000]; // now() at start() (startedAt), then at the stderr tick
    const { manager, spawned, broadcasts } = makeManager({
      now: () => (times.length > 1 ? times.shift() : times[0]),
    });
    manager.start('grid', DEST);
    spawned[0].handlers.onStderr(
      'frame= 90 fps= 30 drop=2 size= 100kB time=00:00:03.00 bitrate=2500.0kbits/s speed=1.0x',
    );
    const stat = broadcasts.find((b) => b.channel === 'relay-stats').data;
    expect(stat.fps).toBe(30);
    expect(stat.droppedFrames).toBe(2);
    expect(stat.sourceKey).toBe('grid');
    expect(stat.destinationId).toBe('d1');
    expect(stat.uptimeSec).toBe(3);
  });

  it('classifies an auth error as fatal: error state, no transient retry', () => {
    const { manager, spawned, broadcasts, transient } = makeManager();
    manager.start('grid', DEST);
    spawned[0].handlers.onError(new Error('401 Unauthorized'));
    expect(broadcasts.at(-1).data.state).toBe('error');
    expect(transient).toHaveLength(0);
    expect(manager.has('grid', 'd1')).toBe(false);
  });

  it('classifies a network error as transient: reconnecting + onTransientFailure', () => {
    const { manager, spawned, broadcasts, transient } = makeManager();
    manager.start('grid', DEST);
    spawned[0].handlers.onError(new Error('Connection reset by peer'));
    expect(broadcasts.at(-1).data.state).toBe('reconnecting');
    expect(transient).toEqual([{ sourceKey: 'grid', destination: DEST }]);
    expect(manager.has('grid', 'd1')).toBe(false);
  });

  it('treats SIGKILL as a clean stop (no retry, no error)', () => {
    const { manager, spawned, broadcasts, transient } = makeManager();
    manager.start('grid', DEST);
    spawned[0].handlers.onError(new Error('ffmpeg was killed with signal SIGKILL'));
    expect(broadcasts.at(-1).data.state).toBe('stopped');
    expect(transient).toHaveLength(0);
  });

  it('stop() kills the proc and removes the entry; stopForSource targets one source', () => {
    const { manager, spawned } = makeManager();
    manager.start('grid', DEST);
    manager.start('feed-x', { id: 'd2', url: 'rtmp://y/app', streamKey: 'k2' });
    manager.stopForSource('grid');
    expect(spawned[0].proc.kill).toHaveBeenCalled();
    expect(manager.has('grid', 'd1')).toBe(false);
    expect(manager.has('feed-x', 'd2')).toBe(true);
    manager.stopAll();
    expect(manager.size()).toBe(0);
  });

  it('ignores an error from a replaced proc (restart race)', () => {
    const { manager, spawned, transient } = makeManager();
    manager.start('grid', DEST);
    const firstProc = spawned[0];
    manager.start('grid', DEST); // restart same key: kills first, installs a new entry
    // The first (dying) proc errors AFTER it was replaced:
    firstProc.handlers.onError(new Error('Connection reset by peer'));
    // Must be a no-op: the new relay is still tracked and no transient reconnect was queued.
    expect(manager.has('grid', 'd1')).toBe(true);
    expect(transient).toHaveLength(0);
  });
});
