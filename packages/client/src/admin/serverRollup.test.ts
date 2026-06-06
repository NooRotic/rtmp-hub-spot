import { describe, it, expect } from 'vitest';
import { serverRollup } from './serverRollup';
import type { SourceRow } from './sources';
import type { RelayEntry } from '../hooks/useRelays';

const rel = (sourceKey: string, destinationId: string, state: RelayEntry['state']): [string, RelayEntry] => [
  `${sourceKey}::${destinationId}`,
  { sourceKey, destinationId, state },
];

describe('serverRollup', () => {
  it('counts live sources and active relay destinations', () => {
    const sources: SourceRow[] = [
      { sourceKey: 'grid', isLive: true },
      { sourceKey: 'feed-cam', isLive: false },
    ];
    const relays = new Map<string, RelayEntry>([rel('grid', 'yt', 'live'), rel('grid', 'kick', 'connecting')]);
    expect(serverRollup(sources, relays)).toEqual({ liveSources: 1, activeDestinations: 2 });
  });

  it('returns zeros for empty inputs', () => {
    expect(serverRollup([], new Map())).toEqual({ liveSources: 0, activeDestinations: 0 });
  });
});
