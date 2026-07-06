const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');

// ── Persistent logging ───────────────────────────────────────────────────────
// Route all console.* + uncaught errors to a file under {userData}/logs so that
// "broadcast failed" reports are debuggable after the fact. electron-log writes
// to both the terminal and {userData}/logs/main.log.
const log = require('electron-log/main');
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = process.env.RTMP_DEBUG ? 'debug' : 'info';
Object.assign(console, log.functions); // existing console.* calls now also persist to file
process.on('uncaughtException', (e) => { try { log.error('[uncaughtException]', e); } catch (_) { /* noop */ } });
process.on('unhandledRejection', (e) => { try { log.error('[unhandledRejection]', e); } catch (_) { /* noop */ } });

let _lastLoggedIP = null;
let _lastRecProgressAt = 0;

const { isLoopbackHost } = require('./cert-trust');
const { buildFfmpegArgs } = require('./ffmpeg-args');
const { createPipeManager } = require('./pipe-manager');
const { buildRelayArgs } = require('./relay-args');
const { createRelayManager } = require('./relay-manager');
const { createReconnectionSupervisor } = require('./reconnection-supervisor');
const { createBroadcastOrchestrator } = require('./broadcast-orchestrator');
const destinationStore = require('./destinationStore');
const { extractSessionData } = require('./nms-session');
const { createRoomGate } = require('./room-pin');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
const https = require('https');
const selfsigned = require('selfsigned');
const NodeMediaServer = require('node-media-server');
const { Server } = require('socket.io');
const http = require('http');
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
require('dotenv').config();

// ─── Room PIN Gate ────────────────────────────────────────────────────────────
const roomGate = createRoomGate();
/** One-time secret minted at process start. Delivered to the Electron renderer
 *  via IPC (get-host-token). The Admin sends it in join-room so the gate can
 *  trust it without relying on socket address (which a Vite proxy collapses to
 *  127.0.0.1, breaking the old loopback-based exemption). */
const hostToken = crypto.randomBytes(24).toString('hex');
const roomConfigPath = () => path.join(app.getPath('userData'), 'room-config.json');

function loadRoomPin() {
  try {
    const cfg = JSON.parse(fs.readFileSync(roomConfigPath(), 'utf8'));
    if (cfg && typeof cfg.roomPin === 'string') roomGate.setPin(cfg.roomPin);
  } catch (_) { /* no config yet = open hub */ }
}

function saveRoomPin(pin) {
  try { fs.writeFileSync(roomConfigPath(), JSON.stringify({ roomPin: pin || '' }), 'utf8'); }
  catch (e) { console.error('[RoomPin] persist failed:', e); }
}

ffmpeg.setFfmpegPath(ffmpegStatic);

// Env configs
/** @const {number} RTMP_PORT - Port used by Node Media Server for incoming RTMP streams. */
const RTMP_PORT = process.env.RTMP_PORT || 1935;
/** @const {number} NMS_HTTP_PORT - Port used by Node Media Server for serving HTTP-FLV and stats. */
const NMS_HTTP_PORT = process.env.NMS_HTTP_PORT || 8000;
/** @const {number} SIGNALING_PORT - Port used for the HTTPS Express + Socket.io Server */
const SIGNALING_PORT = process.env.PORT || 4001;
/**
 * @const {string} BIND_IP - Bind address for the local servers (HTTPS signaling,
 * NMS, Socket.IO). Defaults to 0.0.0.0 so LAN devices — phones joining as mobile
 * cameras over WiFi — can reach the signaling/media servers. Restrict to loopback
 * with RHS_BIND_LOOPBACK=1, or pin a specific address with BIND_IP.
 *
 * SECURITY: 0.0.0.0 + wildcard CORS + no auth means anyone on the LAN can join.
 * A session/room PIN is required before any public launch (see
 * memory: lan-mobile-camera-networking).
 */
const BIND_IP = process.env.BIND_IP || (process.env.RHS_BIND_LOOPBACK === '1' ? '127.0.0.1' : '0.0.0.0');

