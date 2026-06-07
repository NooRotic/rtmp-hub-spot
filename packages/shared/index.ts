export interface StreamInfo {
  id: string;
  userId: string;
  userName: string;
  startTime: number;
  type: 'webcam' | 'screen';
}

export interface UserInfo {
  id: string;
  name: string;
  role: 'admin' | 'user';
}

export type Platform =
  | 'youtube'
  | 'kick'
  | 'tiktok'
  | 'twitch'
  | 'facebook'
  | 'custom';

/**
 * PRO (later): a per-destination brand/logo overlay. Reserved now (R2); rendering
 * requires decode→overlay→re-encode, so it ships with the Pro transcode milestone,
 * not under the Free `-c copy` relay.
 */
export interface WatermarkConfig {
  /** Text mark (e.g. "RTMP Hub"); used when logoPath is absent. */
  text?: string;
  /** Path to a logo image to overlay. */
  logoPath?: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** 0..1; defaults applied at render time. */
  opacity?: number;
}

/** PRO (later): per-destination transcode overrides. undefined => -c copy relay. */
export interface EncodeOverride {
  bitrate?: string;
  resolution?: string;
  fps?: number;
  /** PRO: per-destination watermark overlay. Reserved; not rendered under Free -c copy. */
  watermark?: WatermarkConfig;
}

export interface RtmpDestination {
  id: string;
  name: string;
  platform: Platform;
  url: string;
  streamKey: string;
  enabled: boolean;
  /** Reconnection order; lower = sooner. Defaults to list order when undefined. */
  priority?: number;
  encode?: EncodeOverride;
}

/** Matrix cell — which source feeds which destination. */
export interface DestinationBinding {
  sourceKey: string;
  destinationId: string;
  active: boolean;
}

export type RelayState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error'
  | 'stopped';

/**
 * Pushed per relay over IPC channel 'relay-status'.
 * NOTE: no per-destination reconnect count — backoff is tracked globally by the
 * reconnection supervisor (one shared uplink), not per relay. A per-destination
 * attempt count is a possible future enhancement (would require per-relay tracking).
 */
export interface RelayStatus {
  sourceKey: string;
  destinationId: string;
  state: RelayState;
  message?: string;
}

/** Pushed per relay over IPC channel 'relay-stats'. */
export interface RelayStats {
  sourceKey: string;
  destinationId: string;
  fps: number;
  bitrate: string;
  speed: number;
  droppedFrames?: number;
  frame: number;
  size: string;
  time: string;
  uptimeSec: number;
}
