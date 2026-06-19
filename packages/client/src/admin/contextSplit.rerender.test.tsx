import { describe, it, expect, afterEach, vi } from 'vitest';
import { useMemo, useState, type ReactNode } from 'react';
import { render, cleanup, fireEvent } from '../test/testUtils';
import {
  AdminActionsContext,
  AdminTelemetryContext,
  useAdminActions,
  type AdminActions,
  type AdminTelemetry,
  type AdminServerStatus,
} from './AdminDataProvider';
import { SettingsTab } from './tabs/SettingsTab';

afterEach(cleanup);

const baseActions = (): AdminActions => ({
  destinations: [],
  bindings: [],
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  roomAccess: { locked: false, setPin: async () => {}, clearPin: async () => {} },
  previewOpen: new Set(),
  setPreviewOpen: () => {},
  refreshTelemetry: () => {},
});

const baseTelemetry = (serverStatus: AdminServerStatus | null): AdminTelemetry => ({
  socketStatus: 'connected',
  isConnected: true,
  serverStatus,
  relays: new Map(),
  ffmpeg: { status: { state: 'idle', streamKey: '' }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  sources: [],
});

/**
 * Render-count spy that consumes the SAME context SettingsTab does
 * (`useAdminActions`, reading settings + roomAccess), then renders the real
 * SettingsTab. Because it subscribes to AdminActionsContext, it re-renders on
 * exactly the same triggers SettingsTab does: when actionsValue identity
 * changes, and NOT when only telemetryValue changes. This makes the spy a
 * faithful proxy for "did the stable consumer re-render".
 */
function SpiedSettingsTab({ onRender }: { onRender: () => void }) {
  useAdminActions();
  onRender();
  return <SettingsTab />;
}

/**
 * Host that mirrors AdminApp's producer: TWO disjoint memos feeding the two real
 * context providers. Telemetry-only state changes (serverStatus) must rebuild
 * ONLY telemetryValue; actionsValue identity must survive so the stable consumer
 * does not re-render. A stable-field change (bitrate) must rebuild actionsValue.
 */
function Host({ children }: { children: ReactNode }) {
  const [serverStatus, setServerStatus] = useState<AdminServerStatus | null>({ clientCount: 0 });
  const [bitrate, setBitrate] = useState('2500k');

  const actionsValue = useMemo<AdminActions>(() => ({
    ...baseActions(),
    settings: { ...baseActions().settings, bitrate, setBitrate },
  }), [bitrate]);

  const telemetryValue = useMemo<AdminTelemetry>(
    () => baseTelemetry(serverStatus),
    [serverStatus],
  );

  return (
    <AdminActionsContext.Provider value={actionsValue}>
      <AdminTelemetryContext.Provider value={telemetryValue}>
        {children}
        <button data-testid="tick-telemetry" onClick={() => setServerStatus({ clientCount: Math.random() })}>tick</button>
        <button data-testid="change-bitrate" onClick={() => setBitrate('5000k')}>bitrate</button>
      </AdminTelemetryContext.Provider>
    </AdminActionsContext.Provider>
  );
}

describe('context split — stable consumer survives telemetry tick', () => {
  it('does NOT re-render SettingsTab on a telemetry-only change, but DOES on a stable-field change', () => {
    const onRender = vi.fn();
    const { container } = render(
      <Host>
        <SpiedSettingsTab onRender={onRender} />
      </Host>,
    );

    const tick = container.querySelector('[data-testid="tick-telemetry"]')!;
    const bitrate = container.querySelector('[data-testid="change-bitrate"]')!;

    expect(onRender).toHaveBeenCalledTimes(1);

    // Telemetry tick: serverStatus changes → telemetryValue rebuilds, actionsValue
    // identity is preserved → the stable consumer must NOT re-render.
    fireEvent.click(tick);
    expect(onRender).toHaveBeenCalledTimes(1); // fails if actionsValue identity were rebuilt on tick

    // Another telemetry tick to be sure it stays put.
    fireEvent.click(tick);
    expect(onRender).toHaveBeenCalledTimes(1);

    // Stable-field change: bitrate (read by SettingsTab) → actionsValue rebuilds
    // → the consumer MUST re-render.
    fireEvent.click(bitrate);
    expect(onRender).toHaveBeenCalledTimes(2);
  });
});
