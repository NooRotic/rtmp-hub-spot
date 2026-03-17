/**
 * useWebRTC hook tests.
 *
 * Intentionally avoids @testing-library/react because that package lives in the
 * root node_modules (React 19) while the client uses React 18. Using it causes a
 * dual-React-instance error ("Cannot read properties of null (reading 'useState')").
 *
 * Instead we use a minimal renderHook built from React 18's createRoot + act,
 * which are both aliased to the client-local React 18 copy via vitest.config.ts.
 */
import React, { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWebRTC } from './useWebRTC';

vi.mock('socket.io-client', () => ({
  default: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    connected: false,
    id: 'mock-socket-id',
  })),
}));

vi.mock('simple-peer', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    destroy: vi.fn(),
    signal: vi.fn(),
    streams: [],
  })),
}));

/** Minimal renderHook that only uses client-local React 18 (never @testing-library/react). */
function renderHook<T>(fn: () => T): { result: { current: T } } {
  let latest: T;
  const result = { current: undefined as unknown as T };

  function TestComponent() {
    latest = fn();
    result.current = latest;
    return null;
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(createElement(TestComponent));
  });

  return { result };
}

describe('useWebRTC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialises with disconnected status and empty peer list', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(result.current.isConnected).toBe(false);
    expect(result.current.socketStatus).toBe('disconnected');
    expect(result.current.peers).toEqual([]);
    expect(result.current.chatMessages).toEqual([]);
  });

  it('exposes isLive as false when not connected', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(result.current.isLive).toBe(false);
  });

  it('exposes wasKicked as false initially', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(result.current.wasKicked).toBe(false);
  });

  it('exposes all required functions without throwing', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(typeof result.current.connect).toBe('function');
    expect(typeof result.current.disconnect).toBe('function');
    expect(typeof result.current.sendMessage).toBe('function');
    expect(typeof result.current.kickUser).toBe('function');
    expect(typeof result.current.setIsVideoEnabled).toBe('function');
    expect(typeof result.current.setIsAudioEnabled).toBe('function');
  });

  it('sendMessage does not throw when not connected', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(() => result.current.sendMessage('hello')).not.toThrow();
  });

  it('kickUser does not throw when not connected', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(() => result.current.kickUser('some-socket-id')).not.toThrow();
  });

  it('disconnect does not throw when not connected', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(() => act(() => { result.current.disconnect(); })).not.toThrow();
    expect(result.current.isConnected).toBe(false);
  });

  it('isVideoEnabled and isAudioEnabled default to true', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(result.current.isVideoEnabled).toBe(true);
    expect(result.current.isAudioEnabled).toBe(true);
  });

  it('isLive stays false with peers but no streams', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(result.current.peers.length).toBe(0);
    expect(result.current.isLive).toBe(false);
  });
});
