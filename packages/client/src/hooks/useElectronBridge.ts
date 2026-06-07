import { useMemo } from 'react';

/** A listener as delivered by the preload bridge: the IpcRendererEvent is stripped to null. */
export type IpcListener = (event: unknown, ...args: any[]) => void;

/** The four-method ipcRenderer surface the preload contextBridge exposes. */
export interface IpcBridge {
  send(channel: string, ...args: any[]): void;
  invoke(channel: string, ...args: any[]): Promise<any>;
  on(channel: string, listener: IpcListener): void;
  removeListener(channel: string, listener: IpcListener): void;
}

/**
 * Single source of truth for Electron detection (kills the App / useWebRTC /
 * VideoFeed / GridView duplication — audit #9). Module-level so non-component code
 * (module-scope consts in the pipe components) can read it too.
 */
export const isElectron: boolean =
  typeof window !== 'undefined' &&
  (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1 ||
    !!(window as any).process?.versions?.electron);

/**
 * Resolve the ipcRenderer bridge: the contextBridge path (window.electron) first,
 * then the legacy nodeIntegration require() fallback. null outside Electron.
 */
export function getIpc(): IpcBridge | null {
  if (!isElectron) return null;
  return (
    (window as any).electron?.ipcRenderer ||
    ((window as any).require ? (window as any).require('electron').ipcRenderer : null)
  );
}

/** Hook form for components: stable { isElectron, ipc }. */
export function useElectronBridge(): { isElectron: boolean; ipc: IpcBridge | null } {
  const ipc = useMemo(() => getIpc(), []);
  return { isElectron, ipc };
}