/**
 * Broadcast an IPC event to all live BrowserWindow renderer processes.
 * Used to push FFmpeg pipeline state/stats without needing a specific sender reference.
 * @param {string} channel
 * @param {object} data
 */
function broadcastIPC(channel, data) {
  BrowserWindow.getAllWindows().forEach(w => {
    if (!w.webContents.isDestroyed()) {
      w.webContents.send(channel, data);
    }
  });
}

// SSL certificate generation will happen right before server creation

/**
 * Bootstraps the primary Electron Window containing the Admin Dashboard.
 *
 * In development (`app.isPackaged === false`), loads from the Vite dev server on port 4443.
 * In production (`app.isPackaged === true`), loads the compiled React dist bundle directly.
 *
 * @returns {void}
 */
/**
 * Applies a Content-Security-Policy to the renderer via response headers.
 * Production is strict (no eval, no remote script/connect origins beyond
 * localhost); development relaxes script-src for Vite HMR. Both allow the
 * inline polyfill in index.html (simple-peer needs window.global/process) and
 * inline styles (the app uses style={{…}} extensively).
 * @returns {void}
 */
function applyContentSecurityPolicy() {
  const common =
    "default-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "media-src 'self' blob:; " +
    "font-src 'self' data:; " +
    // http://127.0.0.1:* + http://localhost:* allow the in-app mpegts preview to
    // fetch the local NMS HTTP-FLV egress (port 8000, plain http). Scoped to LOOPBACK
    // only — never the LAN IP or a wildcard host — so it stays unreachable off-box.
    "connect-src 'self' https://localhost:* wss://localhost:* ws://localhost:* " +
    "http://127.0.0.1:* http://localhost:*;";
  const scriptSrc = app.isPackaged
    ? "script-src 'self' 'unsafe-inline'; "                  // prod: inline polyfill ok, no eval
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'; ";   // dev: Vite HMR needs eval
  const csp = scriptSrc + common;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

/**
 * Trusts self-signed certificates for loopback hosts (the HTTPS signaling server
 * and the Vite dev server). Uses the session verify proc rather than
 * app.on('certificate-error') because the proc reliably covers EVERY request —
 * including the renderer's wss:// Socket.IO connection, which the event misses.
 * @returns {void}
 */
function trustLoopbackCertificates() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    // 0 = trust; -3 = defer to Chromium's default verification (rejects bad certs)
    callback(isLoopbackHost(request.hostname) ? 0 : -3);
  });
}

function createWindow() {
  applyContentSecurityPolicy();
  trustLoopbackCertificates();
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
    frame: false, // Custom WinNT frame
  });

  if (app.isPackaged) {
    // Production: load the compiled client bundle served by the Express HTTPS server.
    // The signaling server starts on SIGNALING_PORT and serves ../client/dist.
    win.loadURL(`https://localhost:${SIGNALING_PORT}`);
  } else {
    // Development: load from the Vite dev server (started separately by `npm run dev`).
    win.loadURL('https://localhost:4443');
  }

  app.on('gpu-process-crashed', (event, killed) => {
    console.warn('[ELECTRON] GPU Process Crashed. Killed:', killed);
  });
}

// Cert trust is handled by session.setCertificateVerifyProc in createWindow()
// (see trustLoopbackCertificates) — it covers ALL requests, including the
// renderer's wss:// Socket.IO connection, which app.on('certificate-error') does
// not reliably handle. This replaced the app-wide ignore-certificate-errors switch.

const nmsConfig = {
  bind: BIND_IP, // Set the bind IP for the entire server
  rtmp: {
    port: RTMP_PORT,
    host: BIND_IP,
    chunk_size: 4096, // Reduced from 60000 for lower latency
    gop_cache: true,  // Cache last GOP so late-joining clients get a keyframe immediately
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: NMS_HTTP_PORT,
    host: BIND_IP,
    allow_origin: '*'
  },
  basePath: './media' // Ensure a base path exists
};

