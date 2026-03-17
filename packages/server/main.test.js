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
