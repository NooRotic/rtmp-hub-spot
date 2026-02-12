const { app, BrowserWindow, ipcMain } = require('electron');
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

ffmpeg.setFfmpegPath(ffmpegStatic);

// Generate self-signed cert for development - this allows Secure Context (Camera Access) over the network
const attrs = [{ name: 'commonName', value: 'rtmp-hub-spot.local' }];
const pems = selfsigned.generate(attrs, { days: 365 });

function createWindow() {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
    frame: false, // Custom WinNT frame
  });

  // In production, load the built index.html
  // In development, load from Vite (Now using HTTPS port 4443)
  win.loadURL('https://localhost:4443'); 
  
  app.on('gpu-process-crashed', (event, killed) => {
    console.warn('[ELECTRON] GPU Process Crashed. Killed:', killed);
  });
}

// Allow self-signed certs in development
app.commandLine.appendSwitch('ignore-certificate-errors');

const nmsConfig = {
  rtmp: {
    port: 1935,
    host: '0.0.0.0',
    chunk_size: 4096, // Reduced from 60000 for lower latency
    gop_cache: false, // Disable GOP cache to reduce start-up latency
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    host: '0.0.0.0',
    allow_origin: '*'
  },
  basePath: './media' // Ensure a base path exists
};

const nms = new NodeMediaServer(nmsConfig);
nms.run();

const rtmpSessions = new Map(); // id -> { ip, path, startTime }

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

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

// Signaling & Web Server
const expressApp = express();
const server = https.createServer({
  key: pems.private,
  cert: pems.cert
}, expressApp);

// Serve the React client production build
const clientPath = path.join(__dirname, '../client/dist');
expressApp.use(express.static(clientPath));

// Redirect all other requests to the React app
expressApp.get('*', (req, res) => {
  res.sendFile(path.join(clientPath, 'index.html'));
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ["GET", "POST"]
  }
});

const users = {}; // socket.id -> { name, roomId }

// IP Discovery Helper
async function broadcastStatus(roomId = 'main') {
  const networkInterfaces = os.networkInterfaces();
  let localIP = '127.0.0.1';
  for (const name in networkInterfaces) {
    for (const iface of networkInterfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  const sessions = Array.from(rtmpSessions.keys()).map(id => getSessionData(id));

  const status = {
    local: localIP,
    public: 'Discovery Active',
    clientCount: Object.keys(users).length,
    rtmpCount: rtmpSessions.size,
    rtmpSessions: sessions
  };
  
  io.emit('server-status', status);
}

io.on('connection', (socket) => {
  console.log('[Signaling] New socket connection:', socket.id);
  
  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    users[socket.id] = { name: userName || `User ${socket.id.slice(0, 4)}`, roomId };
    
    // 1. Tell the newcomer about everyone else already in the room
    const otherUsers = Object.keys(users).filter(id => id !== socket.id && users[id].roomId === roomId);
    socket.emit('all-users', otherUsers.map(id => ({ userId: id, userName: users[id].name })));
    
    // 2. Tell everyone else that the newcomer has arrived
    socket.to(roomId).emit('user-joined', { userId: socket.id, userName: users[socket.id].name });
    
    console.log(`[Signaling] ${users[socket.id].name} joined ${roomId}. Total in room: ${otherUsers.length + 1}`);
    
    // Broadcast status update to all
    broadcastStatus(roomId);
  });

  socket.on('offer', (data) => {
    console.log(`[Signaling] Offer from ${socket.id} to ${data.to}`);
    socket.to(data.to).emit('offer', {
      offer: data.offer,
      senderId: socket.id,
      senderName: users[socket.id]?.name || 'Unknown'
    });
  });

  socket.on('answer', (data) => {
    console.log(`[Signaling] Answer from ${socket.id} to ${data.to}`);
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
    console.log(`[Chat] ${senderName} in ${roomId}: ${message}`);
    io.to(roomId).emit('chat-message', {
      senderId: socket.id,
      senderName,
      message,
      timestamp: Date.now()
    });
  });

  socket.on('disconnect', () => {
    if (users[socket.id]) {
      const { name, roomId } = users[socket.id];
      socket.to(roomId).emit('user-disconnected', socket.id);
      delete users[socket.id];
      console.log(`[Signaling] ${name} disconnected. Remaining users: ${Object.keys(users).length}`);
      broadcastStatus(roomId);
    }
  });
});

