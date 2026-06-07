import { describe, it, expect } from 'vitest';
import { clientJoinUrl } from './clientUrl';

describe('clientJoinUrl', () => {
  it('builds the join URL from the LAN IP + served port', () => {
    expect(clientJoinUrl('10.0.0.156', { protocol: 'https:', port: '4443' })).toBe('https://10.0.0.156:4443');
  });
  it('omits the port when the location port is empty (default 80/443)', () => {
    expect(clientJoinUrl('10.0.0.156', { protocol: 'https:', port: '' })).toBe('https://10.0.0.156');
  });
  it('returns null when there is no LAN IP', () => {
    expect(clientJoinUrl(undefined, { protocol: 'https:', port: '4443' })).toBeNull();
    expect(clientJoinUrl(null, { protocol: 'https:', port: '4443' })).toBeNull();
    expect(clientJoinUrl('', { protocol: 'https:', port: '4443' })).toBeNull();
  });
});
