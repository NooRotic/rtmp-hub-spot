const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

ffmpeg.setFfmpegPath(ffmpegStatic);

// Env configs
/** @const {number} RTMP_PORT - Port used by Node Media Server for incoming RTMP streams. */
const RTMP_PORT = process.env.RTMP_PORT || 1935;
/** @const {number} NMS_HTTP_PORT - Port used by Node Media Server for serving HTTP-FLV and stats. */
const NMS_HTTP_PORT = process.env.NMS_HTTP_PORT || 8000;
/** @const {number} SIGNALING_PORT - Port used for the HTTPS Express + Socket.io Server */
const SIGNALING_PORT = process.env.PORT || 4001;
/** @const {string} BIND_IP - The bind IP for the local servers. Defaults to 0.0.0.0 for LAN exposure. */
const BIND_IP = process.env.BIND_IP || '0.0.0.0';

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
function createWindow() {
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

// Allow self-signed certs in development
app.commandLine.appendSwitch('ignore-certificate-errors');

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

console.log('[SERVER] Starting initialization...');
initializeServer().then(({ nms, server, io }) => {
  console.log('[SERVER] Initialization successful, attaching listeners...');
  const rtmpSessions = new Map();   // id -> { ip, path, startTime }  — RTMP players
  const rtmpPublishers = new Map(); // streamKey -> { ip, path, startTime } — active publishers

  // Helper to extract session data safely
  const getSessionData = (sessionOrId) => {
    let session = null;
    
    if (typeof sessionOrId === 'object' && sessionOrId !== null) {
      session = sessionOrId;
    } else if (nms.sessions) {
      // nms.sessions can be a Map or an Object depending on version
      if (typeof nms.sessions.get === 'function') {
        session = nms.sessions.get(sessionOrId);
      } else {
        session = nms.sessions[sessionOrId];
      }
    }

    if (session) {
      const uptime = Math.floor((Date.now() - (session.startTime || 0)) / 1000);
      const bytesRead = session.socket?.bytesRead || 0;
      const bytesWritten = session.socket?.bytesWritten || 0;
      
      return {
        id: session.id || sessionOrId,
        ip: session.ip || 'Unknown',
        path: session.playStreamPath || session.publishStreamPath || 'Unknown',
        startTime: session.startTime,
        uptime: uptime > 100000 ? 0 : uptime, // Sanity check for start time
        bytes: bytesWritten || bytesRead,
        bitrate: session.bitrate || 0,
        protocol: session.protocol || 'rtmp'
      };
    }

    return { id: sessionOrId, ip: 'Unknown', path: 'Unknown', uptime: 0, bitrate: 0 };
  };

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
    broadcastStatus();
  });

  nms.on('donePublish', (id, StreamPath) => {
    const data = getSessionData(id);
    const safePath = StreamPath || data.path || '';
    const streamKey = safePath.split('/').pop() || safePath;
    console.log(`[RTMP] Publisher disconnected: ${streamKey}`);
    rtmpPublishers.delete(streamKey);
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
      console.log('[STATUS] Discovered Local IP:', localIP);

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
    
    socket.on('join-room', ({ roomId, userName }) => {
      socket.join(roomId);
      users[socket.id] = { name: userName || `User ${socket.id.slice(0, 4)}`, roomId };
      
      const otherUsers = Object.keys(users).filter(id => id !== socket.id && users[id].roomId === roomId);
      socket.emit('all-users', otherUsers.map(id => ({ userId: id, userName: users[id].name })));
      
      socket.to(roomId).emit('user-joined', { userId: socket.id, userName: users[socket.id].name });
      
      console.log(`[Signaling] ${users[socket.id].name} joined ${roomId}. Total in room: ${otherUsers.length + 1}`);
      broadcastStatus(roomId);
    });

    socket.on('offer', (data) => {
      socket.to(data.to).emit('offer', {
        offer: data.offer,
        senderId: socket.id,
        senderName: users[socket.id]?.name || 'Unknown'
      });
    });

    socket.on('answer', (data) => {
      socket.to(data.to).emit('answer', {
        answer: data.answer,
        senderId: socket.id
      });
    });

    socket.on('ice-candidate', (data) => {
      socket.to(data.to).emit('ice-candidate', {
        candidate: data.candidate,
        senderId: socket.id
      });
    });

    socket.on('chat-message', (data) => {
      const { roomId, message } = data;
      const senderName = users[socket.id]?.name || 'Unknown';
      io.to(roomId).emit('chat-message', {
        senderId: socket.id,
        senderName,
        message,
        timestamp: Date.now()
      });
    });

    socket.on('kick-user', ({ targetId }) => {
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

  server.listen(SIGNALING_PORT, BIND_IP, () => {
    console.log(`Signaling server listening on HTTPS ${BIND_IP}:${SIGNALING_PORT}`);
  });

  // Cleanup on app quit
  app.on('before-quit', () => {
    clearInterval(statusInterval);
    if (server) server.close();
    if (nms) nms.stop();
  });
}).catch(err => {
  console.error('[CRITICAL] Server Initialization Failed:', err);
});

const { PassThrough } = require('stream');
let pipeFfmpeg = null;
let videoStream = null;
let activeStreamKey = null;

// Auto-restart state: stores the last pipe config so we can restart after a crash
let lastPipeConfig = null;
let pipeRestartCount = 0;
const MAX_PIPE_RESTARTS = 3; // Give up after 3 consecutive unexpected crashes
let pipeRestartTimeout = null;

/**
 * Restart the FFmpeg pipe using the last known config after an unexpected crash.
 * Respects MAX_PIPE_RESTARTS to avoid infinite restart loops.
 * @param {object} event - The ipcMain event from the original pipe-start call.
 */
function schedulePipeRestart(event) {
  if (!lastPipeConfig || pipeRestartCount >= MAX_PIPE_RESTARTS) {
    console.error(`[FFMPEG] Auto-restart limit reached (${MAX_PIPE_RESTARTS}). Manual restart required.`);
    broadcastIPC('ffmpeg-status', {
      state: 'error',
      streamKey: lastPipeConfig?.streamKey || null,
      message: `Crashed ${MAX_PIPE_RESTARTS} times — manual restart required.`
    });
    return;
  }

  pipeRestartCount++;
  const delay = pipeRestartCount * 2000; // 2 s, 4 s, 6 s backoff
  console.warn(`[FFMPEG] Scheduling auto-restart #${pipeRestartCount} in ${delay}ms...`);
  broadcastIPC('ffmpeg-status', {
    state: 'starting',
    streamKey: lastPipeConfig.streamKey,
    message: `Restarting (attempt ${pipeRestartCount}/${MAX_PIPE_RESTARTS})…`
  });

  pipeRestartTimeout = setTimeout(() => {
    if (!lastPipeConfig) return; // User may have stopped the pipe in the meantime
    console.log('[FFMPEG] Auto-restarting pipe with last config:', lastPipeConfig);
    // Re-emit the pipe-start IPC as if the renderer sent it again
    ipcMain.emit('ffmpeg-pipe-start', event, lastPipeConfig);
  }, delay);
}

/**
 * Starts an FFmpeg pipeline that ingests raw WebM frames via standard input (IPC),
 * transcodes them using the chosen hardware encoder preset, and outputs a broadcast-ready
 * FLV stream towards the designated local RTMP ingestion endpoint.
 *
 * @param {string} targetBitrate - Video bitrate string (e.g. '4000k').
 * @param {string} preset - FFmpeg encoder preset (e.g. 'ultrafast', 'fast').
 * @param {string} hwAccel - GPU acceleration selection ('none', 'nvenc', 'amf', 'qsv').
 * @param {number} fps - Framerate constraints for the transcoder (default 30).
 * @param {string} streamKey - Which RTMP bucket this should stream into.
 * @returns {void}
 */
ipcMain.on('ffmpeg-pipe-start', (event, { hwAccel = 'none', streamKey = 'grid', bitrate: targetBitrate = '2500k', preset = 'ultrafast', fps = 30 }) => {
  if (pipeFfmpeg) {
    pipeFfmpeg.kill();
    videoStream = null;
    activeStreamKey = null;
  }

  // Cancel any pending auto-restart timer (user may be manually restarting)
  if (pipeRestartTimeout) {
    clearTimeout(pipeRestartTimeout);
    pipeRestartTimeout = null;
  }

  // Save config for auto-restart and reset the crash counter for a fresh start
  lastPipeConfig = { hwAccel, streamKey, bitrate: targetBitrate, preset, fps };
  pipeRestartCount = 0;

  const bitrate = targetBitrate;
  activeStreamKey = streamKey;
  let accelFlags = [];

  if (hwAccel === 'nvidia') {
    accelFlags = ['-hwaccel nvdec'];
  }

  videoStream = new PassThrough();

  // Build encoder-specific video output options
  // preset/tune are libx264-only; hardware encoders use different quality flags
  let encoderOptions;
  if (hwAccel === 'nvidia') {
    encoderOptions = [
      `-vcodec h264_nvenc`,
      `-b:v ${bitrate}`,
      '-preset:v p1',           // p1 = fastest NVENC preset
      '-tune:v ll',             // ll = low-latency
    ];
  } else if (hwAccel === 'amd') {
    encoderOptions = [
      `-vcodec h264_amf`,
      `-b:v ${bitrate}`,
      '-quality speed',         // AMF quality: speed | balanced | quality
      '-rc cbr',                // Constant bitrate for streaming
    ];
  } else if (hwAccel === 'intel') {
    encoderOptions = [
      `-vcodec h264_qsv`,
      `-b:v ${bitrate}`,
      '-preset:v veryfast',     // QSV preset
    ];
  } else {
    // Software libx264
    encoderOptions = [
      `-vcodec libx264`,
      `-b:v ${bitrate}`,
      `-preset ${preset}`,      // User-defined x264 preset
      '-tune zerolatency',
    ];
  }

  // Audio strategy:
  //  - 'feed-*' keys come from a peer's MediaRecorder (WebM with real Opus audio tracks).
  //    Remove -an, encode the audio track to AAC.
  //  - 'grid' and other keys come from canvas.captureStream() which has NO audio.
  //    Inject a silent lavfi source mapped to the output so RTMP clients (OBS, VLC)
  //    don't reject the stream for a missing audio codec header.
  const hasFeedAudio = streamKey.startsWith('feed-');
  const audioOutputOptions = hasFeedAudio
    ? ['-c:a aac', '-b:a 128k', '-ar 44100']
    : ['-map 0:v:0', '-map 1:a:0', '-c:a aac', '-b:a 32k', '-ac 2', '-ar 44100'];

  let cmd = ffmpeg(videoStream)
    .inputFormat('matroska') // WebM is a subset of Matroska
    .inputOptions([
      // Give FFmpeg enough room to probe for the initial keyframe/header cluster.
      // Too-small values (probesize 32) cause VP8 "Discarding interframe" errors.
      '-probesize 5000000',     // 5 MB probe budget — keeps VP8 header parsing reliable
      '-analyzeduration 500000', // 0.5 s ceiling (down from 1 s); probesize is the real guard
      '-fflags nobuffer+igndts+genpts',
      '-flags low_delay',
      '-err_detect ignore_err',   // Tolerate minor stream errors without crashing
      ...accelFlags
    ]);

  // For canvas-sourced streams, add an infinite silent audio source as input 1.
  if (!hasFeedAudio) {
    cmd = cmd
      .input('aevalsrc=0:channel_layout=stereo:sample_rate=44100')
      .inputFormat('lavfi');
  }

  broadcastIPC('ffmpeg-status', { state: 'starting', streamKey });

  pipeFfmpeg = cmd
    .outputOptions([
      '-f flv',
      ...encoderOptions,
      '-pix_fmt yuv420p',
      '-g 30',
      `-r ${fps}`,              // User-defined framerate
      '-flush_packets 1',       // Flush every encoded packet to NMS immediately
      ...audioOutputOptions
    ])
    .output(`rtmp://localhost:${RTMP_PORT}/live/${streamKey}`)
    .on('start', (cmdLine) => {
      console.log('[FFMPEG] Pipe started:', cmdLine);
      broadcastIPC('ffmpeg-status', { state: 'running', streamKey });
    })
    .on('stderr', (line) => {
      // Parse the periodic stats line FFmpeg writes to stderr, e.g.:
      // frame=  120 fps= 29 q=22.0 size=   256kB time=00:00:04.06 bitrate= 516.7kbits/s speed=0.958x
      const statsMatch = line.match(
        /frame=\s*(\d+)\s+fps=\s*([\d.]+).*?size=\s*([\d.]+\s*\w+).*?time=([\d:.]+).*?bitrate=\s*([\d.]+\s*\S+).*?speed=\s*([\d.]+)x/
      );
      if (statsMatch) {
        broadcastIPC('ffmpeg-stats', {
          frame:     parseInt(statsMatch[1]),
          fps:       parseFloat(statsMatch[2]),
          size:      statsMatch[3].trim(),
          time:      statsMatch[4],
          bitrate:   statsMatch[5].trim(),
          speed:     parseFloat(statsMatch[6]),
          streamKey
        });
      } else if (!line.includes('Discarding interframe') && !line.includes('Error submitting packet')) {
        console.log('[FFMPEG-STDERR]', line);
      }
    })
    .on('error', (err) => {
      // SIGKILL / SIGINT are expected during a user-initiated stop — not real errors
      const isExpectedKill = err.message.includes('SIGKILL') || err.message.includes('SIGINT') || err.message.includes('killed');
      if (!isExpectedKill) {
        console.error('[FFMPEG] Unexpected crash:', err.message);
        broadcastIPC('ffmpeg-status', { state: 'error', streamKey, message: err.message });
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('ffmpeg-error', err.message);
        }
        // Attempt auto-restart so the broadcast recovers without manual intervention
        schedulePipeRestart(event);
      } else {
        console.log('[FFMPEG] Process stopped cleanly.');
        lastPipeConfig = null; // Clear config so auto-restart doesn't trigger after a clean stop
        broadcastIPC('ffmpeg-status', { state: 'stopped', streamKey: null });
      }
    })
    .run();
});

let internalChunkCount = 0;
ipcMain.on('ffmpeg-pipe-chunk', (event, data) => {
  const { chunk, streamKey } = data;
  if (!videoStream || streamKey !== activeStreamKey) {
    return;
  }
  const buffer = Buffer.from(chunk);
  videoStream.write(buffer);
  
  internalChunkCount++;
  if (internalChunkCount <= 5 || internalChunkCount % 50 === 0) {
    console.log(`[IPC] Received chunk #${internalChunkCount} (${buffer.length} bytes) for ${streamKey}`);
  }
});

ipcMain.on('ffmpeg-pipe-stop', () => {
  // Cancel any pending auto-restart before killing the process
  if (pipeRestartTimeout) {
    clearTimeout(pipeRestartTimeout);
    pipeRestartTimeout = null;
  }
  lastPipeConfig = null;  // Prevent schedulePipeRestart from triggering on the SIGKILL below
  pipeRestartCount = 0;

  if (videoStream) {
    videoStream.end();
    videoStream = null;
  }
  if (pipeFfmpeg) {
    pipeFfmpeg.kill();
    pipeFfmpeg = null;
  }
  broadcastIPC('ffmpeg-status', { state: 'stopped', streamKey: null });
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
        process.stdout.write(`\r[REC:${streamKey}] ${line.trim()}`);
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

let _encoderCachePromise = null;

/**
 * Probes ffmpeg for available H.264 encoders once, caches result.
 * @returns {Promise<{available: string[], best: string, bestLabel: string}>}
 */
function probeEncoders() {
  if (_encoderCachePromise) return _encoderCachePromise;

  _encoderCachePromise = new Promise((resolve) => {
    ffmpeg.getAvailableEncoders((err, encoders) => {
      if (err) {
        console.error('[GPU] ffmpeg encoder probe failed:', err.message);
        return resolve({ available: [], best: 'none', bestLabel: 'Software x264 (fallback)' });
      }

      const available = HW_ENCODERS.filter(e => encoders[e.codec]).map(e => e.key);
      console.log('[GPU] Available HW encoders:', available.length ? available : ['none (software only)']);

      // Pick highest-preference available encoder
      let best = 'none';
      let bestLabel = 'Software x264';
      for (const e of HW_ENCODERS) {
        if (encoders[e.codec]) {
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
