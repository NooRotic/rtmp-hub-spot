/// <reference types="vitest" />
/**
 * Phase 0 characterization smoke test — AdminApp in BROWSER ?role=admin mode.
 *
 * Goal: lock the current admin-monitor DOM so the planned refactors can be
 * verified to preserve behavior. This file deliberately exercises the
 * non-Electron path: jsdom's default userAgent (no " Electron/"), and the
 * URL is forced to "/?role=admin" BEFORE AdminApp is imported so isAdminMode
 * resolves true.
 *
 * Harness rules honored:
 *  - One mode per file (browser only here; Electron lives in the sibling file
 *    so its userAgent mutation can't leak in).
 *  - Custom render/screen/fireEvent (react-dom/client + act) — NOT
 *    @testing-library/react, which is React 19 in root node_modules.
 *  - mpegts.js getFeatureList().mseLivePlayback === false so the synthetic-feed
 *    effect short-circuits and never spins up async FLV players — assertions
 *    stay synchronous.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from './test/testUtils';

// Force the URL to admin BEFORE importing AdminApp. isAdminMode reads
// window.location.search via URLSearchParams at render time, but doing this at
// module top keeps it deterministic regardless of import order.
history.replaceState(null, '', '/?role=admin');

// useWebRTC drives the whole console; mock the full shape (verbatim from
// App.test.tsx, which proves these keys are exactly what AdminApp destructures).
// One peer WITH a stream is supplied so the stage renders a real VideoFeed tile
// (AdminApp.tsx peers.map → <video>), giving the tile-count assertions a non-zero
// baseline instead of the previous always-0 (vacuous) count. MediaStream is the
// jsdom stub installed in test/setup.ts.
vi.mock('./hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    peers: [{ id: 'peer-1', name: 'Guest', stream: new MediaStream() }],
    userStream: null,
    cameraStream: null,
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

// mseLivePlayback:false short-circuits the synthetic-feed effect (no async FLV
// players), keeping the render fully synchronous. createPlayer is still provided
// so the contract is complete if the effect were ever reached.
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

describe('AdminApp (browser ?role=admin monitor mode) — characterization', () => {
  beforeEach(() => { cleanup(); });
  afterEach(cleanup);

  it('renders the AdminTopBar status cluster', () => {
    render(<AdminApp />);
    // AdminTopBar reproduces the server status strip verbatim.
    expect(screen.getByText(/signaling/i)).toBeInTheDocument();
    expect(screen.getByText(/publishers/i)).toBeInTheDocument();
    // The "+ Feed" action button lives in the top bar.
    expect(screen.getByText(/feed/i)).toBeInTheDocument();
  });

  it('renders the monitor stage (Admin Monitor window + MONITOR MODE chip)', () => {
    render(<AdminApp />);
    // Browser admin: window title is "Admin Monitor" (Electron shows "Admin Video Hub").
    expect(screen.getByText('Admin Monitor')).toBeInTheDocument();
    // Non-Electron broadcast lane shows the read-only monitor chip.
    expect(screen.getByText(/monitor mode/i)).toBeInTheDocument();
    // Electron-only title bar string must NOT appear in browser mode.
    expect(screen.queryByText(/RTMP HUB SPOT - ADMINISTRATOR/i)).toBeNull();
  });

  it('renders the persistent BroadcastConsole region', () => {
    render(<AdminApp />);
    // Console head label + the empty-state SOURCES copy.
    expect(screen.getByText('Broadcast')).toBeInTheDocument();
    expect(screen.getByText(/no live sources/i)).toBeInTheDocument();
  });

  it('opens the Add RTMP Feed drawer when its top-bar trigger is clicked', () => {
    render(<AdminApp />);
    // Drawer renders nothing until opened (NTDrawer returns null when closed).
    expect(screen.queryByText(/Stream Key/i)).toBeNull();

    fireEvent.click(screen.getByText(/feed/i));

    // Now the drawer's Stream Key input placeholder is present.
    expect(screen.getByPlaceholderText(/Stream Key/i)).toBeInTheDocument();
    expect(screen.getByText(/CONNECT EXT FEED/i)).toBeInTheDocument();
  });

  it('renders one peer tile and toggling "Include Admin" leaves the peer-tile count unchanged', () => {
    // The single peer (with a stream) renders exactly one VideoFeed <video> tile,
    // so there is a real, non-zero baseline to compare against. "Include Admin"
    // flips the gridMembers Set, but that Set does not feed the peers.map that
    // produces stage tiles — so the rendered peer-tile count must not move. This
    // is an interaction/stability check on the checkbox, not proof about how
    // gridMembers is (or isn't) consumed elsewhere.
    const { container } = render(<AdminApp />);
    const tileCount = () => container.querySelectorAll('video').length;

    const before = tileCount();
    // Non-zero baseline: the one streamed peer renders one tile (vs. the old
    // assertion which compared 0 to 0 and proved nothing).
    expect(before).toBe(1);

    // Open Settings (gear) to reveal the Grid Controls "Include Admin" checkbox.
    fireEvent.click(screen.getByText(/^⚙$/));
    const includeAdmin = screen.getByText(/include admin/i)
      .closest('div')!
      .querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(includeAdmin).toBeTruthy();
    // It starts checked because gridMembers is seeded with 'local'.
    const checkedBefore = includeAdmin.checked;

    fireEvent.click(includeAdmin);

    // The checkbox state itself flips (the click is wired)...
    expect(includeAdmin.checked).toBe(!checkedBefore);
    // ...but the rendered peer-tile count is unaffected by the toggle.
    expect(tileCount()).toBe(before);
    expect(tileCount()).toBe(1);
  });
});
