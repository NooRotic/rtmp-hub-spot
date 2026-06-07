import { describe, it, expect } from 'vitest';
import { isLoopback, createRoomGate } from './room-pin.js';

describe('isLoopback', () => {
  it('recognizes loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });
  it('rejects LAN/remote + empty', () => {
    expect(isLoopback('10.0.0.156')).toBe(false);
    expect(isLoopback('192.168.1.5')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

describe('createRoomGate', () => {
  it('open hub (no pin) admits anyone', () => {
    const g = createRoomGate();
    expect(g.isLocked()).toBe(false);
    expect(g.check('10.0.0.5', '').allowed).toBe(true);
  });
  it('locked hub admits correct pin, denies wrong/missing for remote', () => {
    const g = createRoomGate();
    g.setPin('1234');
    expect(g.isLocked()).toBe(true);
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
    expect(g.check('10.0.0.5', '9999')).toEqual({ allowed: false, reason: 'pin' });
    expect(g.check('10.0.0.5', '')).toEqual({ allowed: false, reason: 'pin' });
  });
  it('loopback is always admitted even when locked', () => {
    const g = createRoomGate();
    g.setPin('1234');
    expect(g.check('127.0.0.1', '').allowed).toBe(true);
    expect(g.check('::1', 'wrong').allowed).toBe(true);
  });
  it('clearing the pin reopens the hub', () => {
    const g = createRoomGate();
    g.setPin('1234'); g.setPin('');
    expect(g.isLocked()).toBe(false);
    expect(g.check('10.0.0.5', '').allowed).toBe(true);
  });
  it('throttles after 5 failed attempts then cools down; correct pin resets', () => {
    let t = 1000;
    const g = createRoomGate({ now: () => t, maxFails: 5, cooldownMs: 60000 });
    g.setPin('1234');
    for (let i = 0; i < 4; i++) expect(g.check('10.0.0.5', 'x')).toEqual({ allowed: false, reason: 'pin' });
    const fifth = g.check('10.0.0.5', 'x');
    expect(fifth).toEqual({ allowed: false, reason: 'pin', lockout: true });
    expect(g.check('10.0.0.5', '1234')).toEqual({ allowed: false, reason: 'cooldown' });
    t += 60001;
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
  });
  it('a correct pin before lockout resets the fail counter', () => {
    const g = createRoomGate();
    g.setPin('1234');
    g.check('10.0.0.5', 'x'); g.check('10.0.0.5', 'x');
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
    for (let i = 0; i < 4; i++) g.check('10.0.0.5', 'x');
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
  });
});
