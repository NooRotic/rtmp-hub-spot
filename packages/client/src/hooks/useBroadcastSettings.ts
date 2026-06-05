import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';

export interface DetectedEncoder {
  best: string;
  bestLabel: string;
  available: string[];
}

const LS = {
  bitrate: 'hub-broadcast-bitrate',
  preset: 'hub-broadcast-preset',
  hwAccel: 'hub-hwaccel',
} as const;

/**
 * Broadcast quality settings (bitrate / preset / hwAccel), persisted to localStorage
 * (closes known issue #5), plus one-shot GPU encoder detection that auto-selects the
 * best encoder only when the user hasn't already chosen one ('none').
 */
export function useBroadcastSettings(ipc: IpcBridge | null): {
  bitrate: string;
  setBitrate: (v: string) => void;
  preset: string;
  setPreset: (v: string) => void;
  hwAccel: string;
  setHwAccel: (v: string) => void;
  detectedEncoder: DetectedEncoder | null;
} {
  const [bitrate, setBitrate] = useState<string>(() => localStorage.getItem(LS.bitrate) || '2500k');
  const [preset, setPreset] = useState<string>(() => localStorage.getItem(LS.preset) || 'ultrafast');
  const [hwAccel, setHwAccel] = useState<string>(() => localStorage.getItem(LS.hwAccel) || 'none');
  const [detectedEncoder, setDetectedEncoder] = useState<DetectedEncoder | null>(null);

  useEffect(() => { localStorage.setItem(LS.bitrate, bitrate); }, [bitrate]);
  useEffect(() => { localStorage.setItem(LS.preset, preset); }, [preset]);
  useEffect(() => { localStorage.setItem(LS.hwAccel, hwAccel); }, [hwAccel]);

  // GPU encoder auto-detection (Electron only — ipc is null in the browser). Runs once.
  useEffect(() => {
    if (!ipc) return;
    ipc
      .invoke('detect-gpu-encoder')
      .then((result: DetectedEncoder) => {
        setDetectedEncoder(result);
        setHwAccel((prev) => (prev === 'none' ? result.best : prev));
      })
      .catch((err: unknown) => console.error('[App] GPU detection failed:', err));
  }, [ipc]);

  return { bitrate, setBitrate, preset, setPreset, hwAccel, setHwAccel, detectedEncoder };
}
