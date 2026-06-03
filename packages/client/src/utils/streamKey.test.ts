import { describe, it, expect } from 'vitest';
import { slugifyStreamKey, feedKey } from './streamKey';

describe('slugifyStreamKey', () => {
  it('collapses spaces, commas, and punctuation into single dashes', () => {
    expect(slugifyStreamKey('Mobile rotic - camera 2, facing back'))
      .toBe('mobile-rotic-camera-2-facing-back');
  });
  it('trims leading/trailing dashes and lowercases', () => {
    expect(slugifyStreamKey('  --Front Cam--  ')).toBe('front-cam');
  });
  it('falls back to "feed" for empty/punctuation-only input', () => {
    expect(slugifyStreamKey('!!!')).toBe('feed');
  });
});

describe('feedKey', () => {
  it('prefixes feed- onto the slug', () => {
    expect(feedKey('Mobile rotic - camera 2, facing back'))
      .toBe('feed-mobile-rotic-camera-2-facing-back');
  });
});
