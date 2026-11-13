/// <reference types="vitest" />
/**
 * Characterization tests for VideoFeed's MediaRecorder -> FFmpeg IPC pipe.
 *
 * Pins the per-feed chunk contract so audit #4 (unifying GridView + VideoFeed
 * into one useMediaRecorderPipe hook) can be verified non-regressive. Written
 * against the CURRENT code. Note the deliberate differences from GridView:
 *   - streamKey is `feed-<label kebab-cased>`
 *   - the chunk payload is a raw ArrayBuffer (GridView wraps it in Uint8Array)
 *   - pipe-start payload carries { hwAccel } (defaults to 'none')
 *
 * VideoFeed reads isElectron/ipc at module-eval time → globals set before import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent, cleanup } from '../test/testUtils';

Object.defineProperty(navigator, 'userAgent', {
  value: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Electron/40.0.0 Safari/537.36',
  configurable: true,
});

const sent: Array<{ channel: string; payload?: any }> = [];
(window as any).electron = {
  ipcRenderer: {
    send: (channel: string, payload?: any) => { sent.push({ channel, payload }); },
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
};

let lastRecorder: any = null;
const MockRecorder: any = vi.fn().mockImplementation(() => {
  lastRecorder = {
    start: vi.fn(),
    stop: vi.fn(),
    ondataavailable: null,
    onerror: null,
    mimeType: 'video/webm; codecs=vp8',
    state: 'recording',
  };
  return lastRecorder;
});
MockRecorder.isTypeSupported = () => true;
(global as any).MediaRecorder = MockRecorder;

const { default: VideoFeed } = await import('./VideoFeed');

const mockStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;

// VideoFeed's handler is synchronous but kicks off arrayBuffer().then(...), and
// the first chunk waits 100ms for FFmpeg init — so flush microtasks + that timer.
const fireChunk = async (size = 2048) => {
  lastRecorder.ondataavailable({ data: { size, arrayBuffer: async () => new ArrayBuffer(size) } });
  await new Promise((r) => setTimeout(r, 140));
};

const broadcastButton = () => screen.getByRole('button', { name: /broadcast/i });
const stopButton = () => screen.getByRole('button', { name: /^stop$/i });

/** Deliver an ffmpeg-error to the handler the mounted VideoFeed registered. */
const emitFfmpegError = (payload: { streamKey: string; message: string }) => {
  const on = (window as any).electron.ipcRenderer.on as ReturnType<typeof vi.fn>;
  const calls = on.mock.calls.filter((c: any[]) => c[0] === 'ffmpeg-error');
  const handler = calls[calls.length - 1][1];
  handler(null, payload);
};

