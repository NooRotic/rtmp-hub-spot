import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { createPipeManager } from './pipe-manager.js';
import { buildFfmpegArgs } from './ffmpeg-args.js';

/**
 * Unit tests for the multi-pipe engine (audit #1). The fluent-ffmpeg glue is
 * injected as `spawnPipe`, so these exercise the Map/routing/stop/restart logic
 * without spawning real processes.
 */
function makeManager(overrides = {}) {
  const spawned = []; // one record per spawnPipe call
  const broadcasts = [];
  const spawnPipe = vi.fn((videoStream, args, handlers) => {
    const proc = { kill: vi.fn() };
    spawned.push({ videoStream, args, handlers, proc });
    return proc;
  });
  const manager = createPipeManager({
    spawnPipe,
    PassThrough,
    buildFfmpegArgs,
    broadcastIPC: (channel, data) => broadcasts.push({ channel, data }),
    rtmpPort: 1935,
    maxRestarts: 3,
    ...overrides,
  });
  return { manager, spawned, broadcasts, spawnPipe };
}

describe('pipe-manager', () => {
  it('starts a pipe for a stream key (spawns ffmpeg targeting that RTMP key)', () => {
    const { manager, spawned } = makeManager();
    manager.start({ streamKey: 'grid', hwAccel: 'none' });

    expect(manager.has('grid')).toBe(true);
    expect(manager.size()).toBe(1);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].args.outputUrl).toBe('rtmp://localhost:1935/live/grid');
  });

  it('runs MULTIPLE pipes concurrently — starting a 2nd key does NOT kill the 1st', () => {
    const { manager, spawned } = makeManager();
    manager.start({ streamKey: 'grid', hwAccel: 'none' });
    manager.start({ streamKey: 'feed-alice', hwAccel: 'none' });

    expect(manager.size()).toBe(2);
    expect(manager.has('grid')).toBe(true);
    expect(manager.has('feed-alice')).toBe(true);
    // the grid process was never killed when feed-alice started (the core fix)
    expect(spawned[0].proc.kill).not.toHaveBeenCalled();
  });

  it('restarting the same key replaces only that pipe, leaving others alone', () => {
    const { manager, spawned } = makeManager();
    manager.start({ streamKey: 'grid', hwAccel: 'none' });
    manager.start({ streamKey: 'feed-alice', hwAccel: 'none' });

    manager.start({ streamKey: 'grid', hwAccel: 'nvidia' }); // re-start grid

    expect(spawned[0].proc.kill).toHaveBeenCalled();      // old grid killed
    expect(spawned[1].proc.kill).not.toHaveBeenCalled();  // feed-alice untouched
    expect(manager.size()).toBe(2);
    expect(spawned).toHaveLength(3);
  });

  it('routes chunks to the matching pipe and ignores unknown keys', async () => {
    const { manager, spawned } = makeManager();
    manager.start({ streamKey: 'grid', hwAccel: 'none' });
    manager.start({ streamKey: 'feed-alice', hwAccel: 'none' });

    const gridGot = [];
    spawned[0].videoStream.on('data', (b) => gridGot.push(b));

    manager.writeChunk('grid', new Uint8Array([1, 2, 3]));
    expect(() => manager.writeChunk('nope', new Uint8Array([9]))).not.toThrow();

    await new Promise((r) => setImmediate(r));
    expect(Buffer.concat(gridGot)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('stop(key) stops only that pipe; other pipes keep running', () => {
    const { manager, spawned } = makeManager();
    manager.start({ streamKey: 'grid', hwAccel: 'none' });
    manager.start({ streamKey: 'feed-alice', hwAccel: 'none' });

    manager.stop('grid');

    expect(spawned[0].proc.kill).toHaveBeenCalled();
    expect(manager.has('grid')).toBe(false);
    expect(manager.has('feed-alice')).toBe(true);
    expect(manager.size()).toBe(1);
  });

  it('stopAll() stops every pipe', () => {
    const { manager, spawned } = makeManager();
    manager.start({ streamKey: 'grid', hwAccel: 'none' });
    manager.start({ streamKey: 'feed-alice', hwAccel: 'none' });

    manager.stopAll();

    expect(spawned[0].proc.kill).toHaveBeenCalled();
    expect(spawned[1].proc.kill).toHaveBeenCalled();
    expect(manager.size()).toBe(0);
  });

  describe('auto-restart on unexpected crash', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('reschedules with backoff and re-spawns, per-pipe', () => {
      const { manager, spawned } = makeManager();
      manager.start({ streamKey: 'grid', hwAccel: 'none' });

      // simulate an unexpected ffmpeg crash
      spawned[0].handlers.onError(new Error('ffmpeg exited with code 1'));
      expect(spawned).toHaveLength(1); // not yet restarted

      vi.advanceTimersByTime(2000); // first backoff = 1 * 2000ms
      expect(spawned).toHaveLength(2); // re-spawned grid
      expect(manager.has('grid')).toBe(true);
    });

    it('gives up after maxRestarts consecutive crashes', () => {
      const { manager, spawned, broadcasts } = makeManager();
      manager.start({ streamKey: 'grid', hwAccel: 'none' });

      // crash, restart, crash, restart, crash, restart, crash -> give up
      for (let i = 0; i < 4; i++) {
        const latest = spawned[spawned.length - 1];
        latest.handlers.onError(new Error('crash'));
        vi.advanceTimersByTime(10000);
      }
      // 1 initial + 3 restarts = 4 spawns max
      expect(spawned.length).toBe(4);
      expect(manager.has('grid')).toBe(false);
      expect(broadcasts.some((b) => b.data.message && /manual restart/i.test(b.data.message))).toBe(true);
    });

    it('does NOT restart on a clean kill (SIGKILL)', () => {
      const { manager, spawned } = makeManager();
      manager.start({ streamKey: 'grid', hwAccel: 'none' });

      spawned[0].handlers.onError(new Error('ffmpeg was killed with signal SIGKILL'));
      vi.advanceTimersByTime(10000);

      expect(spawned).toHaveLength(1); // no restart
      expect(manager.has('grid')).toBe(false);
    });
  });
});
