import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '../test/testUtils';
import { AdminDataProvider, useAdminData, type AdminData } from './AdminDataProvider';

afterEach(cleanup);

const stubData = (over: Partial<AdminData> = {}): AdminData => ({
  socketStatus: 'connected',
  isConnected: true,
  serverStatus: { local: '10.0.0.5', public: 'x', clientCount: 2, rtmpCount: 1, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
  sources: [{ sourceKey: 'grid', isLive: true }],
  relays: new Map(),
  destinations: [],
  bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(),
  setPreviewOpen: () => {},
  refreshTelemetry: () => {},
  ...over,
});

function Probe() {
  const d = useAdminData();
  return <span>IP:{d.serverStatus?.local} CLIENTS:{d.serverStatus?.clientCount}</span>;
}

describe('AdminDataProvider', () => {
  it('exposes the provided value via useAdminData', () => {
    render(
      <AdminDataProvider value={stubData()}>
        <Probe />
      </AdminDataProvider>,
    );
    expect(screen.getByText(/IP:10\.0\.0\.5/)).toBeTruthy();
    expect(screen.getByText(/CLIENTS:2/)).toBeTruthy();
  });

  it('throws a clear error when used outside the provider', () => {
    expect(() => render(<Probe />)).toThrow(/useAdminData must be used within an AdminDataProvider/);
  });
});
