'use strict';

const { parseFfmpegProgress } = require('./ffmpeg-progress');

// Clear config/auth failures that will NOT self-heal — surface as error, no retry.
// Numeric auth codes are \b-anchored so a port/streamkey substring (e.g. :4013) can't false-match.
const FATAL = /\b(401|403)\b|Unauthorized|Forbidden|Invalid stream key|no such host|Name or service not known|nonexistent stream/i;

/**
 * Keyed copy-relay engine (sibling of pipe-manager). One FFmpeg process per
 * destination, pulling from local NMS and copying to a platform. Does NOT
 * self-restart: transient failures are handed to onTransientFailure so the
 * reconnection-supervisor can stagger/prioritize reconnects globally.
 *
 * @param {object} deps
 * @param {(args:object, handlers:{onStart:Function,onStderr:Function,onError:Function}) => {kill:Function}} deps.spawnRelay
 * @param {Function} deps.buildRelayArgs
 * @param {(channel:string,data:object)=>void} deps.broadcastIPC
 * @param {number} deps.rtmpPort
 * @param {() => number} [deps.now]
 * @param {(sourceKey:string,destinationId:string)=>void} [deps.onLive]
 * @param {(item:{sourceKey:string,destination:object})=>void} [deps.onTransientFailure]
 */
function createRelayManager({
  spawnRelay,
  buildRelayArgs,
  broadcastIPC,
  rtmpPort,
  now = () => Date.now(),
  onLive = () => {},
  onTransientFailure = () => {},
}) {
  const relays = new Map(); // compositeKey -> { proc, sourceKey, destination, startedAt }
  const keyOf = (sourceKey, destinationId) => `relay:${sourceKey}:${destinationId}`;

  function start(sourceKey, destination) {
    const key = keyOf(sourceKey, destination.id);
    const existing = relays.get(key);
    if (existing && existing.proc) existing.proc.kill();

    const args = buildRelayArgs({ sourceKey, destination, rtmpPort });
    broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'connecting' });

    const startedAt = now();
    const entry = { proc: null, sourceKey, destination, startedAt };
    relays.set(key, entry);

    entry.proc = spawnRelay(args, {
      // NOTE: 'start' fires when the ffmpeg process starts, not when the platform
      // has accepted the RTMP handshake — so 'live' means "relay process running"
      // (same semantics as pipe-manager). A rejected platform goes live -> error.
      onStart: () => {
        broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'live' });
        onLive(sourceKey, destination.id);
      },
      onStderr: (line) => {
        const p = parseFfmpegProgress(line);
        if (!p) return;
        broadcastIPC('relay-stats', {
          sourceKey,
          destinationId: destination.id,
          fps: p.fps,
          bitrate: p.bitrate,
          speed: p.speed,
          droppedFrames: p.droppedFrames,
          frame: p.frame,
          size: p.size,
          time: p.time,
          uptimeSec: Math.floor((now() - startedAt) / 1000),
        });
      },
      onError: (err) => handleError(key, entry, err),
    });
  }

  function handleError(key, entry, err) {
    // Ignore errors from a proc that has already been replaced or stopped: act
    // only if this entry is still the live one at its key (guards the restart race).
    if (relays.get(key) !== entry) return;
    const { sourceKey, destination } = entry;
    const message = (err && err.message) || String(err);

    if (/SIGKILL|SIGINT|killed/i.test(message)) {
      broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'stopped' });
      relays.delete(key);
      return;
    }
    if (FATAL.test(message)) {
      broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'error', message });
      relays.delete(key);
      return;
    }
    // Transient (default): let the supervisor schedule a staggered reconnect.
    broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'reconnecting', message });
    relays.delete(key);
    onTransientFailure({ sourceKey, destination });
  }

  function stop(sourceKey, destinationId) {
    const key = keyOf(sourceKey, destinationId);
    const entry = relays.get(key);
    if (!entry) return;
    if (entry.proc) entry.proc.kill();
    relays.delete(key);
    broadcastIPC('relay-status', { sourceKey, destinationId, state: 'stopped' });
  }

  function stopForSource(sourceKey) {
    for (const entry of [...relays.values()]) {
      if (entry.sourceKey === sourceKey) stop(sourceKey, entry.destination.id);
    }
  }

  function stopAll() {
    for (const entry of [...relays.values()]) stop(entry.sourceKey, entry.destination.id);
  }

  return {
    start,
    stop,
    stopForSource,
    stopAll,
    has: (s, d) => relays.has(keyOf(s, d)),
    size: () => relays.size,
  };
}

module.exports = { createRelayManager };
