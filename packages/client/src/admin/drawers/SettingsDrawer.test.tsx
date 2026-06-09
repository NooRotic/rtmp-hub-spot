import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { SettingsDrawer } from './SettingsDrawer';

const base: AdminData = {
  socketStatus: 'connected', isConnected: true,
  serverStatus: null, sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: vi.fn(async () => {}), clearPin: vi.fn(async () => {}) },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};

afterEach(cleanup);

describe('SettingsDrawer', () => {
  it('renders broadcast settings + room access inside the drawer when open', () => {
    const { container } = render(<AdminDataProvider value={base}><SettingsDrawer open onClose={() => {}} /></AdminDataProvider>);
    expect(container.querySelector('.ntd-drawer')).toBeTruthy();
    expect(container.textContent).toMatch(/bitrate/i);
    expect(container.textContent).toMatch(/room access|room pin|set pin/i);
  });
  it('renders the extra slot content', () => {
    const { container } = render(<AdminDataProvider value={base}><SettingsDrawer open onClose={() => {}} extra={<div data-field="extra-slot">grid options</div>} /></AdminDataProvider>);
    expect(container.querySelector('[data-field="extra-slot"]')).toBeTruthy();
  });
  it('renders nothing when closed', () => {
    const { container } = render(<AdminDataProvider value={base}><SettingsDrawer open={false} onClose={() => {}} /></AdminDataProvider>);
    expect(container.querySelector('.ntd-drawer')).toBeNull();
  });
});
