import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { AdminDataProvider, type AdminData } from './AdminDataProvider';
import { AdminWorkspace } from './AdminWorkspace';
import type { RelayEntry } from '../hooks/useRelays';

const data = (over: Partial<AdminData> = {}): AdminData => ({
  socketStatus: 'connected', isConnected: true,
  serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 0, rtmpSessions: [], rtmpPublishers: [] },
  sources: [], relays: new Map<string, RelayEntry>(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
  ...over,
});

const renderWs = (over?: Partial<AdminData>) =>
  render(<AdminDataProvider value={data(over)}><AdminWorkspace /></AdminDataProvider>);

afterEach(cleanup);

describe('AdminWorkspace', () => {
  it('shows the Live tab by default and switches tabs on click', () => {
    const { container } = renderWs();
    const tabs = [...container.querySelectorAll('.ntd-tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['Live', 'Destinations', 'Recordings', 'Settings']);
    expect(container.querySelector('.ntd-tab--active')?.textContent).toBe('Live');
    fireEvent.click(screen.getByText('Settings'));
    expect(container.querySelector('.ntd-tab--active')?.textContent).toBe('Settings');
    expect(container.textContent).toMatch(/bitrate/i);
  });

  it('Destinations tab renders the destinations panel', () => {
    const { container } = renderWs();
    fireEvent.click(screen.getByText('Destinations'));
    expect(container.textContent).toMatch(/add destination|no destinations/i);
  });
});
