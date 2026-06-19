/// <reference types="vitest" />
/**
 * useSyntheticFeeds unit tests.
 *
 * mpegts.js is mocked with mseLivePlayback:true so the feed effect DOES spin up a
 * player per added feed, giving us a `destroy` spy to assert the NO-CHURN
 * invariant: a serverStatus change across renders must NOT tear players down
 * (teardown lives only in the unmount-only effect). createPlayer / play return
 * value shape mirrors the existing App.rtmp-preview.test mock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '../test/testUtils';

const { createPlayer, destroy } = vi.hoisted(() => {
  const destroy = vi.fn();
  return {
    destroy,
    createPlayer: vi.fn((_cfg: { type: string; isLive: boolean; url: string }) => ({
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      destroy,
    })),
  };
});

vi.mock('mpegts.js', () => ({
  default: {
    getFeatureList: () => ({ mseLivePlayback: true }),
    createPlayer,
  },
}));

import { useSyntheticFeeds } from './useSyntheticFeeds';

describe('useSyntheticFeeds', () => {
  beforeEach(() => {
    createPlayer.mockClear();
    destroy.mockClear();
  });
  afterEach(cleanup);

  it('starts empty with blank form fields', () => {
    const onFeedLive = vi.fn();
    const onFeedRemoved = vi.fn();
    const { result } = renderHook(() =>
      useSyntheticFeeds({ serverStatus: null, onFeedLive, onFeedRemoved }),
    );
    expect(result.current.syntheticFeeds).toEqual([]);
    expect(result.current.newFeedKey).toBe('');
    expect(result.current.newFeedLabel).toBe('');
  });

  it('addSyntheticFeed appends a [FETCHING] feed and clears the form; label falls back to key', () => {
    const onFeedLive = vi.fn();
    const onFeedRemoved = vi.fn();
    const { result } = renderHook(() =>
      useSyntheticFeeds({ serverStatus: null, onFeedLive, onFeedRemoved }),
    );

    act(() => { result.current.setNewFeedKey('guest-7'); });
    act(() => { result.current.addSyntheticFeed(); });

    expect(result.current.syntheticFeeds).toHaveLength(1);
    expect(result.current.syntheticFeeds[0].streamKey).toBe('guest-7');
    expect(result.current.syntheticFeeds[0].label).toBe('guest-7'); // fallback to key
    expect(result.current.syntheticFeeds[0].stream).toBeNull();
    // Form cleared after submit.
    expect(result.current.newFeedKey).toBe('');
    expect(result.current.newFeedLabel).toBe('');
  });

  it('addSyntheticFeed is a no-op on blank/whitespace key', () => {
    const onFeedLive = vi.fn();
    const onFeedRemoved = vi.fn();
    const { result } = renderHook(() =>
      useSyntheticFeeds({ serverStatus: null, onFeedLive, onFeedRemoved }),
    );
    act(() => { result.current.setNewFeedKey('   '); });
    act(() => { result.current.addSyntheticFeed(); });
    expect(result.current.syntheticFeeds).toEqual([]);
  });

  it('removeSyntheticFeed drops the feed AND calls onFeedRemoved(id)', () => {
    const onFeedLive = vi.fn();
    const onFeedRemoved = vi.fn();
    const { result } = renderHook(() =>
      useSyntheticFeeds({ serverStatus: null, onFeedLive, onFeedRemoved }),
    );

    act(() => { result.current.setNewFeedKey('drop-me'); });
    act(() => { result.current.addSyntheticFeed(); });
    const id = result.current.syntheticFeeds[0].id;
    expect(result.current.syntheticFeeds).toHaveLength(1);

    act(() => { result.current.removeSyntheticFeed(id); });

    expect(result.current.syntheticFeeds).toHaveLength(0);
    expect(onFeedRemoved).toHaveBeenCalledWith(id);
  });

  it('NO-CHURN: changing serverStatus across renders does NOT destroy the player', () => {
    const onFeedLive = vi.fn();
    const onFeedRemoved = vi.fn();
    // Mutable serverStatus captured by a closure so rerender() picks up the new value.
    let serverStatus: unknown = { tick: 0 };
    const { result, rerender } = renderHook(() =>
      useSyntheticFeeds({ serverStatus, onFeedLive, onFeedRemoved }),
    );

    // Add a feed → the [syntheticFeeds, serverStatus] effect spins up a player.
    act(() => { result.current.setNewFeedKey('live-cam'); });
    act(() => { result.current.addSyntheticFeed(); });
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();

    // Simulate several serverStatus telemetry ticks. Each re-runs the effect (its
    // cleanup is intentionally EMPTY), so the player must SURVIVE — destroy stays 0.
    for (let i = 1; i <= 3; i++) {
      serverStatus = { tick: i };
      act(() => { rerender(); });
    }
    expect(destroy).not.toHaveBeenCalled();
    // And no second player was created for the same already-tracked feed.
    expect(createPlayer).toHaveBeenCalledTimes(1);
  });

  it('tears the player down on UNMOUNT only', () => {
    const onFeedLive = vi.fn();
    const onFeedRemoved = vi.fn();
    let serverStatus: unknown = { tick: 0 };
    const { result, rerender, unmount } = renderHook(() =>
      useSyntheticFeeds({ serverStatus, onFeedLive, onFeedRemoved }),
    );

    act(() => { result.current.setNewFeedKey('live-cam'); });
    act(() => { result.current.addSyntheticFeed(); });
    expect(createPlayer).toHaveBeenCalledTimes(1);

    // A status tick must not tear down...
    serverStatus = { tick: 1 };
    act(() => { rerender(); });
    expect(destroy).not.toHaveBeenCalled();

    // ...but unmount must.
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