// Main entry point to handle async operations
async function initializeServer() {
  const nms = new NodeMediaServer(nmsConfig);
  nms.run();

  console.log('[SSL] Generating self-signed certificates...');
  const sslAttrs = [{ name: 'commonName', value: 'rtmp-hub-spot.local' }];
  let sslPems;
  try {
    sslPems = await selfsigned.generate(sslAttrs, { days: 365 });
    console.log('[SSL] Certificates object keys:', Object.keys(sslPems));
    if (!sslPems.private) throw new Error('sslPems.private is missing');
    if (!sslPems.cert) throw new Error('sslPems.cert is missing');
    console.log('[SSL] Certificates generated correctly. Key length:', sslPems.private.length);
  } catch (sslErr) {
    console.error('[SSL] Critical error during certificate generation:', sslErr);
    throw sslErr;
  }

  // Signaling & Web Server
  const expressApp = express();
  const server = https.createServer({
    key: sslPems.private,
    cert: sslPems.cert
  }, expressApp);
  console.log(`[SSL] HTTPS server created on ${SIGNALING_PORT}`);

  // Serve the React client production build
  const clientPath = path.join(__dirname, '../client/dist');
  expressApp.use(express.static(clientPath));

  // Serve JSDocs documentation route
  const docsPath = path.join(__dirname, '../../jsDocs');
  expressApp.use('/jsDocs', express.static(docsPath));

  // API Routes
  expressApp.get('/api/status', (req, res) => {
    // This route will be implemented later to provide server status
    res.json({ message: 'API status endpoint' });
  });

  // Redirect all other requests to the React app
  expressApp.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });

  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ["GET", "POST"]
    },
    transports: ['websocket'] // Force websocket to bypass polling SSL handshake issues in some browsers
  });

  return { nms, server, io };
}

// Active RTMP publishers (streamKey -> { ip, path, startTime }). Declared at module
// scope so both the NMS publish handlers (inside initializeServer) and isSourceLive
// (used by the relay orchestrator below) share one source of truth.
const rtmpPublishers = new Map();

