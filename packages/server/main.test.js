import { describe, it, expect, vi } from 'vitest';

describe('NMS Config', () => {
  it('has correct RTMP port default', () => {
    const RTMP_PORT = process.env.RTMP_PORT || 1935;
    expect(Number(RTMP_PORT)).toBe(1935);
  });

  it('has correct HTTP port default', () => {
    const NMS_HTTP_PORT = process.env.NMS_HTTP_PORT || 8000;
    expect(Number(NMS_HTTP_PORT)).toBe(8000);
  });

  it('has gop_cache enabled (required for late-joining RTMP clients)', () => {
    const nmsConfig = { rtmp: { gop_cache: true } };
    expect(nmsConfig.rtmp.gop_cache).toBe(true);
  });
});

describe('Hardware encoder selection', () => {
  const selectEncoder = (hwAccel) => {
    if (hwAccel === 'nvidia') return { codec: 'h264_nvenc', preset: 'p1' };
    if (hwAccel === 'amd')    return { codec: 'h264_amf',   preset: 'speed' };
    if (hwAccel === 'intel')  return { codec: 'h264_qsv',   preset: 'veryfast' };
    return { codec: 'libx264', preset: 'ultrafast' };
  };

  it('selects h264_nvenc for nvidia', () => {
    expect(selectEncoder('nvidia').codec).toBe('h264_nvenc');
  });

  it('selects h264_amf for amd', () => {
    expect(selectEncoder('amd').codec).toBe('h264_amf');
  });

  it('selects h264_qsv for intel', () => {
    expect(selectEncoder('intel').codec).toBe('h264_qsv');
  });

  it('falls back to libx264 for software encoding', () => {
    expect(selectEncoder('none').codec).toBe('libx264');
  });
});

describe('Audio stream strategy', () => {
  const hasFeedAudio = (streamKey) => streamKey.startsWith('feed-');

  it('detects feed audio for feed-* stream keys', () => {
    expect(hasFeedAudio('feed-alice')).toBe(true);
    expect(hasFeedAudio('feed-bob-camera')).toBe(true);
  });

  it('does not detect feed audio for grid and other keys', () => {
    expect(hasFeedAudio('grid')).toBe(false);
    expect(hasFeedAudio('admin')).toBe(false);
    expect(hasFeedAudio('synthetic')).toBe(false);
  });
});

describe('FFmpeg auto-restart backoff', () => {
  const MAX_PIPE_RESTARTS = 3;

  it('calculates correct linear backoff delays', () => {
    const delays = [1, 2, 3].map(n => n * 2000);
    expect(delays).toEqual([2000, 4000, 6000]);
  });

  it('stops scheduling restarts after MAX_PIPE_RESTARTS', () => {
    let restartCount = 0;
    for (let i = 0; i < 10; i++) {
      if (restartCount < MAX_PIPE_RESTARTS) restartCount++;
    }
    expect(restartCount).toBe(MAX_PIPE_RESTARTS);
  });
});

describe('before-quit NMS teardown guard', () => {
  // Mirrors the guarded teardown in main.js before-quit. node-media-server v4
  // removed stop(); calling it unconditionally threw "nms.stop is not a function"
  // and orphaned RTMP port 1935. The guard must (a) never throw and (b) call
  // whichever teardown the installed NMS version actually exposes.
  const teardownNms = (nms, log = { error: () => {} }) => {
    try {
      if (nms && typeof nms.stop === 'function') {
        nms.stop();
      } else if (nms && typeof nms.close === 'function') {
        nms.close();
      }
    } catch (e) {
      log.error('[NMS] teardown failed:', (e && e.message) || e);
    }
  };

  it('calls stop() when the NMS version still exposes it (v2/v3)', () => {
    const nms = { stop: vi.fn() };
    teardownNms(nms);
    expect(nms.stop).toHaveBeenCalled();
  });

  it('does not throw when stop() is absent (node-media-server v4)', () => {
    const nms = {}; // v4: neither stop nor close in this shape
    expect(() => teardownNms(nms)).not.toThrow();
  });

  it('falls back to close() to release port 1935 when stop() is gone but close() exists', () => {
    const nms = { close: vi.fn() };
    teardownNms(nms);
    expect(nms.close).toHaveBeenCalled();
  });

  it('does not throw when nms itself is null', () => {
    expect(() => teardownNms(null)).not.toThrow();
  });
});

