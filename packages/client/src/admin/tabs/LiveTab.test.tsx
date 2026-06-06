import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { LiveTab } from './LiveTab';

// RtmpPlayerTile uses mpegts.js; mock it so the preview toggle renders inertly.
vi.mock('../../components/RtmpPlayerTile', () => ({
  RtmpPlayerTile: ({ streamKey }: { streamKey: string }) => <div data-testid="preview">{streamKey}</div>,
  localFlvUrl: (k: string) => `http://127.0.0.1:8000/live/${k}.flv`,
}));

const base: AdminData = {
  socketStatus: 'connected', isConnected: true,
  serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 1, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
  sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: { frame: 90, fps: 30, bitrate: '2500k', speed: 1, time: '00:00:03', size: '1MB', streamKey: 'grid' } },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};
const render_ = (over: Partial<AdminData> = {}) =>
  render(<AdminDataProvider value={{ ...base, ...over }}><LiveTab /></AdminDataProvider>);

afterEach(cleanup);

describe('LiveTab', () => {
  it('shows the ffmpeg pipeline status', () => {
    const { container } = render_();
    expect(container.textContent).toMatch(/running/i);
  });

  it('lists publishers and starts a recording when none active for that key', () => {
    const start = vi.fn();
    render_({ recordings: { ...base.recordings, start } });
    expect(screen.getByText('grid')).toBeTruthy();
    fireEvent.click(screen.getByText(/rec/i));
    expect(start).toHaveBeenCalledWith('grid');
  });

  it('refresh button fires refreshTelemetry', () => {
    const refreshTelemetry = vi.fn();
    render_({ refreshTelemetry });
    fireEvent.click(screen.getByText(/refresh/i));
    expect(refreshTelemetry).toHaveBeenCalledOnce();
  });
});