console.log('[SERVER] Starting initialization...');
initializeServer().then(({ nms, server, io }) => {
  console.log('[SERVER] Initialization successful, attaching listeners...');
  loadRoomPin();
  const rtmpSessions = new Map();   // id -> { ip, path, startTime }  — RTMP players

  // Resolve session data via the version-robust, unit-tested helper (nms-session.js).
  // NMS v4 emits the session object with the path on `streamPath`; reading the old
  // v2 names yielded 'Unknown' and mis-keyed the relay fan-out. See nms-session.test.js.
  const getSessionData = (sessionOrId) => extractSessionData(sessionOrId, nms.sessions);

  nms.on('postPlay', (id, StreamPath, args) => {
    const data = getSessionData(id);
    const sId = data.id;
    const sPath = StreamPath || data.path;
    console.log(`[RTMP] New Player: ${sId} path=${sPath} ip=${data.ip}`);
    rtmpSessions.set(sId, {
      id: sId,
      path: sPath,
      ip: data.ip,
      startTime: Date.now()
    });
    broadcastStatus();
  });

  nms.on('donePlay', (id) => {
    const data = getSessionData(id);
    const sId = data.id;
    console.log(`[RTMP] Player Disconnected: ${sId}`);
    rtmpSessions.delete(sId);
    broadcastStatus();
  });

  // Track which streams are actively being published (so UI knows what to record)
  nms.on('postPublish', (id, StreamPath) => {
    const data = getSessionData(id);
    const safePath = StreamPath || data.path || '';
    const streamKey = safePath.split('/').pop() || safePath;
    console.log(`[RTMP] Publisher connected: ${streamKey} from ${data.ip}`);
    rtmpPublishers.set(streamKey, { ip: data.ip, path: safePath, startTime: Date.now() });
    try {
      broadcastOrchestrator.onSourcePublished(streamKey);
    } catch (err) {
      console.error('[RELAY] onSourcePublished failed for', streamKey, (err && err.message) || err);
    }
    broadcastStatus();
  });

  nms.on('donePublish', (id, StreamPath) => {
    const data = getSessionData(id);
    const safePath = StreamPath || data.path || '';
    const streamKey = safePath.split('/').pop() || safePath;
    console.log(`[RTMP] Publisher disconnected: ${streamKey}`);
    rtmpPublishers.delete(streamKey);
    try {
      broadcastOrchestrator.onSourceUnpublished(streamKey);
    } catch (err) {
      console.error('[RELAY] onSourceUnpublished failed for', streamKey, (err && err.message) || err);
    }
    // Also stop any active recording for this stream
    const rec = recordingSessions.get(streamKey);
    if (rec) {
      try { rec.process.kill('SIGINT'); } catch(e) {}
      recordingSessions.delete(streamKey);
      io.emit('recording-stopped', { streamKey, reason: 'publisher-disconnected' });
    }
    broadcastStatus();
  });

  // Signaling & Web Server Setup
  const users = {}; // socket.id -> { name, roomId }

  /**
   * Broadcasts the current server status and RTMP session statistics
   * securely via WebSockets to all connected Hub clients.
   * 
   * @returns {void}
   */
  async function broadcastStatus(roomId = 'main') {
    try {
      const networkInterfaces = os.networkInterfaces();
      let localIP = '127.0.0.1';
      // Priority list for interface names to prefer (e.g., Ethernet, Wi-Fi)
      const preferredInterfaces = ['Ethernet', 'Wi-Fi', 'en0', 'wlan0'];
      
      for (const name in networkInterfaces) {
        for (const iface of networkInterfaces[name]) {
          // Skip internal (loopback) and non-IPv4 addresses
          if (iface.family === 'IPv4' && !iface.internal) {
            // If we find a preferred interface, use it and stop
            if (preferredInterfaces.some(pref => name.includes(pref))) {
              localIP = iface.address;
              break;
            }
            // Otherwise, keep the first external one we found
            if (localIP === '127.0.0.1') {
              localIP = iface.address;
            }
          }
        }
        if (localIP !== '127.0.0.1' && preferredInterfaces.some(pref => name.includes(pref))) break;
      }
      if (localIP !== _lastLoggedIP) {
        console.log('[STATUS] Discovered Local IP:', localIP);
        _lastLoggedIP = localIP;
      }

      const sessions = Array.from(rtmpSessions.keys()).map(id => getSessionData(id));
      const publishers = Array.from(rtmpPublishers.entries()).map(([key, data]) => ({
        streamKey: key,
        ip: data.ip,
        path: data.path,
        uptime: Math.floor((Date.now() - data.startTime) / 1000)
      }));

      const status = {
        local: localIP,
        public: 'Discovery Active',
        clientCount: Object.keys(users).length,
        rtmpCount: rtmpSessions.size,
        rtmpSessions: sessions,
        rtmpPublishers: publishers
      };
      
      io.emit('server-status', status);
    } catch (err) {
      console.error('[STATUS] Broadcast failed:', err);
    }
  }

  io.on('connection', (socket) => {
    console.log('[Signaling] New socket connection:', socket.id);
    
    socket.on('join-room', ({ roomId, userName, pin, hostToken: clientHostToken }) => {
      const trusted = !!(clientHostToken && clientHostToken === hostToken);
      const verdict = roomGate.check(socket.handshake.address, pin, { trusted });
      if (!verdict.allowed) {
        socket.emit('join-denied', { reason: verdict.reason });
        if (verdict.lockout) socket.disconnect(true);
        console.log(`[Signaling] join denied (${verdict.reason}) for ${socket.handshake.address}`);
        return;
      }
      socket.join(roomId);
      users[socket.id] = { name: userName || `User ${socket.id.slice(0, 4)}`, roomId, isHost: trusted };
      
      const otherUsers = Object.keys(users).filter(id => id !== socket.id && users[id].roomId === roomId);
      socket.emit('all-users', otherUsers.map(id => ({ userId: id, userName: users[id].name })));
      
      socket.to(roomId).emit('user-joined', { userId: socket.id, userName: users[socket.id].name });
      
      console.log(`[Signaling] ${users[socket.id].name} joined ${roomId}. Total in room: ${otherUsers.length + 1}`);
      broadcastStatus(roomId);
    });

    socket.on('offer', (data) => {
      if (!users[socket.id]) return; // only joined members may signal
      socket.to(data.to).emit('offer', {
        offer: data.offer,
        senderId: socket.id,
        senderName: users[socket.id]?.name || 'Unknown'
      });
    });

    socket.on('answer', (data) => {
      if (!users[socket.id]) return; // only joined members may signal
      socket.to(data.to).emit('answer', {
        answer: data.answer,
        senderId: socket.id
      });
    });

    socket.on('ice-candidate', (data) => {
      if (!users[socket.id]) return; // only joined members may signal
      socket.to(data.to).emit('ice-candidate', {
        candidate: data.candidate,
        senderId: socket.id
      });
    });

    socket.on('renegotiate', (data) => {
      if (!users[socket.id]) return; // only joined members may signal
      socket.to(data.to).emit('renegotiate', {
        data: data.data,
        senderId: socket.id
      });
    });

    socket.on('chat-message', (data) => {
      if (!users[socket.id]) return; // only joined members may chat
      const { message } = data;
      const roomId = users[socket.id].roomId; // authoritative — never trust client-supplied roomId
      const senderName = users[socket.id]?.name || 'Unknown';
      io.to(roomId).emit('chat-message', {
        senderId: socket.id,
        senderName,
        message,
        timestamp: Date.now()
      });
    });

    socket.on('kick-user', ({ targetId }) => {
      if (!users[socket.id]?.isHost) return; // host-only (the Electron host, token-trusted)
      const targetSocket = io.sockets.sockets.get(targetId);
      if (targetSocket) {
        console.log(`[Signaling] Kicking user: ${users[targetId]?.name || targetId}`);
        targetSocket.emit('kicked', { reason: 'Removed by admin' });
        targetSocket.disconnect(true);
      }
    });

    socket.on('disconnect', () => {
      if (users[socket.id]) {
        const { name, roomId } = users[socket.id];
        socket.to(roomId).emit('user-disconnected', socket.id);
        delete users[socket.id];
        broadcastStatus(roomId);
      }
    });
  });

  // Periodic status broadcast
  const statusInterval = setInterval(() => {
    broadcastStatus();
  }, 5000);

  ipcMain.on('telemetry-refresh', () => {
    broadcastStatus();
  });

  ipcMain.on('set-room-pin', (event, { pin } = {}) => {
    const next = (pin || '').trim();
    roomGate.setPin(next);
    saveRoomPin(next);
    console.log(`[RoomPin] ${next ? 'locked' : 'open'}`);
  });

  ipcMain.handle('get-room-pin', () => ({ locked: roomGate.isLocked() }));

  ipcMain.handle('get-host-token', () => hostToken);

  server.listen(SIGNALING_PORT, BIND_IP, () => {
    console.log(`Signaling server listening on HTTPS ${BIND_IP}:${SIGNALING_PORT}`);
  });

  // Cleanup on app quit
  app.on('before-quit', () => {
    pipeManager.stopAll(); // kill any running FFmpeg pipes so no ffmpeg.exe orphans on quit
    relayManager.stopAll(); // stop all relay fan-out processes
    clearInterval(statusInterval);
    if (server) server.close();
    // node-media-server v4 removed stop(); calling it threw
    // "TypeError: nms.stop is not a function", aborting teardown and orphaning
    // RTMP port 1935. Guard for whichever teardown method this NMS version exposes.
    try {
      if (nms && typeof nms.stop === 'function') {
        nms.stop();
      } else if (nms && typeof nms.close === 'function') {
        nms.close(); // v4 exposes close() to release the RTMP/HTTP listeners
      }
    } catch (e) {
      log.error('[NMS] teardown on before-quit failed:', (e && e.message) || e);
    }
  });
}).catch(err => {
  log.error('[CRITICAL] Server Initialization Failed:', err);
  try {
    dialog.showErrorBox(
      'RTMP Hub Spot — startup failed',
      `The media server could not start:\n\n${(err && err.message) ? err.message : String(err)}\n\n` +
      `A required port may already be in use (RTMP 1935, signaling 4001, or NMS HTTP 8000). ` +
      `Close other streaming apps (OBS/XSplit) or another running copy of this app, then relaunch.\n\n` +
      `Full details were written to the application log file.`
    );
  } catch (_) { /* dialog may be unavailable before app is ready */ }
  app.quit();
});

