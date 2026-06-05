import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';

export interface FfmpegStatus {
  state: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
  streamKey: string | null;
  message?: string;
}

export interface FfmpegStats {
  frame: number;
  fps: number;
  bitrate: string;
  speed: number;
  time: string;
  size: string;
  streamKey: string;
}

/** L2 source telemetry: subscribes to ffmpeg-status / ffmpeg-stats from the main process. */
export function useFfmpegPipeline(ipc: IpcBridge | null): { status: FfmpegStatus; stats: FfmpegStats | null } {
  const [status, setStatus] = useState<FfmpegStatus>({ state: 'idle', streamKey: null });
  const [stats, setStats] = useState<FfmpegStats | null>(null);

  useEffect(() => {
    if (!ipc) return;
    const handleStatus = (_: unknown, data: FfmpegStatus) => {
      setStatus(data);
      if (data.state !== 'running') setStats(null);
    };
    const handleStats = (_: unknown, data: FfmpegStats) => setStats(data);
    ipc.on('ffmpeg-status', handleStatus);
    ipc.on('ffmpeg-stats', handleStats);
    return () => {
      ipc.removeListener('ffmpeg-status', handleStatus);
      ipc.removeListener('ffmpeg-stats', handleStats);
    };
  }, [ipc]);

  return { status, stats };
}