describe('VideoFeed → FFmpeg pipe (characterization)', () => {
  beforeEach(() => {
    sent.length = 0;
    lastRecorder = null;
    (window as any).electron.ipcRenderer.on.mockClear();
  });
  afterEach(cleanup);

  it('shows the BROADCAST toggle in Electron mode', () => {
    render(<VideoFeed label="Cam One" stream={mockStream} />);
    expect(broadcastButton()).toBeInTheDocument();
  });

  it('starts the pipe once then streams chunks keyed "feed-cam-one" with ArrayBuffer payloads', async () => {
    render(<VideoFeed label="Cam One" stream={mockStream} />);
    fireEvent.click(broadcastButton());

    await fireChunk();
    await fireChunk();

    const starts = sent.filter((s) => s.channel === 'ffmpeg-pipe-start');
    const chunks = sent.filter((s) => s.channel === 'ffmpeg-pipe-chunk');

    expect(starts).toHaveLength(1);
    expect(starts[0].payload).toMatchObject({ streamKey: 'feed-cam-one', hwAccel: 'none' });
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.payload.streamKey === 'feed-cam-one')).toBe(true);
    expect(chunks[0].payload.chunk).toBeInstanceOf(ArrayBuffer);
  });

  it('defaults the encoder to the detected best (defaultHwAccel) and sends it on pipe-start', async () => {
    render(<VideoFeed label="Cam One" stream={mockStream} defaultHwAccel="nvidia" />);
    fireEvent.click(broadcastButton());
    await fireChunk();

    const starts = sent.filter((s) => s.channel === 'ffmpeg-pipe-start');
    expect(starts[0].payload).toMatchObject({ streamKey: 'feed-cam-one', hwAccel: 'nvidia' });
  });

  it('ignores empty (size 0) chunks', async () => {
    render(<VideoFeed label="Cam One" stream={mockStream} />);
    fireEvent.click(broadcastButton());

    await fireChunk(0);

    expect(sent.filter((s) => s.channel === 'ffmpeg-pipe-start')).toHaveLength(0);
    expect(sent.filter((s) => s.channel === 'ffmpeg-pipe-chunk')).toHaveLength(0);
  });

  it('sends ffmpeg-pipe-stop keyed to this feed and stops the recorder when toggled off', async () => {
    render(<VideoFeed label="Cam One" stream={mockStream} />);
    fireEvent.click(broadcastButton());
    await fireChunk();

    fireEvent.click(stopButton());

    const stops = sent.filter((s) => s.channel === 'ffmpeg-pipe-stop');
    expect(stops).toHaveLength(1);
    // A keyless stop makes main stopAll() — which would kill a running grid broadcast.
    expect(stops[0].payload).toEqual({ streamKey: 'feed-cam-one' });
    expect(lastRecorder.stop).toHaveBeenCalled();
  });

  it('stops with the key it STARTED with, even if the label changed meanwhile', async () => {
    const { rerender } = render(<VideoFeed label="Cam One" stream={mockStream} />);
    fireEvent.click(broadcastButton());
    await fireChunk();

    rerender(<VideoFeed label="Cam Renamed" stream={mockStream} />);
    fireEvent.click(stopButton());

    const stops = sent.filter((s) => s.channel === 'ffmpeg-pipe-stop');
    expect(stops[0].payload).toEqual({ streamKey: 'feed-cam-one' });
  });

  describe('ffmpeg-error is scoped by streamKey', () => {
    it("ignores another pipe's error but stops piping on its own", async () => {
      render(<VideoFeed label="Cam One" stream={mockStream} />);
      fireEvent.click(broadcastButton());
      await fireChunk();
      expect(stopButton()).toBeInTheDocument();

      // e.g. the grid pipe (or another feed) crashed — this tile must stay live.
      act(() => emitFfmpegError({ streamKey: 'grid', message: 'grid crashed' }));
      act(() => emitFfmpegError({ streamKey: 'feed-other', message: 'other crashed' }));
      expect(stopButton()).toBeInTheDocument();
      expect(lastRecorder.stop).not.toHaveBeenCalled();
      expect(sent.filter((s) => s.channel === 'ffmpeg-pipe-stop')).toHaveLength(0);

      act(() => emitFfmpegError({ streamKey: 'feed-cam-one', message: 'ours crashed' }));
      expect(broadcastButton()).toBeInTheDocument();
    });

    it('on its own error, stops the recorder and sends a keyed pipe stop (no auto-restarted orphan)', async () => {
      render(<VideoFeed label="Cam One" stream={mockStream} />);
      fireEvent.click(broadcastButton());
      await fireChunk();
      const firstRecorder = lastRecorder;

      act(() => emitFfmpegError({ streamKey: 'feed-cam-one', message: 'ours crashed' }));

      expect(firstRecorder.stop).toHaveBeenCalledTimes(1);
      const stops = sent.filter((s) => s.channel === 'ffmpeg-pipe-stop');
      expect(stops).toHaveLength(1);
      expect(stops[0].payload).toEqual({ streamKey: 'feed-cam-one' });
    });

    it('does not call stop() on a recorder that is already inactive', async () => {
      render(<VideoFeed label="Cam One" stream={mockStream} />);
      fireEvent.click(broadcastButton());
      await fireChunk();
      lastRecorder.state = 'inactive'; // e.g. the recorder itself errored out

      act(() => emitFfmpegError({ streamKey: 'feed-cam-one', message: 'ours crashed' }));

      expect(lastRecorder.stop).not.toHaveBeenCalled();
      expect(broadcastButton()).toBeInTheDocument();
    });

    it('a BROADCAST click after its own error starts a fresh recorder and pipe', async () => {
      render(<VideoFeed label="Cam One" stream={mockStream} />);
      fireEvent.click(broadcastButton());
      await fireChunk();
      const firstRecorder = lastRecorder;
      act(() => emitFfmpegError({ streamKey: 'feed-cam-one', message: 'ours crashed' }));
      sent.length = 0;

      fireEvent.click(broadcastButton());
      await fireChunk();

      expect(lastRecorder).not.toBe(firstRecorder);
      expect(firstRecorder.stop).toHaveBeenCalledTimes(1); // old one stopped, not left running
      const starts = sent.filter((s) => s.channel === 'ffmpeg-pipe-start');
      expect(starts).toHaveLength(1);
      expect(starts[0].payload).toMatchObject({ streamKey: 'feed-cam-one' });
    });
  });
});