const { PassThrough } = require('stream');

/**
 * Thin fluent-ffmpeg glue: builds and runs the FFmpeg command for one pipe and
 * returns the running command (exposes .kill()). Kept out of pipe-manager.js so
 * that module stays free of process spawning and unit-testable; this glue is
 * covered by the live smoke test.
 * @returns {object}
 */
function spawnPipe(videoStream, args, { onStart, onStderr, onError }) {
  let cmd = ffmpeg(videoStream)
    .inputFormat('matroska') // WebM is a subset of Matroska
    .inputOptions(args.inputOptions);

  // For canvas-sourced (grid) streams, add an infinite silent audio source as input 1.
  if (args.needsSilentAudio) {
    cmd = cmd.input(args.silentAudioInput).inputFormat('lavfi');
  }

  return cmd
    .outputOptions(args.outputOptions)
    .output(args.outputUrl)
    .on('start', onStart)
    .on('stderr', onStderr)
    .on('error', onError)
    .run();
}

// Multi-pipe engine (audit #1): one FFmpeg process per streamKey so the grid and
// per-feed streams publish concurrently. Lifecycle/routing/restart logic lives in
// pipe-manager.js (unit-tested); only the spawn glue above touches fluent-ffmpeg.
const pipeManager = createPipeManager({
  spawnPipe,
  PassThrough,
  buildFfmpegArgs,
  broadcastIPC,
  rtmpPort: RTMP_PORT,
  log, // share the electron-log/main sink so ffmpeg failures persist to main.log
});

