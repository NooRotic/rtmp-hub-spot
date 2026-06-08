import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '../test/testUtils';
import { AdminDataProvider, type AdminData } from './AdminDataProvider';
import { ServerStatusBar } from './ServerStatusBar';
import type { RelayEntry } from '../hooks/useRelays';

const data = (over: Partial<AdminData> = {}): AdminData => ({
  socketStatus: 'connected',
  isConnected: true,
  serverStatus: { local: '10.0.0.5', public: 'x', clientCount: 3, rtmpCount: 2, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
  sources: [{ sourceKey: 'grid', isLive: true }, { sourceKey: 'feed', isLive: false }],
  relays: new Map<string, RelayEntry>([['grid::yt', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }]]),
  destinations: [], bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
  ...over,
});

const renderBar = (over?: Partial<AdminData>) =>
  render(<AdminDataProvider value={data(over)}><ServerStatusBar /></AdminDataProvider>);

afterEach(cleanup);

describe('ServerStatusBar', () => {
  it('shows local IP, client + publisher counts', () => {
    const { container } = renderBar();
    expect(container.textContent).toContain('10.0.0.5');
    expect(container.textContent).toContain('3');  // clients
    expect(container.textContent).toContain('2');  // publishers
  });

  it('shows the live-sources → destinations rollup', () => {
    const { container } = renderBar();
    // 1 live source (grid), 1 active relay destination
    expect(container.textContent).toMatch(/1\s*sources?\s*→\s*1\s*destinations?/i);
  });

  it('signaling dot is live when connected, error when disconnected', () => {
    const { container: live } = renderBar();
    expect(live.querySelector('.ntd-dot--live')).toBeTruthy();
    cleanup();
    const { container: down } = renderBar({ isConnected: false, socketStatus: 'disconnected' });
    expect(down.querySelector('.ntd-dot--error')).toBeTruthy();
  });

  it('shows the client Join URL built from the LAN IP', () => {
    const { container } = renderBar();
    const join = container.querySelector('.ntd-statusbar__join');
    expect(join).toBeTruthy();
    expect(join!.textContent).toContain('10.0.0.5'); // LAN IP from serverStatus.local
    expect(join!.textContent).toMatch(/^https?:\/\//);
  });

  it('shows 🔒 glyph when roomAccess.locked is true', () => {
    const { container } = renderBar({ roomAccess: { locked: true, setPin: async () => {}, clearPin: async () => {} } });
    const lockSpan = container.querySelector('[title="Room locked — PIN required"]');
    expect(lockSpan).toBeTruthy();
    expect(lockSpan!.textContent).toContain('🔒');
  });

  it('shows 🔓 glyph when roomAccess.locked is false', () => {
    const { container } = renderBar({ roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} } });
    const openSpan = container.querySelector('[title="Room open"]');
    expect(openSpan).toBeTruthy();
    expect(openSpan!.textContent).toContain('🔓');
  });
});
