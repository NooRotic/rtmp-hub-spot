/// <reference types="vitest" />
/**
 * Characterization tests for GridView's MediaRecorder -> FFmpeg IPC pipe.
 *
 * These PIN the current chunk contract so the planned refactor (audit #4 —
 * extracting a shared useMediaRecorderPipe hook) can be verified to preserve
 * behavior. They are intentionally written against the CURRENT code.
 *
 * GridView reads `isElectron` and `ipc` at module-eval time, so the Electron-like
 * globals are installed BEFORE GridView is dynamically imported below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent, cleanup } from '../test/testUtils';

// --- Electron-like environment, set up before GridView import ---
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

// Import AFTER the globals exist so module-level ipc/isElectron resolve to them.
const { default: GridView } = await import('./GridView');

/** Simulate one MediaRecorder dataavailable event with a blob of the given size. */
const fireChunk = (size = 2048) =>
  lastRecorder.ondataavailable({ data: { size, arrayBuffer: async () => new ArrayBuffer(size) } });

const startButton = () => screen.getByRole('button', { name: /start grid broadcast/i });

describe('GridView → FFmpeg pipe (characterization)', () => {
  beforeEach(() => { sent.length = 0; lastRecorder = null; });
  afterEach(cleanup);

  it('shows the broadcast toggle in Electron mode', () => {
    render(<GridView streams={[]} />);
    expect(startButton()).toBeInTheDocument();
  });

  it('starts the pipe once on the first chunk, then streams chunks — all keyed "grid"', async () => {
    render(
      <GridView
        streams={[]}
        broadcastSettings={{ bitrate: '2500k', preset: 'ultrafast', hwAccel: 'nvidia' }}
      />,
    );
    fireEvent.click(startButton());

    await fireChunk();
    await fireChunk();
    await fireChunk();

    const starts = sent.filter((s) => s.channel === 'ffmpeg-pipe-start');
    const chunks = sent.filter((s) => s.channel === 'ffmpeg-pipe-chunk');

    expect(starts).toHaveLength(1);
    expect(starts[0].payload).toMatchObject({
      streamKey: 'grid',
      bitrate: '2500k',
      preset: 'ultrafast',
      hwAccel: 'nvidia',
    });
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.payload.streamKey === 'grid')).toBe(true);
    expect(chunks[0].payload.chunk).toBeInstanceOf(Uint8Array);
  });

  it('ignores empty (size 0) chunks — no pipe start, no chunk sent', async () => {
    render(<GridView streams={[]} />);
    fireEvent.click(startButton());

    await fireChunk(0);

    expect(sent.filter((s) => s.channel === 'ffmpeg-pipe-start')).toHaveLength(0);
    expect(sent.filter((s) => s.channel === 'ffmpeg-pipe-chunk')).toHaveLength(0);
  });

  it('sends ffmpeg-pipe-stop and stops the recorder when toggled off', async () => {
    render(<GridView streams={[]} />);
    fireEvent.click(startButton());
    await fireChunk();

    fireEvent.click(screen.getByRole('button', { name: /stop grid broadcast/i }));

    expect(sent.some((s) => s.channel === 'ffmpeg-pipe-stop')).toBe(true);
    expect(lastRecorder.stop).toHaveBeenCalled();
  });

  it('STALL WATCHDOG: surfaces a visible "broadcast failed" banner when chunks stop for ~3s', async () => {
    vi.useFakeTimers();
    try {
      const onBroadcastError = vi.fn();
      const { container } = render(<GridView streams={[]} onBroadcastError={onBroadcastError} />);
      fireEvent.click(startButton());
      // No chunks ever arrive (the grid source starves ffmpeg from the start).
      // Advance past the 3s stall threshold + a watchdog tick (in act so the
      // resulting setState flushes to the DOM banner).
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });

      expect(onBroadcastError).toHaveBeenCalled();
      expect(onBroadcastError.mock.calls[0][0]).toMatch(/stall/i);
      const banner = container.querySelector('[data-testid="broadcast-error"]');
      expect(banner).toBeTruthy();
      expect(banner?.textContent).toMatch(/broadcast failed/i);
    } finally {
      vi.useRealTimers();
    }
  });
});