/**
 * Thin fluent-ffmpeg glue for a copy relay: pull from local NMS, copy to the
 * platform. Kept out of relay-manager.js so that module stays process-free and
 * unit-testable; this glue is covered by the live smoke test.
 * @returns {object} the running fluent-ffmpeg command (exposes .kill()).
 */
function spawnRelay(args, { onStart, onStderr, onError }) {
  return ffmpeg(args.inputUrl)
    .inputOptions(args.inputOptions)
    .outputOptions(args.outputOptions)
    .output(args.outputUrl)
    .on('start', onStart)
    .on('stderr', onStderr)
    .on('error', onError)
    .run();
}

// Relay fan-out (Multi-Stream Pro): one copy-relay per destination, scheduled
// through a single supervisor so reconnects after a network drop are staggered.
let reconnectionSupervisor; // forward-declared: the relay-manager arrow callbacks close over this binding and only read it at runtime (after it is assigned below).
const relayManager = createRelayManager({
  spawnRelay,
  buildRelayArgs,
  broadcastIPC,
  rtmpPort: RTMP_PORT,
  onLive: (sourceKey, destinationId) => reconnectionSupervisor.notifyLive(sourceKey, destinationId),
  onTransientFailure: (item) => reconnectionSupervisor.enqueue(item),
});
reconnectionSupervisor = createReconnectionSupervisor({
  startRelay: (item) => relayManager.start(item.sourceKey, item.destination),
});
// A source is "live" iff NMS currently has a publisher on its streamKey. Reuse the
// same map server-status is derived from — single source of truth (spec R3).
const isSourceLive = (streamKey) => rtmpPublishers.has(streamKey);

const broadcastOrchestrator = createBroadcastOrchestrator({
  supervisor: reconnectionSupervisor,
  relayManager,
  listBindings: () => destinationStore.loadBindings(),
  listDestinations: () => destinationStore.loadDestinations(),
  isSourceLive,
});

ipcMain.on('ffmpeg-pipe-start', (event, config = {}) => {
  // streamKey identifies the pipe; other fields default inside buildFfmpegArgs.
  pipeManager.start({ streamKey: 'grid', ...config }, { sender: event.sender });
});

ipcMain.on('ffmpeg-pipe-chunk', (event, { chunk, streamKey } = {}) => {
  pipeManager.writeChunk(streamKey, chunk);
});

