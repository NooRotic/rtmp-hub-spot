import { describe, it, expect } from 'vitest';
import { PLATFORM_INFO, platformInfo, PLATFORMS } from './platforms';

describe('platforms', () => {
  it('lists all platform keys', () => {
    expect(PLATFORMS).toEqual(['youtube', 'twitch', 'kick', 'tiktok', 'facebook', 'custom']);
  });
  it('YouTube prefills its ingest URL', () => {
    expect(platformInfo('youtube').ingestUrl).toBe('rtmp://a.rtmp.youtube.com/live2');
  });
  it('Facebook requires RTMPS', () => {
    expect(platformInfo('facebook').ingestUrl).toBe('rtmps://live-api-s.facebook.com:443/rtmp');
  });
  it('custom has no prefilled URL', () => {
    expect(platformInfo('custom').ingestUrl).toBe('');
    expect(platformInfo('custom').label).toBe('Custom');
  });
  it('every platform has a label + hint', () => {
    for (const p of PLATFORMS) {
      expect(PLATFORM_INFO[p].label.length).toBeGreaterThan(0);
      expect(typeof PLATFORM_INFO[p].hint).toBe('string');
    }
  });
});
