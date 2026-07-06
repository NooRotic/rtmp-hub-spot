import { createContext, useContext, useMemo, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { RtmpDestination, DestinationBinding } from '../../../shared';
import type { SourceRow } from './sources';
import type { RelayEntry } from '../hooks/useRelays';
import type { FfmpegStatus, FfmpegStats } from '../hooks/useFfmpegPipeline';
import type { ActiveRecording } from '../hooks/useRecordings';
import type { DetectedEncoder } from '../hooks/useBroadcastSettings';

/** Minimal server-status shape the admin UI reads (subset of useWebRTC's serverStatus). */
export interface AdminServerStatus {
  local?: string;
  public?: string;
  clientCount?: number;
  rtmpCount?: number;
  rtmpSessions?: { id?: string; ip?: string; path?: string; uptime?: number; bitrate?: number }[];
  rtmpPublishers?: { streamKey: string; ip?: string; path?: string; uptime?: number }[];
}

/**
 * The single G1 (restream / telemetry / settings / connection) data surface the
 * re-skinned admin tree consumes. Assembled by App from its existing hooks.
 *
 * Phase 3 splits this surface into two contexts so stable consumers stop
 * re-rendering on the 5 s telemetry tick:
 *  - TELEMETRY (volatile): mutates every tick — connection + live server state.
 *  - ACTIONS (stable): identity survives a tick — config, actions, room access.
 *
 * `AdminData` is kept as the combined shape; `AdminTelemetry` / `AdminActions`
 * are derived field slices of it. The back-compat `AdminDataProvider` shim still
 * accepts a single combined `value` and renders both context providers nested.
 */
export interface AdminData {
  socketStatus: string;
  isConnected: boolean;
  serverStatus: AdminServerStatus | null;
  sources: SourceRow[];
  relays: Map<string, RelayEntry>;
  destinations: RtmpDestination[];
  bindings: DestinationBinding[];
  ffmpeg: { status: FfmpegStatus; stats: FfmpegStats | null };
  recordings: {
    active: ActiveRecording[];
    now: number;
    start: (streamKey: string) => Promise<void>;
    stop: (streamKey: string) => void;
    openDir: () => void;
  };
  settings: {
    bitrate: string;
    setBitrate: (v: string) => void;
    preset: string;
    setPreset: (v: string) => void;
    hwAccel: string;
    setHwAccel: (v: string) => void;
    detectedEncoder: DetectedEncoder | null;
  };
  destinationActions: {
    add: (d: RtmpDestination) => Promise<void>;
    update: (d: RtmpDestination) => Promise<void>;
    remove: (id: string) => Promise<void>;
    setBinding: (b: DestinationBinding) => Promise<void>;
    removeBinding: (sourceKey: string, destinationId: string) => Promise<void>;
    refresh: () => Promise<void>;
  };
  roomAccess: {
    locked: boolean;
    setPin: (pin: string) => Promise<void>;
    clearPin: () => Promise<void>;
  };
  previewOpen: Set<string>;
  setPreviewOpen: Dispatch<SetStateAction<Set<string>>>;
  refreshTelemetry: () => void;
}

/** Volatile slice — mutates on the 5 s telemetry tick. */
export type AdminTelemetry = Pick<
  AdminData,
  'socketStatus' | 'isConnected' | 'serverStatus' | 'relays' | 'ffmpeg' | 'recordings' | 'sources'
>;

/** Stable slice — identity survives a telemetry tick. */
export type AdminActions = Pick<
  AdminData,
  'destinations' | 'bindings' | 'destinationActions' | 'settings' | 'roomAccess' | 'previewOpen' | 'setPreviewOpen' | 'refreshTelemetry'
>;

const AdminActionsContext = createContext<AdminActions | null>(null);
const AdminTelemetryContext = createContext<AdminTelemetry | null>(null);

export { AdminActionsContext, AdminTelemetryContext };

/** Read the stable (actions) admin slice. Throws if used outside an AdminActionsContext provider. */
export function useAdminActions(): AdminActions {
  const ctx = useContext(AdminActionsContext);
  if (ctx === null) {
    throw new Error('useAdminActions must be used within an AdminActionsContext provider');
  }
  return ctx;
}

/** Read the volatile (telemetry) admin slice. Throws if used outside an AdminTelemetryContext provider. */
export function useAdminTelemetry(): AdminTelemetry {
  const ctx = useContext(AdminTelemetryContext);
  if (ctx === null) {
    throw new Error('useAdminTelemetry must be used within an AdminTelemetryContext provider');
  }
  return ctx;
}

/**
 * Back-compat combined provider. Accepts the single `value` of the old
 * `AdminData` shape and derives the two slices from it (memoized on `value`
 * identity), rendering both context providers nested.
 *
 * Production no longer uses this (AdminApp builds two disjoint memos directly so
 * the actions slice survives a telemetry tick); it exists so existing tests that
 * wrap `<AdminDataProvider value={combinedObject}>` keep working unchanged —
 * their `value` is static, so deriving slices on `value` identity is fine.
 */
export function AdminDataProvider({ value, children }: { value: AdminData; children: ReactNode }) {
  const actions = useMemo<AdminActions>(() => ({
    destinations: value.destinations,
    bindings: value.bindings,
    destinationActions: value.destinationActions,
    settings: value.settings,
    roomAccess: value.roomAccess,
    previewOpen: value.previewOpen,
    setPreviewOpen: value.setPreviewOpen,
    refreshTelemetry: value.refreshTelemetry,
  }), [value]);

  const telemetry = useMemo<AdminTelemetry>(() => ({
    socketStatus: value.socketStatus,
    isConnected: value.isConnected,
    serverStatus: value.serverStatus,
    relays: value.relays,
    ffmpeg: value.ffmpeg,
    recordings: value.recordings,
    sources: value.sources,
  }), [value]);

  return (
    <AdminActionsContext.Provider value={actions}>
      <AdminTelemetryContext.Provider value={telemetry}>
        {children}
      </AdminTelemetryContext.Provider>
    </AdminActionsContext.Provider>
  );
}

/**
 * Back-compat combined reader. Recombines the two slices into the old `AdminData`
 * shape. Kept exported (and tested) even though production now reads the split
 * hooks directly — some tests / external callers may still depend on it.
 */
export function useAdminData(): AdminData {
  const actions = useContext(AdminActionsContext);
  const telemetry = useContext(AdminTelemetryContext);
  if (actions === null || telemetry === null) {
    throw new Error('useAdminData must be used within an AdminDataProvider');
  }
  return { ...telemetry, ...actions };
}
