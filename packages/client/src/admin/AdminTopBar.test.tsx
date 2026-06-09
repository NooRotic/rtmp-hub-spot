import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { AdminDataProvider, type AdminData } from './AdminDataProvider';
import { AdminTopBar } from './AdminTopBar';
import type { RelayEntry } from '../hooks/useRelays';

const data = (over: Partial<AdminData> = {}): AdminData => ({
  socketStatus: 'connected',
  isConnected: true,
  serverStatus: { local: '10.0.0.5', public: 'x', clientCount: 3, rtmpCount: 2, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
  sources: [{ sourceKey: 'grid', isLive: true }, { sourceKey: 'feed', isLive: false }],
  relays: new Map<string, RelayEntry>([['grid::yt', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }]]),
  destinations: [], bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
  ...over,
});

const renderBar = (over?: Partial<AdminData> & { onSettings?: () => void; onChat?: () => void; onRecordings?: () => void; onAddFeed?: () => void; chatUnread?: number }) => {
  const { onSettings = () => {}, onChat = () => {}, onRecordings = () => {}, onAddFeed = () => {}, chatUnread = 0, ...dataOver } = over ?? {};
  return render(
    <AdminDataProvider value={data(dataOver)}>
      <AdminTopBar onSettings={onSettings} onChat={onChat} onRecordings={onRecordings} onAddFeed={onAddFeed} chatUnread={chatUnread} />
    </AdminDataProvider>
  );
};

afterEach(cleanup);

describe('AdminTopBar', () => {
  it('shows local IP, client + publisher counts', () => {
    const { container } = renderBar();
    expect(container.textContent).toContain('10.0.0.5');
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('2');
  });

  it('shows the live-sources → destinations rollup', () => {
    const { container } = renderBar();
    expect(container.textContent).toMatch(/1\s*sources?\s*→\s*1\s*destinations?/i);
  });

  it('signaling dot is live when connected, error when disconnected', () => {
    const { container: live } = renderBar();
    expect(live.querySelector('.ntd-dot--live')).toBeTruthy();
    cleanup();
    const { container: down } = renderBar({ isConnected: false, socketStatus: 'disconnected' });
    expect(down.querySelector('.ntd-dot--error')).toBeTruthy();
  });

  it('shows the client Join URL built from the LAN IP', () => {
    const { container } = renderBar();
    const join = container.querySelector('.ntd-statusbar__join');
    expect(join).toBeTruthy();
    expect(join!.textContent).toContain('10.0.0.5');
    expect(join!.textContent).toMatch(/^https?:\/\//);
  });

  it('shows 🔒 glyph when roomAccess.locked is true', () => {
    const { container } = renderBar({ roomAccess: { locked: true, setPin: async () => {}, clearPin: async () => {} } });
    const lockSpan = container.querySelector('[title="Room locked — PIN required"]');
    expect(lockSpan).toBeTruthy();
    expect(lockSpan!.textContent).toContain('🔒');
  });

  it('shows 🔓 glyph when roomAccess.locked is false', () => {
    const { container } = renderBar({ roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} } });
    const openSpan = container.querySelector('[title="Room open"]');
    expect(openSpan).toBeTruthy();
    expect(openSpan!.textContent).toContain('🔓');
  });

  it('shows the Join URL and fires the action toggles', () => {
    const onSettings = vi.fn(), onChat = vi.fn();
    const { container } = renderBar({ onSettings, onChat });
    const settingsBtn = container.querySelector('[title="Settings"]');
    const chatBtn = container.querySelector('[title="Chat"]');
    expect(settingsBtn).toBeTruthy();
    fireEvent.click(settingsBtn!);
    expect(onSettings).toHaveBeenCalled();
    fireEvent.click(chatBtn!);
    expect(onChat).toHaveBeenCalled();
  });

  it('shows a chat unread badge when chatUnread > 0', () => {
    const { container } = renderBar({ chatUnread: 3 });
    expect(container.querySelector('.ntd-topbar__badge')?.textContent).toBe('3');
  });

  it('does not show badge when chatUnread is 0', () => {
    const { container } = renderBar({ chatUnread: 0 });
    expect(container.querySelector('.ntd-topbar__badge')).toBeNull();
  });
});
