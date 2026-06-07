import { describe, it, expect } from 'vitest';
import { deriveSources } from './sources';
import type { DestinationBinding } from '../../../shared';

const status = (keys: string[]) => ({ rtmpPublishers: keys.map((streamKey) => ({ streamKey })) });
const binding = (sourceKey: string): DestinationBinding => ({ sourceKey, destinationId: 'd', active: true });

describe('deriveSources', () => {
  it('unions live publishers and bound sources, flagging liveness', () => {
    const rows = deriveSources(status(['grid']), [binding('grid'), binding('feed-cam')]);
    const byKey = Object.fromEntries(rows.map((r) => [r.sourceKey, r.isLive]));
    expect(Object.keys(byKey).sort()).toEqual(['feed-cam', 'grid']);
    expect(byKey['grid']).toBe(true);      // publishing now
    expect(byKey['feed-cam']).toBe(false); // pre-wired, offline
  });

  it('includes a publishing source with no binding', () => {
    const rows = deriveSources(status(['grid']), []);
    expect(rows).toEqual([{ sourceKey: 'grid', isLive: true }]);
  });

  it('deduplicates a source that is both live and bound', () => {
    const rows = deriveSources(status(['grid']), [binding('grid'), binding('grid')]);
    expect(rows).toEqual([{ sourceKey: 'grid', isLive: true }]);
  });

  it('returns [] for null status and no bindings', () => {
    expect(deriveSources(null, [])).toEqual([]);
  });
});
