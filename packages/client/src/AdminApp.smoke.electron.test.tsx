/// <reference types="vitest" />
/**
 * Phase 0 characterization smoke test — AdminApp in ELECTRON mode.
 *
 * This MUST be its own file: it mutates the global navigator.userAgent (and
 * sets window.electron) before importing AdminApp, because Electron detection
 * (useElectronBridge.isElectron) is evaluated at module-eval time. Putting it
 * here keeps that mutation from leaking into the browser-mode file.
 *
 * Harness rules honored:
 *  - Electron globals installed BEFORE the dynamic `await import('./AdminApp')`.
 *  - Custom render/screen (react-dom/client + act) — NOT @testing-library/react.
 *  - mpegts.js mseLivePlayback:false keeps the synthetic-feed effect inert so
 *    the render stays synchronous.
 *  - window.electron = makeFakeIpc().ipc so the get-host-token invoke().then
 *    resolves (a thenable returning undefined), and we can assert it was called.
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

// Same mocks as the browser file. Hoisted vi.mock factories apply to the dynamic
// import below regardless of statement order.
vi.mock('./hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    peers: [],
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

// Import AFTER the Electron globals exist so module-level isElectron/getIpc resolve true.
const { default: AdminApp } = await import('./AdminApp');

describe('AdminApp (Electron host console) — characterization', () => {
  afterEach(cleanup);

  it('renders the Electron-only title bar', () => {
    render(<AdminApp />);
    expect(screen.getByText(/RTMP HUB SPOT - ADMINISTRATOR/i)).toBeInTheDocument();
    // Electron window title is "Admin Video Hub" (browser monitor shows "Admin Monitor").
    expect(screen.getByText('Admin Video Hub')).toBeInTheDocument();
  });

  it('renders the Electron broadcast controls', () => {
    render(<AdminApp />);
    expect(screen.getByText(/START ADMIN CAMERA/i)).toBeInTheDocument();
    expect(screen.getByText(/SHARE GRID TO ALL/i)).toBeInTheDocument();
    // The browser-only monitor chip must be absent in Electron mode.
    expect(screen.queryByText(/monitor mode/i)).toBeNull();
  });

  it('requests the host token over IPC on mount', () => {
    render(<AdminApp />);
    expect(ipc.invoke).toHaveBeenCalledWith('get-host-token');
  });

  it('toggles the admin camera button label on click (setAdminCamActive)', () => {
    render(<AdminApp />);
    // Starts OFF → label reads START; clicking flips to STOP, clicking again restores.
    expect(screen.getByText(/START ADMIN CAMERA/i)).toBeInTheDocument();
    expect(screen.queryByText(/STOP ADMIN CAMERA/i)).toBeNull();

    fireEvent.click(screen.getByText(/START ADMIN CAMERA/i));
    expect(screen.getByText(/STOP ADMIN CAMERA/i)).toBeInTheDocument();
    expect(screen.queryByText(/START ADMIN CAMERA/i)).toBeNull();

    fireEvent.click(screen.getByText(/STOP ADMIN CAMERA/i));
    expect(screen.getByText(/START ADMIN CAMERA/i)).toBeInTheDocument();
  });

  it('toggles grid view + grid sharing button labels (setShowGrid / setIsGridShared)', () => {
    render(<AdminApp />);
    // showGrid defaults ON in Electron, so the label starts at DISABLE.
    expect(screen.getByText(/DISABLE GRID VIEW/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/DISABLE GRID VIEW/i));
    expect(screen.getByText(/ENABLE GRID VIEW/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/ENABLE GRID VIEW/i));
    expect(screen.getByText(/DISABLE GRID VIEW/i)).toBeInTheDocument();

    // isGridShared defaults OFF → label starts at SHARE.
    expect(screen.getByText(/SHARE GRID TO ALL/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/SHARE GRID TO ALL/i));
    expect(screen.getByText(/STOP SHARING GRID/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/STOP SHARING GRID/i));
    expect(screen.getByText(/SHARE GRID TO ALL/i)).toBeInTheDocument();
  });

  it('opens the Settings drawer and drives the Grid-Controls toggles (auto layout / watermark / burn-in)', () => {
    render(<AdminApp />);

    // Grid Controls live in the Settings drawer (closed until the gear is clicked).
    expect(screen.queryByText(/Auto Layout/i)).toBeNull();
    fireEvent.click(screen.getByText(/^⚙$/));
    expect(screen.getByText(/Auto Layout/i)).toBeInTheDocument();

    const checkboxFor = (labelRe: RegExp) =>
      screen.getByText(labelRe).closest('div')!
        .querySelector('input[type=checkbox]') as HTMLInputElement;

    // Auto Layout starts checked (gridAutoLayout default true) → click unchecks it.
    const autoLayout = checkboxFor(/Auto Layout/i);
    expect(autoLayout.checked).toBe(true);
    fireEvent.click(autoLayout);
    expect(autoLayout.checked).toBe(false);

    // Timestamp Watermark starts unchecked; enabling it reveals the Watermark Pos select.
    expect(screen.queryByText(/Watermark Pos/i)).toBeNull();
    const watermark = checkboxFor(/Timestamp Watermark/i);
    expect(watermark.checked).toBe(false);
    fireEvent.click(watermark);
    expect(watermark.checked).toBe(true);
    expect(screen.getByText(/Watermark Pos/i)).toBeInTheDocument();

    // Drive the now-visible Watermark Pos select (setWatermarkPos).
    const posSelect = screen.getByText(/Watermark Pos/i).closest('div')!
      .querySelector('select') as HTMLSelectElement;
    expect(posSelect.value).toBe('bottom-right');
    fireEvent.change(posSelect, { target: { value: 'top-left' } });
    expect(posSelect.value).toBe('top-left');

    // Burn-in Settings starts unchecked → click checks it (setShowSettingsOverlay).
    const burnIn = checkboxFor(/Burn-in Settings/i);
    expect(burnIn.checked).toBe(false);
    fireEvent.click(burnIn);
    expect(burnIn.checked).toBe(true);
  });
});
