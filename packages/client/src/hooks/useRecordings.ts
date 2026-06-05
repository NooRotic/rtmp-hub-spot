import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';

export interface ActiveRecording {
  streamKey: string;
  path: string;
  startTime: number;
}

/**
 * Recording lifecycle: start/stop/open-folder via IPC, a 1s tick for elapsed-time
 * display, and sync-removal when the server auto-stops a recording (recordingStopped
 * comes from useWebRTC's 'recording-stopped' socket event).
 */
export function useRecordings(
  ipc: IpcBridge | null,
  recordingStopped: { streamKey: string; reason: string } | null,
): {
  activeRecordings: ActiveRecording[];
  recNow: number;
  startRecording: (streamKey: string) => Promise<void>;
  stopRecording: (streamKey: string) => void;
  openRecordingsDir: () => void;
} {
  const [activeRecordings, setActiveRecordings] = useState<ActiveRecording[]>([]);
  const [recNow, setRecNow] = useState<number>(() => Date.now());

  // Tick every second while recordings are active (for elapsed-time display).
  useEffect(() => {
    if (activeRecordings.length === 0) return;
    const t = setInterval(() => setRecNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeRecordings.length]);

  // Sync when the server auto-stops a recording (publisher disconnect, etc.).
  useEffect(() => {
    if (!recordingStopped) return;
    setActiveRecordings((prev) => prev.filter((r) => r.streamKey !== recordingStopped.streamKey));
  }, [recordingStopped]);

  const startRecording = async (streamKey: string) => {
    if (!ipc) return;
    try {
      const result = await ipc.invoke('start-recording', { streamKey });
      if (result.success) {
        setActiveRecordings((prev) => [...prev, { streamKey, path: result.path, startTime: Date.now() }]);
      } else {
        console.error('[REC] Start failed:', result.error);
      }
    } catch (e) {
      console.error('[REC] IPC error:', e);
    }
  };

  const stopRecording = (streamKey: string) => {
    if (!ipc) return;
    ipc.send('stop-recording', { streamKey });
    setActiveRecordings((prev) => prev.filter((r) => r.streamKey !== streamKey));
  };

  const openRecordingsDir = () => {
    if (!ipc) return;
    ipc.send('open-recordings-dir');
  };

  return { activeRecordings, recNow, startRecording, stopRecording, openRecordingsDir };
}
