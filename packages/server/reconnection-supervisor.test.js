import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReconnectionSupervisor } from './reconnection-supervisor.js';

const D = (id, priority) => ({ id, url: 'rtmp://x/app', streamKey: 'k', priority });

let nowVal = 0;
function makeSup(overrides = {}) {
  const started = [];
  const sup = createReconnectionSupervisor({
    startRelay: (item) => started.push(item),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    now: () => nowVal,
    jitter: () => 0,
    baseDelay: 1000,
    maxDelay: 8000,
    ...overrides,
  });
  return { sup, started };
}

describe('reconnection-supervisor', () => {
  beforeEach(() => { vi.useFakeTimers(); nowVal = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drains serially in priority order, one start per tick', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('low', 5) });
    sup.enqueue({ sourceKey: 'grid', destination: D('high', 0) });
    sup.enqueue({ sourceKey: 'grid', destination: D('mid', 2) });

    vi.advanceTimersByTime(0);            // first drain
    expect(started.map((s) => s.destination.id)).toEqual(['high']);
    vi.advanceTimersByTime(1000);
    expect(started.map((s) => s.destination.id)).toEqual(['high', 'mid']);
    vi.advanceTimersByTime(1000);
    expect(started.map((s) => s.destination.id)).toEqual(['high', 'mid', 'low']);
  });

  it('de-dupes a re-enqueued item already pending', () => {
    const { sup } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    expect(sup.pending()).toBe(1);
  });

  it('grows the delay when an item is re-enqueued soon after starting (failure)', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    vi.advanceTimersByTime(0);            // start 'a' (streak 0 -> delay 1000)
    expect(started).toHaveLength(1);
    nowVal = 100;                         // shortly after
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) }); // re-enqueue = it failed
    vi.advanceTimersByTime(1999);
    expect(started).toHaveLength(1);      // not yet — backoff grew past 1000
    vi.advanceTimersByTime(1);            // 2000ms => 2^1 * 1000
    expect(started).toHaveLength(2);
  });

  it('notifyLive resets the backoff streak', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    vi.advanceTimersByTime(0);
    nowVal = 100;
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) }); // streak -> 1
    sup.notifyLive('grid', 'b');                                 // any live resets
    vi.advanceTimersByTime(1000);                                // back to base delay
    expect(started).toHaveLength(2);
  });

  it('cancel removes pending items for a source', () => {
    const { sup } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    sup.enqueue({ sourceKey: 'feed-x', destination: D('b', 0) });
    sup.cancel('grid');
    expect(sup.pending()).toBe(1);
  });

  it('a burst of failures grows the global backoff (capped at maxDelay)', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'g', destination: D('a', 0) });
    sup.enqueue({ sourceKey: 'g', destination: D('b', 1) });
    sup.enqueue({ sourceKey: 'g', destination: D('c', 2) });
    vi.advanceTimersByTime(0);    // a
    vi.advanceTimersByTime(1000); // b
    vi.advanceTimersByTime(1000); // c
    expect(started).toHaveLength(3);
    nowVal = 50; // all three fail in a burst -> streak 3 -> delay min(1000*2^3, 8000)=8000
    sup.enqueue({ sourceKey: 'g', destination: D('a', 0) });
    sup.enqueue({ sourceKey: 'g', destination: D('b', 1) });
    sup.enqueue({ sourceKey: 'g', destination: D('c', 2) });
    vi.advanceTimersByTime(7999);
    expect(started).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(started).toHaveLength(4);
  });

  it('cancel with a destinationId removes only that destination', () => {
    const { sup } = makeSup();
    sup.enqueue({ sourceKey: 'g', destination: D('a', 0) });
    sup.enqueue({ sourceKey: 'g', destination: D('b', 1) });
    sup.cancel('g', 'a');
    expect(sup.pending()).toBe(1);
  });

  it('after cancelling the whole queue, a fresh enqueue starts immediately (no stale-timer wait)', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'g', destination: D('a', 0) });
    vi.advanceTimersByTime(0);                                 // 'a' starts
    expect(started).toHaveLength(1);
    nowVal = 50;
    sup.enqueue({ sourceKey: 'g', destination: D('a', 0) });   // fail -> streak 1, ~2000ms timer pending
    sup.cancel('g');                                            // source stops: must clear the stale timer
    expect(sup.pending()).toBe(0);
    sup.enqueue({ sourceKey: 'g', destination: D('a', 0) });   // source restarts
    vi.advanceTimersByTime(0);
    expect(started).toHaveLength(2);                            // started immediately, not after 2000ms
  });
});