// Periodic status broadcast (every 5 seconds) to keep uptimes fresh
setInterval(() => {
  broadcastStatus();
}, 5000);

ipcMain.on('telemetry-refresh', () => {
  console.log('[TELEMETRY] Manual refresh requested');
  broadcastStatus();
});

server.listen(4001, '0.0.0.0', () => {
  console.log('Signaling server listening on HTTPS 0.0.0.0:4001');
});

let ffmpegProcess = null;

ipcMain.on('start-virtual-cam', (event, streamUrl) => {
  if (ffmpegProcess) {
    ffmpegProcess.kill();
  }

  ffmpegProcess = ffmpeg(streamUrl)
    .inputOptions([
      '-fflags nobuffer',
      '-flags low_delay'
    ])
    .outputOptions([
      '-f flv',
      '-vcodec libx264',
      '-preset ultrafast',
      '-tune zerolatency',
      '-pix_fmt yuv420p',
      '-g 30'
    ])
    .output('rtmp://localhost:1935/live/admin')
    .on('start', (commandLine) => {
      console.log('Spawned FFmpeg with command: ' + commandLine);
    })
    .on('error', (err) => {
      console.log('An error occurred: ' + err.message);
    })
    .on('end', () => {
      console.log('Processing finished !');
    })
    .run();
});

ipcMain.on('stop-virtual-cam', () => {
  if (ffmpegProcess) {
    ffmpegProcess.kill();
    ffmpegProcess = null;
  }
});

const { PassThrough } = require('stream');
let pipeFfmpeg = null;
let videoStream = null;

ipcMain.on('ffmpeg-pipe-start', (event, options = {}) => {
  if (pipeFfmpeg) {
    pipeFfmpeg.kill();
    videoStream = null;
  }

  const { 
    hwAccel = 'none', 
    streamKey = 'grid', 
    bitrate = '2500k', 
    preset = 'ultrafast',
    fps = 30
  } = options;
  
  let vcodec = 'libx264';
  let accelFlags = [];

  if (hwAccel === 'nvidia') {
    vcodec = 'h264_nvenc';
    accelFlags = ['-hwaccel nvdec'];
  } else if (hwAccel === 'amd') {
    vcodec = 'h264_amf';
  } else if (hwAccel === 'intel') {
    vcodec = 'h264_qsv';
  }

  videoStream = new PassThrough();
  
  pipeFfmpeg = ffmpeg(videoStream)
    .inputFormat('webm')
    .inputOptions([
      '-hwaccel auto',
      '-fflags nobuffer',
      '-flags low_delay',
      '-probesize 32',
      '-analyzeduration 0',
      ...accelFlags
    ])
    .outputOptions([
      '-f flv',
      `-vcodec ${vcodec}`,
      `-b:v ${bitrate}`,        // User-defined bitrate
      `-preset ${preset}`,      // User-defined performance preset
      '-tune zerolatency',
      '-pix_fmt yuv420p',
      '-g 30',
      `-r ${fps}`,              // User-defined framerate
      '-an'
    ])
    .output(`rtmp://localhost:1935/live/${streamKey}`)
    .on('start', (cmd) => console.log('[FFMPEG] Pipe started:', cmd))
    .on('stderr', (line) => console.log('[FFMPEG-STDERR]', line))
    .on('error', (err) => {
      console.error('[FFMPEG] Error:', err.message);
      event.sender.send('ffmpeg-error', err.message);
    })
    .run();
});

ipcMain.on('ffmpeg-pipe-chunk', (event, chunk) => {
  const buffer = Buffer.from(chunk);
  if (videoStream) {
    videoStream.write(buffer);
  }
});

ipcMain.on('ffmpeg-pipe-stop', () => {
  if (videoStream) {
    videoStream.end();
    videoStream = null;
  }
  if (pipeFfmpeg) {
    pipeFfmpeg.kill();
    pipeFfmpeg = null;
  }
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
