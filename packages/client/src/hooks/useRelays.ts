import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';
import type { RelayStatus, RelayStats, RelayState } from '../../../shared';

export interface RelayEntry {
  sourceKey: string;
  destinationId: string;
  state: RelayState;
  message?: string;
  stats?: Omit<RelayStats, 'sourceKey' | 'destinationId'>;
}

/** The Map key for a relay leg: "sourceKey::destinationId". Exported so UI lookups match. */
export const relayKey = (sourceKey: string, destinationId: string) => `${sourceKey}::${destinationId}`;

/**
 * L3 relay telemetry: reduces relay-status / relay-stats into a Map keyed by
 * "sourceKey::destinationId". A 'stopped' status removes the entry (matching the
 * backend relay-manager, which deletes stopped relays); stats for an entry that
 * doesn't exist yet are ignored (status always arrives before stats).
 */
export function useRelays(ipc: IpcBridge | null): { relays: Map<string, RelayEntry> } {
  const [relays, setRelays] = useState<Map<string, RelayEntry>>(new Map());

  useEffect(() => {
    if (!ipc) return;

    const onStatus = (_: unknown, d: RelayStatus) => {
      setRelays((prev) => {
        const k = relayKey(d.sourceKey, d.destinationId);
        const next = new Map(prev);
        if (d.state === 'stopped') {
          next.delete(k);
        } else {
          const existing = next.get(k);
          next.set(k, {
            ...existing,
            sourceKey: d.sourceKey,
            destinationId: d.destinationId,
            state: d.state,
            message: d.message,
          });
        }
        return next;
      });
    };

    const onStats = (_: unknown, s: RelayStats) => {
      setRelays((prev) => {
        const k = relayKey(s.sourceKey, s.destinationId);
        const existing = prev.get(k);
        if (!existing) return prev; // stats for an unknown relay — ignore
        const { sourceKey: _sourceKey, destinationId: _destinationId, ...stats } = s;
        const next = new Map(prev);
        next.set(k, { ...existing, stats });
        return next;
      });
    };

    ipc.on('relay-status', onStatus);
    ipc.on('relay-stats', onStats);
    return () => {
      ipc.removeListener('relay-status', onStatus);
      ipc.removeListener('relay-stats', onStats);
    };
  }, [ipc]);

  return { relays };
}
