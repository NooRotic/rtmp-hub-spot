import { useState, useEffect, useCallback, useRef } from 'react';
import type { IpcBridge } from './useElectronBridge';

/** Admin-side control of the server's room PIN (locked state + set/clear), over IPC. */
export function useRoomPin(ipc: IpcBridge | null) {
  const [locked, setLocked] = useState(false);
  // Tracks whether the user has explicitly set or cleared the PIN. If so, the
  // initial poll result is ignored so it can't race over an explicit action.
  const userActedRef = useRef(false);

  useEffect(() => {
    if (!ipc) return;
    let alive = true;
    ipc
      .invoke('get-room-pin')
      .then((r: { locked: boolean }) => {
        if (alive && r && !userActedRef.current) setLocked(!!r.locked);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ipc]);

  const setPin = useCallback(
    async (pin: string) => {
      if (!ipc) return;
      userActedRef.current = true;
      ipc.send('set-room-pin', { pin });
      setLocked(!!pin.trim());
    },
    [ipc],
  );

  const clearPin = useCallback(async () => {
    if (!ipc) return;
    userActedRef.current = true;
    ipc.send('set-room-pin', { pin: '' });
    setLocked(false);
  }, [ipc]);

  return { locked, setPin, clearPin };
}
