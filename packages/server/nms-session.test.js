import { describe, it, expect } from 'vitest';
import { extractSessionData } from './nms-session.js';

describe('extractSessionData', () => {
  it('reads streamPath from a v4 session object (the postPublish/postPlay arg)', () => {
    // Regression: NMS v4 emits the session object with the path on `streamPath`.
    // Reading the old v2 names here returned 'Unknown' and broke relay key matching.
    const session = { id: 's1', ip: '127.0.0.1:56512', streamPath: '/live/grid' };
    expect(extractSessionData(session).path).toBe('/live/grid');
    expect(extractSessionData(session).id).toBe('s1');
    expect(extractSessionData(session).ip).toBe('127.0.0.1:56512');
  });

  it('falls back to the v2 play/publishStreamPath names when streamPath is absent', () => {
    expect(extractSessionData({ ip: 'x', publishStreamPath: '/live/foo' }).path).toBe('/live/foo');
    expect(extractSessionData({ ip: 'x', playStreamPath: '/live/bar' }).path).toBe('/live/bar');
  });

  it('looks up an id string in a Map of sessions (v2-style)', () => {
    const sessions = new Map([['s1', { id: 's1', ip: 'i', streamPath: '/live/grid' }]]);
    expect(extractSessionData('s1', sessions).path).toBe('/live/grid');
  });

  it('looks up an id string in a plain-object sessions map', () => {
    const sessions = { s1: { id: 's1', ip: 'i', streamPath: '/live/grid' } };
    expect(extractSessionData('s1', sessions).path).toBe('/live/grid');
  });

  it('returns an Unknown record when the session is not found', () => {
    const data = extractSessionData('missing', new Map());
    expect(data.path).toBe('Unknown');
    expect(data.ip).toBe('Unknown');
    expect(data.id).toBe('missing');
  });
});
