import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { RecordingsTab } from './RecordingsTab';

const base: AdminData = {
  socketStatus: 'connected', isConnected: true,
  serverStatus: null, sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};
const withRecordings = (over: Partial<AdminData['recordings']>): AdminData => ({ ...base, recordings: { ...base.recordings, ...over } });

afterEach(cleanup);

describe('RecordingsTab', () => {
  it('shows the empty state when no recordings', () => {
    render(<AdminDataProvider value={base}><RecordingsTab /></AdminDataProvider>);
    expect(screen.getByText(/no active recordings/i)).toBeTruthy();
  });

  it('lists an active recording with elapsed time and stops it on click', () => {
    const stop = vi.fn();
    const data = withRecordings({ active: [{ streamKey: 'grid', path: 'C:/rec/grid.mp4', startTime: 1000 }], now: 1000 + 65_000, stop });
    render(<AdminDataProvider value={data}><RecordingsTab /></AdminDataProvider>);
    expect(screen.getByText('grid')).toBeTruthy();
    expect(screen.getByText(/01:05/)).toBeTruthy();      // 65s → 01:05
    expect(screen.getByText(/grid\.mp4/)).toBeTruthy();
    fireEvent.click(screen.getByText(/stop/i));
    expect(stop).toHaveBeenCalledWith('grid');
  });

  it('opens the recordings folder', () => {
    const openDir = vi.fn();
    render(<AdminDataProvider value={withRecordings({ openDir })}><RecordingsTab /></AdminDataProvider>);
    fireEvent.click(screen.getByText(/folder/i));
    expect(openDir).toHaveBeenCalledOnce();
  });
});