// Backward-compatible stop: a streamKey stops that one pipe; no key stops all.
// (The current renderer sends no key; the redesigned UI will send a streamKey.)
ipcMain.on('ffmpeg-pipe-stop', (event, data = {}) => {
  if (data && data.streamKey) {
    pipeManager.stop(data.streamKey);
  } else {
    pipeManager.stopAll();
  }
});


// ─── Recording Feature ────────────────────────────────────────────────────────

/** Active recording sessions: streamKey → { process, outputPath, startTime } */
const recordingSessions = new Map();

/** Default recordings output folder */
const getRecordingsDir = () => path.join(app.getPath('videos'), 'RTMP-Hub-Recordings');

/**
 * IPC: Start recording a live RTMP stream to disk.
 * Spawns an ffmpeg process that pulls from the local RTMP server and writes
 * an MP4 file using stream copy (zero re-encode, minimal CPU).
 *
 * @param {string} streamKey - The RTMP stream key to record (e.g. 'grid', 'feed-john').
 * @returns {{ success: boolean, path?: string, error?: string }}
 */
ipcMain.handle('start-recording', async (event, { streamKey }) => {
  if (recordingSessions.has(streamKey)) {
    return { success: false, error: `Already recording: ${streamKey}` };
  }

  const recordingsDir = getRecordingsDir();
  if (!fs.existsSync(recordingsDir)) {
    fs.mkdirSync(recordingsDir, { recursive: true });
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputPath = path.join(recordingsDir, `${streamKey}-${ts}.mp4`);

  console.log(`[REC] Starting recording: ${streamKey} → ${outputPath}`);

  const recProcess = ffmpeg(`rtmp://localhost:${RTMP_PORT}/live/${streamKey}`)
    .inputOptions(['-rtmp_live live'])
    .outputOptions([
      '-c copy',                           // Zero re-encode — just remux
      '-f mp4',
      '-movflags frag_keyframe+empty_moov+delay_moov' // Fragmented MP4: safe if killed mid-stream
    ])
    .output(outputPath)
    .on('start', (cmd) => console.log('[REC] Started:', cmd.slice(0, 100) + '...'))
    .on('stderr', (line) => {
      if (line.includes('time=') || line.includes('speed=')) {
        const now = Date.now();
        if (now - _lastRecProgressAt >= 1000) {
          _lastRecProgressAt = now;
          process.stdout.write(`\r[REC:${streamKey}] ${line.trim()}`);
        }
      }
    })
    .on('error', (err) => {
      // SIGINT on stop is expected — don't treat it as a crash
      if (!err.message.includes('SIGINT') && !err.message.includes('killed')) {
        console.error(`\n[REC] Error for ${streamKey}:`, err.message);
      } else {
        console.log(`\n[REC] Recording finalized: ${streamKey}`);
      }
      recordingSessions.delete(streamKey);
    })
    .on('end', () => {
      console.log(`\n[REC] Recording completed: ${streamKey}`);
      recordingSessions.delete(streamKey);
    })
    .run();

  recordingSessions.set(streamKey, { process: recProcess, outputPath, startTime: Date.now() });
  return { success: true, path: outputPath, streamKey };
});

/**
 * IPC: Stop an active recording cleanly.
 * Sends SIGINT so ffmpeg can finalize the MP4 moov atom.
 */
ipcMain.on('stop-recording', (event, { streamKey }) => {
  const rec = recordingSessions.get(streamKey);
  if (rec) {
    console.log(`[REC] Stopping recording: ${streamKey}`);
    try {
      rec.process.kill('SIGINT');
    } catch (e) {
      // Process may have already ended
    }
    recordingSessions.delete(streamKey);
  }
});

/** IPC: Open the recordings output folder in the system file manager. */
ipcMain.on('open-recordings-dir', () => {
  const dir = getRecordingsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

/** IPC: Query current recording status for all active sessions. */
ipcMain.handle('get-recordings-status', () => {
  return Array.from(recordingSessions.entries()).map(([key, rec]) => ({
    streamKey: key,
    outputPath: rec.outputPath,
    startTime: rec.startTime,
    elapsed: Math.floor((Date.now() - rec.startTime) / 1000)
  }));
});


// ─── GPU / Encoder Detection ───────────────────────────────────────────────


/**
 * Maps of H.264 hardware encoders we care about, in preference order.
 * key = hwAccel token sent to ffmpeg-pipe-start
 * value = encoder name as reported by `ffmpeg -encoders`
 */
const HW_ENCODERS = [
  { key: 'amd',    codec: 'h264_amf',   label: 'AMD AMF (GPU)' },
  { key: 'nvidia', codec: 'h264_nvenc', label: 'NVIDIA NVENC (GPU)' },
  { key: 'intel',  codec: 'h264_qsv',  label: 'Intel QSV (GPU)' },
];

const { execFile } = require('child_process');

let _encoderCachePromise = null;

/**
 * Verify an encoder actually initializes on THIS machine's GPU/runtime.
 * `ffmpeg.getAvailableEncoders()` only reports what is COMPILED INTO the binary —
 * the ffmpeg-static build ships h264_amf/h264_nvenc/h264_qsv regardless of the
 * installed GPU — so a "available" encoder can still fail at runtime (classic case:
 * h264_amf on a non-AMD box → "amfrt64.dll failed to open", which then crashes
 * every broadcast pipe). Force a 1-frame encode to /dev/null and check the exit code.
 * @param {string} codec
 * @returns {Promise<boolean>}
 */
function canInitEncoder(codec) {
  return new Promise((resolve) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=1',
      '-frames:v', '1', '-pix_fmt', 'yuv420p',
      '-c:v', codec, '-f', 'null', '-',
    ];
    execFile(ffmpegStatic, args, { timeout: 8000, windowsHide: true }, (err) => resolve(!err));
  });
}

/**
 * Probes ffmpeg for USABLE H.264 encoders once, caches result. A candidate must be
 * both compiled in AND able to initialize at runtime (see canInitEncoder), so the
 * renderer can no longer auto-select a dead GPU encoder.
 * @returns {Promise<{available: string[], best: string, bestLabel: string}>}
 */
function probeEncoders() {
  if (_encoderCachePromise) return _encoderCachePromise;

  _encoderCachePromise = new Promise((resolve) => {
    ffmpeg.getAvailableEncoders(async (err, encoders) => {
      if (err) {
        console.error('[GPU] ffmpeg encoder probe failed:', err.message);
        return resolve({ available: [], best: 'none', bestLabel: 'Software x264 (fallback)' });
      }

      // Compile-time candidates, then runtime-verify each (sequentially — parallel
      // encoder inits contend for the GPU and can spuriously fail).
      const compiled = HW_ENCODERS.filter(e => encoders[e.codec]);
      const available = [];
      for (const e of compiled) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await canInitEncoder(e.codec);
        if (ok) available.push(e.key);
        else console.log(`[GPU] ${e.codec} is compiled in but failed runtime init — excluding`);
      }
      console.log('[GPU] Usable HW encoders:', available.length ? available : ['none (software only)']);

      // Pick highest-preference encoder that actually works.
      let best = 'none';
      let bestLabel = 'Software x264';
      for (const e of HW_ENCODERS) {
        if (available.includes(e.key)) {
          best = e.key;
          bestLabel = e.label;
          break;
        }
      }

      console.log(`[GPU] Selected encoder: ${best} (${bestLabel})`);
      resolve({ available, best, bestLabel });
    });
  });

  return _encoderCachePromise;
}

/**
 * IPC: Renderer asks for the recommended encoder to use by default.
 * Returns { best: 'amd'|'nvidia'|'intel'|'none', bestLabel: string, available: string[] }
 */
ipcMain.handle('detect-gpu-encoder', async () => {
  return probeEncoders();
});

// Window control IPCs
ipcMain.on('window-minimize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.on('window-close', () => {
  app.quit();
});

// RTMP destination CRUD (Multi-Stream Pro) — encrypted via safeStorage
const { registerDestinationHandlers } = require('./destinationHandlers');
registerDestinationHandlers(ipcMain, {
  store: destinationStore,
  orchestrator: broadcastOrchestrator,
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
