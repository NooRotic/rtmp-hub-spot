import { describe, it, expect } from 'vitest';
import { toneFor } from './toneFor';

describe('toneFor', () => {
  it('maps live/running to live', () => {
    expect(toneFor('live')).toBe('live');
    expect(toneFor('running')).toBe('live');
  });
  it('maps in-progress states to warn', () => {
    expect(toneFor('connecting')).toBe('warn');
    expect(toneFor('starting')).toBe('warn');
    expect(toneFor('reconnecting')).toBe('warn');
  });
  it('maps error to error', () => {
    expect(toneFor('error')).toBe('error');
  });
  it('maps idle/stopped/unknown to idle', () => {
    expect(toneFor('idle')).toBe('idle');
    expect(toneFor('stopped')).toBe('idle');
    expect(toneFor('whatever')).toBe('idle');
  });
});