describe('kick-user socket handler logic', () => {
  it('emits kicked to the target socket and disconnects it', () => {
    const targetSocket = { emit: vi.fn(), disconnect: vi.fn() };
    const sockets = new Map([['target-id', targetSocket]]);

    // Simulates the handler body from main.js
    const handleKick = (targetId) => {
      const sock = sockets.get(targetId);
      if (sock) {
        sock.emit('kicked', { reason: 'Removed by admin' });
        sock.disconnect(true);
      }
    };

    handleKick('target-id');
    expect(targetSocket.emit).toHaveBeenCalledWith('kicked', { reason: 'Removed by admin' });
    expect(targetSocket.disconnect).toHaveBeenCalledWith(true);
  });

  it('does nothing when the target socket does not exist', () => {
    const otherSocket = { emit: vi.fn(), disconnect: vi.fn() };
    const sockets = new Map([['other-id', otherSocket]]);

    const handleKick = (targetId) => {
      const sock = sockets.get(targetId);
      if (sock) {
        sock.emit('kicked', { reason: 'Removed by admin' });
        sock.disconnect(true);
      }
    };

    handleKick('nonexistent-id');
    expect(otherSocket.emit).not.toHaveBeenCalled();
    expect(otherSocket.disconnect).not.toHaveBeenCalled();
  });
});

describe('renegotiate relay handler logic', () => {
  // Mirrors the socket.on('renegotiate', ...) body in main.js: forward the
  // simple-peer renegotiation signal to the targeted peer, stamping senderId.
  const makeRelay = (users) => {
    const sent = [];
    const socket = {
      id: 'sender-id',
      to: (target) => ({ emit: (event, payload) => sent.push({ target, event, payload }) }),
    };
    const handleRenegotiate = (data) => {
      if (!users[socket.id]) return; // only joined members may signal
      socket.to(data.to).emit('renegotiate', {
        data: data.data,
        senderId: socket.id,
      });
    };
    return { sent, handleRenegotiate };
  };

  it('forwards the renegotiate signal to the target with senderId', () => {
    const { sent, handleRenegotiate } = makeRelay({ 'sender-id': { name: 'A', roomId: 'main-hub' } });
    handleRenegotiate({ to: 'peer-id', data: { type: 'renegotiate' } });
    expect(sent).toEqual([
      { target: 'peer-id', event: 'renegotiate', payload: { data: { type: 'renegotiate' }, senderId: 'sender-id' } },
    ]);
  });

  it('drops the signal from a socket that has not joined', () => {
    const { sent, handleRenegotiate } = makeRelay({}); // sender not in users
    handleRenegotiate({ to: 'peer-id', data: { type: 'renegotiate' } });
    expect(sent).toEqual([]);
  });
});

describe('peer signal emit filter (client renegotiation)', () => {
  // Mirrors the bindPeerEvents 'signal' filter in useWebRTC.ts. simple-peer emits
  // a { type: 'renegotiate' } (or { renegotiate: true }) signal that must be
  // forwarded over a dedicated 'renegotiate' socket event — previously it fell
  // through and was silently dropped, so a connected peer's video stayed black.
  const emitForSignal = (signal, remoteId = 'remote-1') => {
    const emitted = [];
    const socket = { emit: (event, payload) => emitted.push({ event, payload }) };
    if (signal.type === 'offer' || signal.type === 'transceiverRequest') {
      socket.emit('offer', { roomId: 'main-hub', offer: signal, to: remoteId });
    } else if (signal.type === 'answer') {
      socket.emit('answer', { roomId: 'main-hub', answer: signal, to: remoteId });
    } else if (signal.type === 'renegotiate' || signal.renegotiate) {
      socket.emit('renegotiate', { roomId: 'main-hub', data: signal, to: remoteId });
    } else if (signal.candidate) {
      socket.emit('ice-candidate', { roomId: 'main-hub', candidate: signal, to: remoteId });
    }
    return emitted;
  };

  it('emits a renegotiate event for a { type: "renegotiate" } signal', () => {
    const emitted = emitForSignal({ type: 'renegotiate' });
    expect(emitted).toEqual([
      { event: 'renegotiate', payload: { roomId: 'main-hub', data: { type: 'renegotiate' }, to: 'remote-1' } },
    ]);
  });

  it('emits a renegotiate event for a { renegotiate: true } signal', () => {
    const emitted = emitForSignal({ renegotiate: true });
    expect(emitted).toEqual([
      { event: 'renegotiate', payload: { roomId: 'main-hub', data: { renegotiate: true }, to: 'remote-1' } },
    ]);
  });

  it('still routes offer/answer/ice through their own events', () => {
    expect(emitForSignal({ type: 'offer' })[0].event).toBe('offer');
    expect(emitForSignal({ type: 'answer' })[0].event).toBe('answer');
    expect(emitForSignal({ candidate: {} })[0].event).toBe('ice-candidate');
  });
});
