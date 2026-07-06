'use strict';

const { parseFfmpegProgress } = require('./ffmpeg-progress');

/**
 * Resolve a logger. Prefer electron-log/main (so failures persist to
 * {userData}/logs/main.log, same sink main.js uses); fall back to console if
 * electron-log isn't available (e.g. unit tests outside Electron).
 * @returns {{error:Function, warn:Function, info:Function}}
 */
function defaultLogger() {
  try {
    // eslint-disable-next-line global-require
    return require('electron-log/main');
  } catch (_) {
    return console;
  }
}

/**
 * Multi-pipe FFmpeg engine (audit #1). Replaces the three module-level singletons
 * (pipeFfmpeg / videoStream / activeStreamKey) with a Map keyed by streamKey, so
 * the grid and any number of per-feed streams can publish concurrently.
 *
 * The fluent-ffmpeg glue is injected as `spawnPipe(videoStream, args, handlers)`
 * (returns a process exposing `.kill()`), keeping this module free of process
 * spawning so the lifecycle/routing/restart logic is unit-testable.
 *
 * @param {object} deps
 * @param {(videoStream: any, args: object, handlers: {onStart:Function,onStderr:Function,onError:Function}) => {kill:Function}} deps.spawnPipe
 * @param {Function} deps.PassThrough - stream.PassThrough constructor
 * @param {Function} deps.buildFfmpegArgs
 * @param {(channel: string, data: object) => void} deps.broadcastIPC
 * @param {number} deps.rtmpPort
 * @param {number} [deps.maxRestarts=3]
 * @param {{error:Function, warn:Function, info:Function}} [deps.log] - logger; defaults to electron-log/main (console fallback)
 * @param {number} [deps.stderrTailSize=20] - how many recent non-progress stderr lines to retain per pipe for crash diagnostics
 */
