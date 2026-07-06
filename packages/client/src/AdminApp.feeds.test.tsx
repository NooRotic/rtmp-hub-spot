/// <reference types="vitest" />
/**
 * Phase 0 characterization — AdminApp synthetic RTMP feed add/remove (browser mode).
 *
 * With mpegts.js mseLivePlayback:false the feed effect never spins up an FLV
 * player, so a freshly added feed stays in the [FETCHING] state (stream === null)
 * and every assertion is synchronous. This pins the Add-Feed drawer CRUD.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from './test/testUtils';

history.replaceState(null, '', '/?role=admin');

vi.mock('./hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    peers: [],
    userStream: null,
    isConnected: false,
    socketStatus: 'disconnected',
    chatMessages: [],
    sendMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isVideoEnabled: true,
    setIsVideoEnabled: vi.fn(),
    isAudioEnabled: true,
    setIsAudioEnabled: vi.fn(),
    serverStatus: null,
    recordingStopped: null,
    wasKicked: false,
    kickUser: vi.fn(),
    isLive: false,
    cameraError: null,
  }),
}));

vi.mock('./hooks/useMediaDevices', () => ({
  useMediaDevices: () => ({ videoDevices: [], audioDevices: [] }),
}));

vi.mock('mpegts.js', () => ({
  default: {
    getFeatureList: () => ({ mseLivePlayback: false }),
    createPlayer: vi.fn(() => ({
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      destroy: vi.fn(),
    })),
  },
}));

import AdminApp from './AdminApp';

describe('AdminApp Add RTMP Feed drawer (browser) — characterization', () => {
  beforeEach(() => { cleanup(); });
  afterEach(cleanup);

  it('adds a feed row (label + [FETCHING]) then removes it', () => {
    render(<AdminApp />);

    // Open the Add RTMP Feed drawer via the top-bar trigger.
    fireEvent.click(screen.getByText(/feed/i));

    // Fill the Stream Key, leave the Label blank (label falls back to the key).
    const keyInput = screen.getByPlaceholderText(/Stream Key/i);
    fireEvent.change(keyInput, { target: { value: 'guest-cam-7' } });
    // The custom fireEvent.change pins `value` as a non-writable property. The
    // controlled input is cleared (setNewFeedKey('')) on submit, so React must
    // write `value=''` back — restore a plain writable value first so that the
    // reconciler's controlled-input update doesn't throw.
    Object.defineProperty(keyInput, 'value', {
      configurable: true,
      writable: true,
      value: 'guest-cam-7',
    });

    fireEvent.click(screen.getByText(/CONNECT EXT FEED/i));

    // The feed row shows the label (== key) and the [FETCHING] state
    // (mseLivePlayback:false → no player → stream stays null).
    expect(screen.getByText('guest-cam-7')).toBeInTheDocument();
    expect(screen.getByText(/\[FETCHING\]/i)).toBeInTheDocument();

    // The row's per-feed "Grid" checkbox drives toggleGridMember(f.id). It starts
    // unchecked (a freshly added feed is NOT auto-gridded until its stream plays),
    // and clicking it flips the membership → checkbox becomes checked. The label
    // wrapping it reads "... Grid"; locate the row by its 📡 label and grab the
    // sole checkbox inside that row.
    const feedRow = screen.getByText('guest-cam-7').closest('div[style*="border-bottom"]')
      ?? screen.getByText('guest-cam-7').closest('div')!.parentElement!;
    const gridCheckbox = (feedRow as HTMLElement)
      .querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(gridCheckbox).toBeTruthy();
    expect(gridCheckbox.checked).toBe(false);
    fireEvent.click(gridCheckbox);
    expect(gridCheckbox.checked).toBe(true);
    fireEvent.click(gridCheckbox);
    expect(gridCheckbox.checked).toBe(false);

    // Remove it via the row's "X" button; the row disappears.
    fireEvent.click(screen.getByText(/^X$/));

    expect(screen.queryByText('guest-cam-7')).toBeNull();
    expect(screen.queryByText(/\[FETCHING\]/i)).toBeNull();
  });
});
