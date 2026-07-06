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
import { useWebRTC, routeStreamToPeer } from './useWebRTC';

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

  it('joinDenied initialises as null', () => {
    const { result } = renderHook(() => useWebRTC('main-hub'));
    expect(result.current.joinDenied).toBeNull();
  });

  it('routeStreamToPeer replaces outbound tracks in place, never stacking a duplicate stream', () => {
    const oldVideo = { kind: 'video', id: 'oldV' };
    const oldAudio = { kind: 'audio', id: 'oldA' };
    const outbound = {
      getVideoTracks: () => [oldVideo],
      getAudioTracks: () => [oldAudio],
    } as unknown as MediaStream;
    const newVideo = { kind: 'video', id: 'newV' };
    const newAudio = { kind: 'audio', id: 'newA' };
    const incoming = {
      getVideoTracks: () => [newVideo],
      getAudioTracks: () => [newAudio],
    } as unknown as MediaStream;
    const peer = { streams: [outbound], replaceTrack: vi.fn(), addTrack: vi.fn(), addStream: vi.fn() };

    routeStreamToPeer(peer, incoming);

    // The old Elgato bug was a bare addStream (duplicate/stale track). Must NOT happen.
    expect(peer.addStream).not.toHaveBeenCalled();
    expect(peer.addTrack).not.toHaveBeenCalled();
    expect(peer.replaceTrack).toHaveBeenCalledWith(oldVideo, newVideo, outbound);
    expect(peer.replaceTrack).toHaveBeenCalledWith(oldAudio, newAudio, outbound);
  });

  it('routeStreamToPeer addStreams when the peer has no outbound stream yet (first grant)', () => {
    const incoming = {
      getVideoTracks: () => [{ kind: 'video' }],
      getAudioTracks: () => [{ kind: 'audio' }],
    } as unknown as MediaStream;
    const peer = { streams: [], replaceTrack: vi.fn(), addTrack: vi.fn(), addStream: vi.fn() };

    routeStreamToPeer(peer, incoming);

    expect(peer.addStream).toHaveBeenCalledWith(incoming);
    expect(peer.replaceTrack).not.toHaveBeenCalled();
  });

  it('routeStreamToPeer addTracks a kind the outbound stream is missing (no replace)', () => {
    const oldAudio = { kind: 'audio', id: 'oldA' };
    const outbound = {
      getVideoTracks: () => [], // outbound has no video track to replace
      getAudioTracks: () => [oldAudio],
    } as unknown as MediaStream;
    const newVideo = { kind: 'video', id: 'newV' };
    const incoming = {
      getVideoTracks: () => [newVideo],
      getAudioTracks: () => [],
    } as unknown as MediaStream;
    const peer = { streams: [outbound], replaceTrack: vi.fn(), addTrack: vi.fn(), addStream: vi.fn() };

    routeStreamToPeer(peer, incoming);

    expect(peer.addTrack).toHaveBeenCalledWith(newVideo, outbound);
    expect(peer.replaceTrack).not.toHaveBeenCalled();
    expect(peer.addStream).not.toHaveBeenCalled();
  });

  it('includes pin in the join-room emit when connect() is called', async () => {
    const mockEmit = vi.fn();
    const mockOn = vi.fn();
    const { default: ioMock } = await import('socket.io-client') as any;
    ioMock.mockReturnValueOnce({
      on: mockOn,
      emit: mockEmit,
      disconnect: vi.fn(),
      removeAllListeners: vi.fn(),
      connected: false,
      id: 'mock-socket-id',
    });

    // Trigger the connect handler manually: find the 'connect' listener and call it
    mockOn.mockImplementation((event: string, handler: (...args: any[]) => void) => {
      if (event === 'connect') {
        // Call it synchronously so we can assert on emit
        handler();
      }
    });

    const { result } = renderHook(() => useWebRTC('main-hub', { pin: 'secret123' }));
    act(() => { result.current.connect(); });

    const joinRoomCall = mockEmit.mock.calls.find((c: any[]) => c[0] === 'join-room');
    expect(joinRoomCall).toBeTruthy();
    expect(joinRoomCall[1]).toMatchObject({ pin: 'secret123' });
  });
});
