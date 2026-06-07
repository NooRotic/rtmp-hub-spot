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
  serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 1, rtmpSessions: [{ id: 'v1', ip: '10.0.0.9', path: '/live/grid', uptime: 42, bitrate: 3_500_000 }], rtmpPublishers: [{ streamKey: 'grid', uptime: 75 }] },
  sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: { frame: 90, fps: 30, bitrate: '2500k', speed: 1, time: '00:00:03', size: '1MB', streamKey: 'grid' } },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
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

  it('shows FFmpeg frame + size + target in the health line when running', () => {
    const { container } = render_();
    expect(container.textContent).toContain('90');     // frame
    expect(container.textContent).toContain('1MB');    // size
    expect(container.textContent).toContain('grid');   // target streamKey
  });

  it('shows publisher uptime', () => {
    const { container } = render_();
    expect(container.textContent).toContain('75s');
  });

  it('shows a viewer row with IP and a Mbps figure', () => {
    const { container } = render_();
    expect(container.textContent).toContain('10.0.0.9');
    expect(container.textContent).toMatch(/Mbps/i);
    expect(container.textContent).toContain('3.34'); // 3_500_000 / 1024 / 1024 ≈ 3.34
  });
});
