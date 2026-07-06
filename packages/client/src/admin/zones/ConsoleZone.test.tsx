/// <reference types="vitest" />
/**
 * Focused render test for ConsoleZone (props in → DOM out). BroadcastConsole reads
 * AdminDataProvider context, so we wrap in a minimal provider. The AdminApp.*.test.tsx
 * characterization files remain the integration guard.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { ConsoleZone } from './ConsoleZone';
import type { RelayEntry } from '../../hooks/useRelays';

const adminData: AdminData = {
  socketStatus: 'connected',
  isConnected: true,
  serverStatus: null,
  sources: [],
  relays: new Map<string, RelayEntry>(),
  destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};

const renderZone = (chatOpen: boolean, onCloseChat = vi.fn()) =>
  render(
    <AdminDataProvider value={adminData}>
      <ConsoleZone chatOpen={chatOpen} chatMessages={[]} onSendMessage={vi.fn()} onCloseChat={onCloseChat} />
    </AdminDataProvider>
  );

afterEach(cleanup);

describe('ConsoleZone', () => {
  it('renders the persistent BroadcastConsole region', () => {
    renderZone(false);
    expect(screen.getByText('Broadcast')).toBeInTheDocument();
  });

  it('hides the docked chat panel when chatOpen is false', () => {
    renderZone(false);
    expect(screen.queryByText(/Global Network Chat/i)).toBeNull();
  });

  it('shows the docked chat panel when chatOpen is true', () => {
    renderZone(true);
    expect(screen.getByText(/Global Network Chat/i)).toBeInTheDocument();
  });

  it('fires onCloseChat when the chat collapse button is clicked', () => {
    const onCloseChat = vi.fn();
    const { container } = renderZone(true, onCloseChat);
    const collapseBtn = container.querySelector('button[aria-label="Collapse chat"]') as HTMLButtonElement;
    expect(collapseBtn).toBeTruthy();
    fireEvent.click(collapseBtn);
    expect(onCloseChat).toHaveBeenCalled();
  });
});
