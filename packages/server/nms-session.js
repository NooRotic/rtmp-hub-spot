'use strict';

/**
 * Resolve a uniform { id, ip, path, ... } record from a Node-Media-Server session,
 * robust across NMS major versions. This indirection exists because the event API
 * changed between versions and silently broke stream-path resolution:
 *
 *  - NMS v4 emits the session OBJECT as the event argument, and stores the path on
 *    `session.streamPath` (e.g. '/live/grid').
 *  - NMS v2 emitted an id STRING (looked up in `sessions`) with the path on
 *    `playStreamPath` / `publishStreamPath`.
 *
 * Reading only the v2 names under v4 yielded path = 'Unknown', which mis-keyed the
 * relay fan-out (sourceKey 'Unknown' matched no bindings). We read `streamPath`
 * first and keep the v2 names as fallbacks so the resolver is version-robust.
 *
 * @param {object|string} sessionOrId - the event arg (v4 session object, or v2 id)
 * @param {Map|object} [sessions] - nms.sessions, used to look up a v2 id string
 * @returns {{id:*, ip:string, path:string, startTime?:number, uptime:number, bytes?:number, bitrate:number, protocol?:string}}
 */
function extractSessionData(sessionOrId, sessions) {
  let session = null;

  if (typeof sessionOrId === 'object' && sessionOrId !== null) {
    session = sessionOrId;
  } else if (sessions) {
    // nms.sessions may be a Map or a plain object depending on version.
    session = typeof sessions.get === 'function' ? sessions.get(sessionOrId) : sessions[sessionOrId];
  }

  if (!session) {
    return { id: sessionOrId, ip: 'Unknown', path: 'Unknown', uptime: 0, bitrate: 0 };
  }

  const uptime = Math.floor((Date.now() - (session.startTime || 0)) / 1000);
  const bytesRead = (session.socket && session.socket.bytesRead) || 0;
  const bytesWritten = (session.socket && session.socket.bytesWritten) || 0;

  return {
    id: session.id || sessionOrId,
    ip: session.ip || 'Unknown',
    // NMS v4 -> streamPath; v2 -> play/publishStreamPath (undefined under v4).
    path: session.streamPath || session.playStreamPath || session.publishStreamPath || 'Unknown',
    startTime: session.startTime,
    uptime: uptime > 100000 ? 0 : uptime, // guard against a bogus/zero startTime
    bytes: bytesWritten || bytesRead,
    bitrate: session.bitrate || 0,
    protocol: session.protocol || 'rtmp',
  };
}

module.exports = { extractSessionData };
