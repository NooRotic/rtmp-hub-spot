import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { DestinationsTab } from './DestinationsTab';
import type { RtmpDestination, DestinationBinding } from '../../../../shared';
import type { RelayEntry } from '../../hooks/useRelays';

const YT: RtmpDestination = { id: 'yt', name: 'My YouTube', platform: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'secretkey99', enabled: true };

function base(over: Partial<AdminData> = {}): AdminData {
  return {
    socketStatus: 'connected', isConnected: true,
    serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 1, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
    sources: [{ sourceKey: 'grid', isLive: true }],
    relays: new Map<string, RelayEntry>(),
    destinations: [YT],
    bindings: [],
    ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
    recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
    settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
    destinationActions: { add: vi.fn(async () => {}), update: vi.fn(async () => {}), remove: vi.fn(async () => {}), setBinding: vi.fn(async () => {}), removeBinding: vi.fn(async () => {}), refresh: async () => {} },
    previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
    ...over,
  };
}
const renderTab = (over?: Partial<AdminData>) => {
  const data = base(over);
  return { data, ...render(<AdminDataProvider value={data}><DestinationsTab /></AdminDataProvider>) };
};

afterEach(cleanup);

describe('DestinationsTab', () => {
  it('lists destinations with a masked key and platform badge', () => {
    const { container } = renderTab();
    expect(screen.getByText('My YouTube')).toBeTruthy();
    expect(container.textContent).toContain('YOUTUBE');
    expect(container.textContent).toContain('••••••');
    expect(container.textContent).not.toContain('secretkey99');
  });

  it('removes a destination', () => {
    const { data } = renderTab();
    fireEvent.click(screen.getByText(/remove/i));
    expect(data.destinationActions.remove).toHaveBeenCalledWith('yt');
  });

  it('toggles enabled via update', () => {
    const { data } = renderTab();
    const toggle = document.querySelector('input[data-field="dest-enabled-yt"]') as HTMLInputElement;
    fireEvent.click(toggle);
    expect(data.destinationActions.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'yt', enabled: false }));
  });

  it('binds a destination to a source (active)', () => {
    const { data } = renderTab();
    const bind = document.querySelector('input[data-field="bind-grid-yt"]') as HTMLInputElement;
    expect(bind.checked).toBe(false);
    fireEvent.click(bind);
    expect(data.destinationActions.setBinding).toHaveBeenCalledWith({ sourceKey: 'grid', destinationId: 'yt', active: true });
  });

  it('shows the live relay StatusTag for a bound+relaying destination', () => {
    const relays = new Map<string, RelayEntry>([['grid::yt', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }]]);
    const { container } = renderTab({ relays, bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true } as DestinationBinding] });
    expect(container.querySelector('.ntd-tag--live')).toBeTruthy();
  });

  it('unbinds when an active binding is unchecked', () => {
    const { data } = renderTab({ bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true } as DestinationBinding] });
    const bind = document.querySelector('input[data-field="bind-grid-yt"]') as HTMLInputElement;
    expect(bind.checked).toBe(true);
    fireEvent.click(bind);
    expect(data.destinationActions.removeBinding).toHaveBeenCalledWith('grid', 'yt');
  });

  it('adds a destination via the form', () => {
    const { data } = renderTab();
    fireEvent.click(screen.getByText(/add destination/i));
    fireEvent.change(document.body.querySelector('input[data-field="name"]')!, { target: { value: 'New Dest' } });
    fireEvent.change(document.body.querySelector('input[data-field="streamKey"]')!, { target: { value: 'k2' } });
    fireEvent.click(screen.getByText(/^add$/i));
    expect(data.destinationActions.add).toHaveBeenCalledTimes(1);
    expect((data.destinationActions.add as any).mock.calls[0][0]).toMatchObject({ name: 'New Dest' });
  });

  it('empty-state when there are no destinations', () => {
    const { container } = renderTab({ destinations: [] });
    expect(container.textContent).toMatch(/no destinations|add your first/i);
  });
});
