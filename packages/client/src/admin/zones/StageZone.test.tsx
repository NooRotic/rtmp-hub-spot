/// <reference types="vitest" />
/**
 * Focused render test for StageZone (props in → DOM out). The AdminApp.*.test.tsx
 * characterization files remain the integration guard; this keeps the zone honest
 * in isolation.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '../../test/testUtils';
import { StageZone, type StageZoneProps } from './StageZone';

const baseProps = (over: Partial<StageZoneProps> = {}): StageZoneProps => ({
  isElectron: false,
  isAdminMode: true,
  deviceControls: {
    videoDevices: [],
    audioDevices: [],
    selectedVideo: '',
    setSelectedVideo: vi.fn(),
    selectedAudio: '',
    setSelectedAudio: vi.fn(),
  },
  broadcastControls: {
    adminCamActive: false,
    setAdminCamActive: vi.fn(),
    showGrid: false,
    setShowGrid: vi.fn(),
    isGridShared: false,
    setIsGridShared: vi.fn(),
  },
  selfFeed: {
    cameraError: null,
    userStream: null,
    isVideoEnabled: true,
    setIsVideoEnabled: vi.fn(),
    isAudioEnabled: true,
    setIsAudioEnabled: vi.fn(),
    serverLocalIP: undefined,
  },
  peerControls: {
    peers: [],
    spotlightId: null,
    setSpotlightId: vi.fn(),
    kickUser: vi.fn(),
  },
  gridControls: {
    allStreams: [],
    setGridStream: vi.fn(),
    broadcastBitrate: '2500k',
    broadcastPreset: 'ultrafast',
    hwAccel: 'none',
    gridAutoLayout: true,
    showWatermark: false,
    watermarkPos: 'bottom-right',
    showSettingsOverlay: false,
  },
  ...over,
});

afterEach(cleanup);

describe('StageZone', () => {
  it('renders the Admin Monitor window + MONITOR MODE chip in browser mode', () => {
    render(<StageZone {...baseProps({ isElectron: false })} />);
    expect(screen.getByText('Admin Monitor')).toBeInTheDocument();
    expect(screen.getByText(/monitor mode/i)).toBeInTheDocument();
    expect(screen.queryByText(/START ADMIN CAMERA/i)).toBeNull();
  });

  it('renders the Electron broadcast controls + Admin Video Hub title in Electron mode', () => {
    render(<StageZone {...baseProps({ isElectron: true })} />);
    expect(screen.getByText('Admin Video Hub')).toBeInTheDocument();
    expect(screen.getByText(/START ADMIN CAMERA/i)).toBeInTheDocument();
    expect(screen.getByText(/SHARE GRID TO ALL/i)).toBeInTheDocument();
    expect(screen.queryByText(/monitor mode/i)).toBeNull();
  });

  it('fires setAdminCamActive when the camera button is clicked', () => {
    const setAdminCamActive = vi.fn();
    render(<StageZone {...baseProps({
      isElectron: true,
      broadcastControls: { ...baseProps().broadcastControls, setAdminCamActive },
    })} />);
    fireEvent.click(screen.getByText(/START ADMIN CAMERA/i));
    expect(setAdminCamActive).toHaveBeenCalledWith(true);
  });

  it('renders the camera-error alert when cameraError is set and no userStream', () => {
    render(<StageZone {...baseProps({
      selfFeed: { ...baseProps().selfFeed, cameraError: 'no device' },
    })} />);
    expect(screen.getByText(/CAMERA UNAVAILABLE/i)).toBeInTheDocument();
    expect(screen.getByText('no device')).toBeInTheDocument();
  });

  it('renders one peer tile per streamed peer', () => {
    const { container } = render(<StageZone {...baseProps({
      peerControls: {
        ...baseProps().peerControls,
        peers: [{ id: 'peer-1', name: 'Guest', stream: new MediaStream() }],
      },
    })} />);
    expect(container.querySelectorAll('video').length).toBe(1);
  });

  it('scopes the [data-nt-stage] box to the tiles/grid, excluding the camera/mic controls', () => {
    // Regression: the marker used to sit on the whole .window-content, so a
    // dragged/restored NT window clamped to the top of the controls and covered
    // the camera/mic selectors. The stage box must start BELOW the controls.
    const { container } = render(<StageZone {...baseProps({
      isElectron: true,
      peerControls: {
        ...baseProps().peerControls,
        peers: [{ id: 'peer-1', name: 'Guest', stream: new MediaStream() }],
      },
    })} />);
    const stage = container.querySelector('[data-nt-stage]');
    expect(stage).not.toBeNull();
    // Camera/mic <select>s live ABOVE the stage box — never inside it.
    const selects = container.querySelectorAll('select');
    expect(selects.length).toBeGreaterThan(0);
    selects.forEach((sel) => expect(stage!.contains(sel)).toBe(false));
    // The peer tile (its <video>) lives INSIDE the stage box.
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(stage!.contains(video)).toBe(true);
  });
});
