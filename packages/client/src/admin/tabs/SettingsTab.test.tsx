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
  roomAccess: { locked: false, setPin: vi.fn(async () => {}), clearPin: vi.fn(async () => {}) },
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

  it('sets a room PIN via roomAccess.setPin', () => {
    const setPin = vi.fn(async () => {});
    const data = { ...base, roomAccess: { locked: false, setPin, clearPin: vi.fn(async () => {}) } };
    const { container } = render(<AdminDataProvider value={data}><SettingsTab /></AdminDataProvider>);
    fireEvent.change(container.querySelector('input[data-field="room-pin-set"]')!, { target: { value: '1234' } });
    fireEvent.click(screen.getByText(/set pin/i));
    expect(setPin).toHaveBeenCalledWith('1234');
  });

  it('clears the room PIN via roomAccess.clearPin', () => {
    const clearPin = vi.fn(async () => {});
    const data = { ...base, roomAccess: { locked: true, setPin: vi.fn(async () => {}), clearPin } };
    render(<AdminDataProvider value={data}><SettingsTab /></AdminDataProvider>);
    fireEvent.click(screen.getByText(/clear/i));
    expect(clearPin).toHaveBeenCalledOnce();
  });

  it('shows locked glyph when roomAccess.locked is true', () => {
    const data = { ...base, roomAccess: { locked: true, setPin: async () => {}, clearPin: async () => {} } };
    const { container } = render(<AdminDataProvider value={data}><SettingsTab /></AdminDataProvider>);
    expect(container.textContent).toContain('🔒');
  });

  it('shows a locked (disabled) Pro watermark toggle with an upsell', () => {
    const { container } = render(<AdminDataProvider value={base}><SettingsTab /></AdminDataProvider>);
    const toggle = container.querySelector('input[data-field="pro-watermark"]') as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.disabled).toBe(true);
    expect(container.textContent).toMatch(/pro/i);
    expect(container.textContent).toMatch(/watermark/i);
  });
});
