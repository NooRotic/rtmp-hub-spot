'use strict';

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
 */
function createPipeManager({ spawnPipe, PassThrough, buildFfmpegArgs, broadcastIPC, rtmpPort, maxRestarts = 3 }) {
  /** @type {Map<string, {proc:{kill:Function}, videoStream:any, config:object, restartCount:number, restartTimeout:any}>} */
  const pipes = new Map();

  function parseStats(line, streamKey) {
    const m = line.match(
      /frame=\s*(\d+)\s+fps=\s*([\d.]+).*?size=\s*([\d.]+\s*\w+).*?time=([\d:.]+).*?bitrate=\s*([\d.]+\s*\S+).*?speed=\s*([\d.]+)x/,
    );
    if (!m) return null;
    return {
      frame: parseInt(m[1], 10),
      fps: parseFloat(m[2]),
      size: m[3].trim(),
      time: m[4],
      bitrate: m[5].trim(),
      speed: parseFloat(m[6]),
      streamKey,
    };
  }

  function spawn(config, ctx, restartCount) {
    const { streamKey } = config;
    const videoStream = new PassThrough();
    const args = buildFfmpegArgs({ ...config, rtmpPort });

    broadcastIPC('ffmpeg-status', { state: 'starting', streamKey });

    const entry = { proc: null, videoStream, config, restartCount, restartTimeout: null };
    pipes.set(streamKey, entry);

    entry.proc = spawnPipe(videoStream, args, {
      onStart: () => broadcastIPC('ffmpeg-status', { state: 'running', streamKey }),
      onStderr: (line) => {
        const stats = parseStats(line, streamKey);
        if (stats) broadcastIPC('ffmpeg-stats', stats);
      },
      onError: (err) => handleError(streamKey, err, ctx),
    });
    return entry;
  }

  function handleError(streamKey, err, ctx) {
    const entry = pipes.get(streamKey);
    const message = (err && err.message) || String(err);

    // SIGKILL/SIGINT are expected during a user-initiated stop — not real crashes.
    if (/SIGKILL|SIGINT|killed/i.test(message)) {
      broadcastIPC('ffmpeg-status', { state: 'stopped', streamKey: null });
      pipes.delete(streamKey);
      return;
    }

    broadcastIPC('ffmpeg-status', { state: 'error', streamKey, message });
    if (ctx && ctx.sender && !(ctx.sender.isDestroyed && ctx.sender.isDestroyed())) {
      ctx.sender.send('ffmpeg-error', message);
    }

    if (!entry || entry.restartCount >= maxRestarts) {
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

  /** Write a WebM chunk to the pipe for streamKey (no-op if that pipe isn't running). */
  function writeChunk(streamKey, chunk) {
    const entry = pipes.get(streamKey);
    if (!entry || !entry.videoStream) return;
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
