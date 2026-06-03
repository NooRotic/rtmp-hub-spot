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

/** PRO (later): per-destination transcode overrides. undefined => -c copy relay. */
export interface EncodeOverride {
  bitrate?: string;
  resolution?: string;
  fps?: number;
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

/** Pushed per relay over IPC channel 'relay-status'. */
export interface RelayStatus {
  sourceKey: string;
  destinationId: string;
  state: RelayState;
  message?: string;
  restartCount?: number;
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
