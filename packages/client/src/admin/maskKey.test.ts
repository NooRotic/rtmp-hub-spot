import { describe, it, expect } from 'vitest';
import { maskKey } from './maskKey';

describe('maskKey', () => {
  it('masks all but the last 4 chars', () => {
    expect(maskKey('abcd1234wxyz')).toBe('••••••••wxyz');
  });
  it('fully masks short keys', () => {
    expect(maskKey('abc')).toBe('•••');
  });
  it('returns empty for empty', () => {
    expect(maskKey('')).toBe('');
  });
});