function createPipeManager({ spawnPipe, PassThrough, buildFfmpegArgs, broadcastIPC, rtmpPort, maxRestarts = 3, log = defaultLogger(), stderrTailSize = 20 }) {
  /** @type {Map<string, {proc:{kill:Function}, videoStream:any, config:object, restartCount:number, restartTimeout:any, stderrTail:string[]}>} */
  const pipes = new Map();

  function parseStats(line, streamKey) {
    const p = parseFfmpegProgress(line);
    if (!p) return null;
    return {
      frame: p.frame,
      fps: p.fps,
      size: p.size,
      time: p.time,
      bitrate: p.bitrate,
      speed: p.speed,
      streamKey,
    };
  }

  function spawn(config, ctx, restartCount) {
    const { streamKey } = config;
    const videoStream = new PassThrough();
    const args = buildFfmpegArgs({ ...config, rtmpPort });

    broadcastIPC('ffmpeg-status', { state: 'starting', streamKey });

    const entry = { proc: null, videoStream, config, restartCount, restartTimeout: null, stderrTail: [] };
    pipes.set(streamKey, entry);

    entry.proc = spawnPipe(videoStream, args, {
      onStart: () => broadcastIPC('ffmpeg-status', { state: 'running', streamKey }),
      onStderr: (line) => {
        const stats = parseStats(line, streamKey);
        if (stats) {
          broadcastIPC('ffmpeg-stats', stats);
          return;
        }
        // Non-progress stderr (codec/keyframe/EPIPE/connection diagnostics) used to
        // be discarded. Keep a rolling tail so the real cause persists in the log
        // when the pipe errors/exits — see handleError.
        const tail = entry.stderrTail;
        tail.push(typeof line === 'string' ? line.trimEnd() : String(line));
        if (tail.length > stderrTailSize) tail.shift();
      },
      onError: (err) => handleError(streamKey, err, ctx),
    });
    return entry;
  }

  function handleError(streamKey, err, ctx) {
    const entry = pipes.get(streamKey);
    const message = (err && err.message) || String(err);
    const tail = (entry && entry.stderrTail) || [];

    // SIGKILL/SIGINT are expected during a user-initiated stop — not real crashes.
    if (/SIGKILL|SIGINT|killed/i.test(message)) {
      broadcastIPC('ffmpeg-status', { state: 'stopped', streamKey: null });
      pipes.delete(streamKey);
      return;
    }

    // LOUD: persist the real cause to the log file BEFORE the IPC fan-out. Without
    // this the grid publisher closed with nothing logged between "connected" and
    // "close" because errors went only over IPC and stderr was discarded.
    log.error(`[FFMPEG][${streamKey}] pipe error: ${message}`);
    if (tail.length) {
      log.error(`[FFMPEG][${streamKey}] last ${tail.length} ffmpeg stderr line(s):\n${tail.join('\n')}`);
    } else {
      log.error(`[FFMPEG][${streamKey}] no ffmpeg stderr captured before the error (ffmpeg may never have started).`);
    }

    broadcastIPC('ffmpeg-status', { state: 'error', streamKey, message });
    if (ctx && ctx.sender && !(ctx.sender.isDestroyed && ctx.sender.isDestroyed())) {
      ctx.sender.send('ffmpeg-error', message);
    }

    if (!entry || entry.restartCount >= maxRestarts) {
      log.error(`[FFMPEG][${streamKey}] crashed ${maxRestarts} times — giving up; manual restart required.`);
      broadcastIPC('ffmpeg-status', {
        state: 'error',
        streamKey,
        message: `Crashed ${maxRestarts} times — manual restart required.`,
      });
      pipes.delete(streamKey);
      return;
    }

    const next = entry.restartCount + 1;
    broadcastIPC('ffmpeg-status', {
      state: 'starting',
      streamKey,
      message: `Restarting (attempt ${next}/${maxRestarts})…`,
    });
    entry.restartTimeout = setTimeout(() => spawn(entry.config, ctx, next), next * 2000);
  }

  /** Start (or restart) the pipe for config.streamKey. Does NOT touch other pipes. */
  function start(config, ctx = {}) {
    const existing = pipes.get(config.streamKey);
    if (existing) {
      if (existing.restartTimeout) clearTimeout(existing.restartTimeout);
      if (existing.proc) existing.proc.kill();
    }
    spawn(config, ctx, 0); // fresh manual start resets the restart counter
  }

  /** streamKeys we've already warned about, so an unknown-key flood logs once each. */
  const warnedUnknownKeys = new Set();

  /** Write a WebM chunk to the pipe for streamKey (no-op if that pipe isn't running). */
  function writeChunk(streamKey, chunk) {
    const entry = pipes.get(streamKey);
    if (!entry || !entry.videoStream) {
      // Was a silent no-op: chunks for a pipe that isn't running (race on start,
      // or a stale/wrong streamKey) vanished with no trace. Warn once per key.
      if (!warnedUnknownKeys.has(streamKey)) {
        warnedUnknownKeys.add(streamKey);
        log.warn(`[FFMPEG][${streamKey}] dropping chunk — no running pipe for this streamKey (chunks arriving before start, or wrong key).`);
      }
      return;
    }
    warnedUnknownKeys.delete(streamKey);
    entry.videoStream.write(Buffer.from(chunk));
  }

  /** Stop and remove a single pipe. */
  function stop(streamKey) {
    const entry = pipes.get(streamKey);
    if (!entry) return;
    if (entry.restartTimeout) clearTimeout(entry.restartTimeout);
    if (entry.videoStream) entry.videoStream.end();
    if (entry.proc) entry.proc.kill();
    pipes.delete(streamKey);
    broadcastIPC('ffmpeg-status', { state: 'stopped', streamKey: null });
  }

  /** Stop every running pipe (used for the legacy no-streamKey stop and on quit). */
  function stopAll() {
    for (const streamKey of [...pipes.keys()]) stop(streamKey);
  }

  return {
    start,
    writeChunk,
    stop,
    stopAll,
    has: (streamKey) => pipes.has(streamKey),
    size: () => pipes.size,
  };
}

module.exports = { createPipeManager };
