import { describe, it, expect } from 'vitest';
import { isLoopbackHost } from './cert-trust.js';

describe('isLoopbackHost', () => {
  it('trusts loopback hosts (so self-signed https AND wss to localhost are accepted)', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('does not trust non-loopback hosts', () => {
    expect(isLoopbackHost('evil.com')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
    expect(isLoopbackHost('10.0.0.5')).toBe(false);
    expect(isLoopbackHost('')).toBe(false);
  });
});
