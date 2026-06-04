import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
// Use the client-local render wrapper (react-dom/client + act), not
// @testing-library/react, which lives in root node_modules (React 19) and triggers
// a dual-React-instance error against the client's React 18. See test/testUtils.
import { render, cleanup } from './test/testUtils';

// Mock mpegts.js so getFeatureList reports MSE support (jsdom has none) and
// createPlayer is a spy we can inspect the playback URL on. vi.hoisted lets the
// spy exist before the hoisted vi.mock factory references it.
const { createPlayer } = vi.hoisted(() => ({
  // Typed config param so createPlayer.mock.calls[0][0].url type-checks under tsc.
  createPlayer: vi.fn((_cfg: { type: string; isLive: boolean; url: string }) => ({
    attachMediaElement: vi.fn(),
    load: vi.fn(),
    play: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(),
  })),
}));
vi.mock('mpegts.js', () => ({
  default: {
    getFeatureList: () => ({ mseLivePlayback: true }),
    createPlayer,
  },
}));

import { RtmpPlayerTile } from './App';

describe('RtmpPlayerTile preview URL', () => {
  beforeEach(() => {
    createPlayer.mockClear();
    cleanup();
  });

  it('plays back from loopback (127.0.0.1), never a LAN IP', () => {
    // The admin renderer is co-located with NMS, which binds 0.0.0.0 by default,
    // so playback must target loopback — using the LAN IP is both CSP-blocked and
    // pointless. This guards against re-introducing the serverStatus.local conflation.
    render(<RtmpPlayerTile streamKey="out-b" />);

    expect(createPlayer).toHaveBeenCalledTimes(1);
    const { url } = createPlayer.mock.calls[0][0];
    expect(url).toBe('http://127.0.0.1:8000/live/out-b.flv');
    expect(url).not.toMatch(/10\.0\.0\.\d+/); // not the LAN IP that triggered the CSP block
  });
});
