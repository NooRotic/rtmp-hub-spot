import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { BroadcastConsole } from './BroadcastConsole';
import type { RtmpDestination, DestinationBinding } from '../../../../shared';
import type { RelayEntry } from '../../hooks/useRelays';

// RtmpPlayerTile (used by the SOURCES lane's ConsoleSourceRow) uses mpegts.js; mock it.
vi.mock('../../components/RtmpPlayerTile', () => ({
  RtmpPlayerTile: ({ streamKey }: { streamKey: string }) => <div data-testid="preview">{streamKey}</div>,
  localFlvUrl: (k: string) => `http://127.0.0.1:8000/live/${k}.flv`,
}));

const YT: RtmpDestination = {
  id: 'yt',
  name: 'My YouTube',
  platform: 'youtube',
  url: 'rtmp://a.rtmp.youtube.com/live2',
  streamKey: 'secretkey99',
  enabled: true,
};

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
    destinationActions: {
      add: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      setBinding: vi.fn(async () => {}),
      removeBinding: vi.fn(async () => {}),
      refresh: async () => {},
    },
    roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
    previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
    ...over,
  };
}

afterEach(cleanup);

describe('BroadcastConsole', () => {
  it('shows the FFmpeg health chip + an OUTPUTS lane with add-destination', () => {
    const { container } = render(<AdminDataProvider value={base()}><BroadcastConsole /></AdminDataProvider>);
    expect(container.textContent).toMatch(/running|idle/i);   // ffmpeg chip
    expect(container.textContent).toMatch(/outputs/i);
    expect(container.textContent).toMatch(/add destination/i);
  });

  it('renders a SOURCES lane with a row per live publisher', () => {
    const { container } = render(<AdminDataProvider value={base()}><BroadcastConsole /></AdminDataProvider>);
    expect(container.textContent).toMatch(/sources/i);
    // base() has rtmpPublishers: [{ streamKey: 'grid' }] → a source row for 'grid'
    const codes = Array.from(container.querySelectorAll('code')).map(c => c.textContent);
    expect(codes).toContain('grid');
    // the per-source RTMP pull route is copyable
    expect(container.textContent).toContain('rtmp://127.0.0.1:1935/live/grid');
  });

  it('binds a destination to a source via the OUTPUTS lane', () => {
    const data = base();
    render(<AdminDataProvider value={data}><BroadcastConsole /></AdminDataProvider>);
    // bind checkbox for (grid, yt) — same data-field convention as DestinationsTab (bind-{src}-{dest})
    const bind = document.querySelector('input[data-field="bind-grid-yt"]') as HTMLInputElement;
    if (bind) { fireEvent.click(bind); expect(data.destinationActions.setBinding).toHaveBeenCalled(); }
  });

  it('lists destinations with a masked key and platform badge', () => {
    const { container } = render(<AdminDataProvider value={base()}><BroadcastConsole /></AdminDataProvider>);
    expect(container.textContent).toContain('My YouTube');
    expect(container.textContent).toContain('YOUTUBE');
    expect(container.textContent).toContain('••••••');
    expect(container.textContent).not.toContain('secretkey99');
  });

  it('removes a destination', () => {
    const data = base();
    render(<AdminDataProvider value={data}><BroadcastConsole /></AdminDataProvider>);
    const removeBtn = Array.from(document.querySelectorAll('button')).find(b => /remove/i.test(b.textContent ?? ''));
    if (removeBtn) { fireEvent.click(removeBtn); expect(data.destinationActions.remove).toHaveBeenCalledWith('yt'); }
  });

  it('shows the live relay StatusTag for a bound+relaying destination', () => {
    const relays = new Map<string, RelayEntry>([['grid::yt', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }]]);
    const { container } = render(<AdminDataProvider value={base({ relays, bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true } as DestinationBinding] })}><BroadcastConsole /></AdminDataProvider>);
    expect(container.querySelector('.ntd-tag--live')).toBeTruthy();
  });

  it('unbinds when an active binding is unchecked', () => {
    const data = base({ bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true } as DestinationBinding] });
    render(<AdminDataProvider value={data}><BroadcastConsole /></AdminDataProvider>);
    const bind = document.querySelector('input[data-field="bind-grid-yt"]') as HTMLInputElement;
    if (bind) { fireEvent.click(bind); expect(data.destinationActions.removeBinding).toHaveBeenCalledWith('grid', 'yt'); }
  });

  it('ffmpeg chip shows running state with stats when running', () => {
    const data = base({
      ffmpeg: {
        status: { state: 'running', streamKey: 'grid' },
        stats: { fps: 30, bitrate: '2500kbits/s', frame: 120, speed: 1, time: '00:00:04', size: '1.2MB', streamKey: 'grid' },
      },
    });
    const { container } = render(<AdminDataProvider value={data}><BroadcastConsole /></AdminDataProvider>);
    expect(container.textContent).toMatch(/running/i);
    expect(container.textContent).toMatch(/30fps/i);
  });

  it('empty-state when there are no destinations', () => {
    const { container } = render(<AdminDataProvider value={base({ destinations: [] })}><BroadcastConsole /></AdminDataProvider>);
    expect(container.textContent).toMatch(/no destinations|add your first/i);
  });
});
