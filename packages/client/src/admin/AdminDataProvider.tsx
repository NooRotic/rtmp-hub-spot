import { createContext, useContext, type ReactNode, type Dispatch, type SetStateAction } from 'react';
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
 * re-skinned admin tree consumes. Assembled by App from its existing hooks and
 * passed to AdminDataProvider as `value` (pass-through context — the provider does
 * not call hooks, so App remains the single subscriber).
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

const AdminDataContext = createContext<AdminData | null>(null);

export function AdminDataProvider({ value, children }: { value: AdminData; children: ReactNode }) {
  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

/** Read the admin data. Throws if used outside an AdminDataProvider. */
export function useAdminData(): AdminData {
  const ctx = useContext(AdminDataContext);
  if (ctx === null) {
    throw new Error('useAdminData must be used within an AdminDataProvider');
  }
  return ctx;
}
