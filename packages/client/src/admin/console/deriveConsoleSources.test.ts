import { describe, it, expect } from 'vitest';
import { deriveConsoleSources } from './deriveConsoleSources';

describe('deriveConsoleSources', () => {
  it('maps publishers to source rows with viewer counts', () => {
    const rows = deriveConsoleSources({
      rtmpPublishers: [{ streamKey: 'grid', uptime: 10 }, { streamKey: 'feed-a', uptime: 5 }],
      rtmpSessions: [{ path: '/live/grid', bitrate: 3500000 }, { path: '/live/grid', bitrate: 0 }],
    });
    const grid = rows.find(r => r.streamKey === 'grid')!;
    expect(grid.active).toBe(true);
    expect(grid.viewers).toBe(2);          // two sessions on /live/grid
    expect(rows.find(r => r.streamKey === 'feed-a')!.viewers).toBe(0);
  });

  it('returns [] for null/empty', () => {
    expect(deriveConsoleSources(null)).toEqual([]);
    expect(deriveConsoleSources({})).toEqual([]);
  });
});
