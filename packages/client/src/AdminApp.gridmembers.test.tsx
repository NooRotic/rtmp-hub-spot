/// <reference types="vitest" />
/**
 * Phase 1b (Decision Gate D1-B) BEHAVIOR test — gridMembers now GATES the grid.
 *
 * Until Phase 1b, `gridMembers` was dead: the Settings "Include Admin" checkbox
 * (and the per-feed "Grid" checkbox) toggled the Set but the `allStreams` memo
 * ignored it, so unchecking changed nothing in the rendered grid. This test pins
 * the new behavior: the local tile is composited into the grid ONLY when
 * `gridMembers.has('local')`, so unchecking "Include Admin" REMOVES it.
 *
 * Electron mode is the testable path: useWebRTC is mocked to return a real
 * cameraStream (jsdom MockMediaStream) and no peers/feeds. After clicking
 * "START ADMIN CAMERA" the local tile qualifies (cameraStream && adminCamActive &&
 * gridMembers.has('local')), so `allStreams` === [local] and — because showGrid
 * defaults ON in Electron and allStreams.length > 0 — the GridView ("Combined
 * Grid View") renders. With no peers and no feeds, the local membership is the
 * SOLE thing keeping allStreams non-empty, so toggling "Include Admin":
 *   checked  → allStreams = [local] → GridView present
 *   unchecked→ allStreams = []      → GridView absent
 *
 * This FAILS if the gating is reverted (without the `gridMembers.has('local')`
 * conjunct, unchecking leaves allStreams = [local] and GridView stays mounted).
 *
 * Harness rules honored (mirrors the Electron smoke file):
 *  - Electron globals + window.electron installed BEFORE the dynamic import.
 *  - Custom render/screen/fireEvent (react-dom/client + act).
 *  - mpegts.js mseLivePlayback:false keeps the synthetic-feed effect inert.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from './test/testUtils';
import { makeFakeIpc } from './test/fakeIpc';

// --- Electron-like environment, installed BEFORE AdminApp import ---
Object.defineProperty(navigator, 'userAgent', {
  value: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Electron/40.0.0 Safari/537.36',
  configurable: true,
});

const { ipc } = makeFakeIpc();
(window as any).electron = { ipcRenderer: ipc };

// cameraStream is a real (mock) MediaStream so the local tile can qualify once the
// admin camera is started. No peers, no feeds → local membership is the only
// thing that can keep `allStreams` non-empty.
vi.mock('./hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    peers: [],
    userStream: new MediaStream(),
    cameraStream: new MediaStream(),
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

const { default: AdminApp } = await import('./AdminApp');

describe('AdminApp (Electron host) — gridMembers gates the composite grid', () => {
  afterEach(cleanup);

  const includeAdminCheckbox = () =>
    screen.getByText(/include admin/i)
      .closest('div')!
      .querySelector('input[type=checkbox]') as HTMLInputElement;

  it('local tile enters/leaves the grid as "Include Admin" membership is toggled', () => {
    render(<AdminApp />);

    // Before starting the admin camera the local tile does not qualify
    // (adminCamActive is false), so with no peers/feeds allStreams is empty and
    // GridView is not mounted.
    expect(screen.queryByText(/Combined Grid View/i)).toBeNull();

    // Start the admin camera → local tile now qualifies AND gridMembers is seeded
    // with 'local', so allStreams = [local] and the grid renders.
    fireEvent.click(screen.getByText(/START ADMIN CAMERA/i));
    expect(screen.getByText(/Combined Grid View/i)).toBeInTheDocument();

    // Open Settings to reach the "Include Admin" grid-membership checkbox. It is
    // checked because the Set is seeded with 'local'.
    fireEvent.click(screen.getByText(/^⚙$/));
    expect(includeAdminCheckbox().checked).toBe(true);

    // UNCHECK "Include Admin" → gridMembers no longer has 'local' → allStreams = []
    // → GridView unmounts. This is the proof the gating is live: pre-Phase-1b this
    // toggle changed nothing and the grid stayed.
    fireEvent.click(includeAdminCheckbox());
    expect(includeAdminCheckbox().checked).toBe(false);
    expect(screen.queryByText(/Combined Grid View/i)).toBeNull();

    // RE-CHECK restores membership → the local tile (and the grid) comes back.
    fireEvent.click(includeAdminCheckbox());
    expect(includeAdminCheckbox().checked).toBe(true);
    expect(screen.getByText(/Combined Grid View/i)).toBeInTheDocument();
  });
});
