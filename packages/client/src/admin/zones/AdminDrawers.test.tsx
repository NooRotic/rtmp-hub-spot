/// <reference types="vitest" />
/**
 * Focused render test for AdminDrawers (props in → DOM out). The AdminApp.*.test.tsx
 * characterization files remain the integration guard.
 *
 * SettingsDrawer → SettingsTab reads AdminDataProvider context, so the Settings
 * drawer is wrapped in a minimal provider. The Recordings + Add-Feed drawers don't
 * need it for the assertions here.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { AdminDrawers, type AdminDrawersProps } from './AdminDrawers';
import type { RelayEntry } from '../../hooks/useRelays';

const adminData: AdminData = {
  socketStatus: 'connected',
  isConnected: true,
  serverStatus: null,
  sources: [],
  relays: new Map<string, RelayEntry>(),
  destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};

const baseProps = (over: Partial<AdminDrawersProps> = {}): AdminDrawersProps => ({
  drawers: {
    settingsOpen: false,
    recOpen: false,
    addFeedOpen: false,
    onCloseSettings: vi.fn(),
    onCloseRecordings: vi.fn(),
    onCloseAddFeed: vi.fn(),
    ...over.drawers,
  },
  settingsControls: {
    isAdminMode: true,
    includeAdmin: true,
    toggleGridMember: vi.fn(),
    gridAutoLayout: true,
    setGridAutoLayout: vi.fn(),
    showWatermark: false,
    setShowWatermark: vi.fn(),
    watermarkPos: 'bottom-right',
    setWatermarkPos: vi.fn(),
    showSettingsOverlay: false,
    setShowSettingsOverlay: vi.fn(),
    streamCount: 0,
    rtmpCount: 0,
    ...over.settingsControls,
  },
  feedControls: {
    newFeedKey: '',
    setNewFeedKey: vi.fn(),
    newFeedLabel: '',
    setNewFeedLabel: vi.fn(),
    addSyntheticFeed: vi.fn(),
    removeSyntheticFeed: vi.fn(),
    syntheticFeeds: [],
    isGridMember: () => false,
    toggleGridMember: vi.fn(),
    ...over.feedControls,
  },
});

const renderDrawers = (props: AdminDrawersProps) =>
  render(
    <AdminDataProvider value={adminData}>
      <AdminDrawers {...props} />
    </AdminDataProvider>
  );

afterEach(cleanup);

describe('AdminDrawers', () => {
  it('renders nothing visible when all drawers closed', () => {
    renderDrawers(baseProps());
    expect(screen.queryByText(/Grid Controls/i)).toBeNull();
    expect(screen.queryByText(/Stream Key/i)).toBeNull();
  });

  it('renders Grid Controls + System Status when the Settings drawer is open', () => {
    renderDrawers(baseProps({ drawers: { settingsOpen: true, recOpen: false, addFeedOpen: false, onCloseSettings: vi.fn(), onCloseRecordings: vi.fn(), onCloseAddFeed: vi.fn() } }));
    expect(screen.getByText(/Grid Controls/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto Layout/i)).toBeInTheDocument();
    expect(screen.getByText(/System Status/i)).toBeInTheDocument();
  });

  it('reveals the Watermark Pos select only when showWatermark is true', () => {
    renderDrawers(baseProps({
      drawers: { settingsOpen: true, recOpen: false, addFeedOpen: false, onCloseSettings: vi.fn(), onCloseRecordings: vi.fn(), onCloseAddFeed: vi.fn() },
      settingsControls: { ...baseProps().settingsControls, showWatermark: true },
    }));
    expect(screen.getByText(/Watermark Pos/i)).toBeInTheDocument();
  });

  it('renders the Add-Feed form when the Add-Feed drawer is open', () => {
    renderDrawers(baseProps({ drawers: { settingsOpen: false, recOpen: false, addFeedOpen: true, onCloseSettings: vi.fn(), onCloseRecordings: vi.fn(), onCloseAddFeed: vi.fn() } }));
    expect(screen.getByPlaceholderText(/Stream Key/i)).toBeInTheDocument();
    expect(screen.getByText(/CONNECT EXT FEED/i)).toBeInTheDocument();
  });

  it('lists synthetic feeds with a [FETCHING] tag and fires addSyntheticFeed', () => {
    const addSyntheticFeed = vi.fn();
    renderDrawers(baseProps({
      drawers: { settingsOpen: false, recOpen: false, addFeedOpen: true, onCloseSettings: vi.fn(), onCloseRecordings: vi.fn(), onCloseAddFeed: vi.fn() },
      feedControls: {
        ...baseProps().feedControls,
        addSyntheticFeed,
        syntheticFeeds: [{ id: 'f1', streamKey: 'guest1', label: 'Guest Cam', stream: null }],
      },
    }));
    expect(screen.getByText('Guest Cam')).toBeInTheDocument();
    expect(screen.getByText(/FETCHING/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/CONNECT EXT FEED/i));
    expect(addSyntheticFeed).toHaveBeenCalled();
  });
});
