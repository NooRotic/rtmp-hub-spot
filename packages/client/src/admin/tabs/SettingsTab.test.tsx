import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { SettingsTab } from './SettingsTab';

const base: AdminData = {
  socketStatus: 'connected', isConnected: true,
  serverStatus: null, sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};
const withSettings = (over: Partial<AdminData['settings']>): AdminData => ({ ...base, settings: { ...base.settings, ...over } });

afterEach(cleanup);

describe('SettingsTab', () => {
  it('reflects the current bitrate and calls setBitrate on change', () => {
    const setBitrate = vi.fn();
    const { container } = render(<AdminDataProvider value={withSettings({ bitrate: '2500k', setBitrate })}><SettingsTab /></AdminDataProvider>);
    const bitrate = container.querySelector('select[data-field="bitrate"]') as HTMLSelectElement;
    expect(bitrate.value).toBe('2500k');
    fireEvent.change(bitrate, { target: { value: '5000k' } });
    expect(setBitrate).toHaveBeenCalledWith('5000k');
  });

  it('calls setHwAccel on encoder change', () => {
    const setHwAccel = vi.fn();
    const { container } = render(<AdminDataProvider value={withSettings({ setHwAccel })}><SettingsTab /></AdminDataProvider>);
    const accel = container.querySelector('select[data-field="hwAccel"]') as HTMLSelectElement;
    fireEvent.change(accel, { target: { value: 'amd' } });
    expect(setHwAccel).toHaveBeenCalledWith('amd');
  });

  it('shows a HW-accel badge when an encoder is detected', () => {
    render(<AdminDataProvider value={withSettings({ detectedEncoder: { best: 'amd', bestLabel: 'AMD AMF', available: ['amd'] } })}><SettingsTab /></AdminDataProvider>);
    expect(screen.getByText(/AMD AMF/)).toBeTruthy();
  });
});
