import { describe, it, expect } from 'vitest';
import { pickLocalIP } from './local-ip.js';

const v4 = (address, extra = {}) => ({ family: 'IPv4', internal: false, address, ...extra });

describe('pickLocalIP', () => {
  it('skips a Hyper-V "vEthernet" adapter that sorts first and lands on the real Ethernet (the reported bug)', () => {
    // Exact shape of the reporting machine: virtual switches iterate BEFORE Ethernet.
    const nis = {
      'vEthernet (Default Switch)': [v4('172.18.64.1')],
      'vEthernet (WSL (Hyper-V firewall))': [v4('172.17.48.1')],
      'Ethernet 2': [v4('10.0.0.175')],
      'Loopback Pseudo-Interface 1': [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    };
    expect(pickLocalIP(nis)).toBe('10.0.0.175');
  });

  it('prefers Ethernet over Wi-Fi by PRIORITY, not iteration order', () => {
    const nis = {
      'Wi-Fi': [v4('10.0.0.139')],
      'Ethernet 2': [v4('10.0.0.175')],
    };
    expect(pickLocalIP(nis)).toBe('10.0.0.175');
  });

  it('falls back to Wi-Fi when there is no physical Ethernet', () => {
    const nis = {
      'vEthernet (Default Switch)': [v4('172.18.64.1')],
      'Wi-Fi': [v4('10.0.0.139')],
    };
    expect(pickLocalIP(nis)).toBe('10.0.0.139');
  });

  it('uses any external IPv4 when no named-preference matches', () => {
    const nis = { 'Some NIC': [v4('192.168.1.50')] };
    expect(pickLocalIP(nis)).toBe('192.168.1.50');
  });

  it('ignores internal and non-IPv4 addresses', () => {
    const nis = {
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      Ethernet: [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        v4('10.0.0.5'),
      ],
    };
    expect(pickLocalIP(nis)).toBe('10.0.0.5');
  });

  it('returns 127.0.0.1 when only virtual/internal adapters exist', () => {
    const nis = {
      'vEthernet (Default Switch)': [v4('172.18.64.1')],
      Docker: [v4('172.20.0.1')],
      Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    };
    expect(pickLocalIP(nis)).toBe('127.0.0.1');
  });
});
