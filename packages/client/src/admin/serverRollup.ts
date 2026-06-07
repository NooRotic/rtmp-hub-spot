import type { SourceRow } from './sources';
import type { RelayEntry } from '../hooks/useRelays';

/**
 * The L1 rollup for the server status strip (spec §4): how many sources are live
 * right now, and how many relay legs are currently fanned out. The relay Map only
 * holds non-stopped relays (a 'stopped' status deletes its entry in useRelays), so
 * its size is the count of active/connecting/reconnecting/error destinations.
 */
export function serverRollup(
  sources: SourceRow[],
  relays: Map<string, RelayEntry>,
): { liveSources: number; activeDestinations: number } {
  return {
    liveSources: sources.filter((s) => s.isLive).length,
    activeDestinations: relays.size,
  };
}
