# RTMP Hub Spot - Master Documentation

> **AI AGENT INSTRUCTION**: Before making any changes to this codebase, read this document thoroughly. It contains critical architectural decisions and solutions to "gotcha" issues that must be preserved.

## 1. Project Overview & Goals

**RTMP Hub Spot** is a hybrid real-time communication platform that bridges WebRTC (low-latency peer-to-peer video) with RTMP (broadcast streaming).

**Primary Goals:**

1.  **Low Latency Interaction**: Enable real-time video chat between multiple clients and an Admin.
2.  **Broadcast Capability**: Allow the Admin to "pipe" any client's feed or a composite "Grid View" to an RTMP endpoint (e.g., OBS, YouTube, Twitch).
3.  **Ease of Use**: Clients connect via a simple web link; Admin manages everything via a desktop Electron app.
4.  **Robustness**: The system must handle network fluctuations, device changes, and app restarts gracefully.

## 2. Architecture

The application is a monorepo containing:

### **Server (`packages/server`)**

- **Node Media Server (NMS)**: Handles RTMP ingestion and playback.
- **Socket.IO**: Manages WebRTC signaling (offers, answers, ICE candidates) and chat.
- **Electron Main Process**: Wraps the frontend for the Admin, providing access to system resources (FFmpeg piping) and window management.
- **FFmpeg**: Used internally to transcode/pipe WebRTC streams (received via IPC) to the local RTMP server.

### **Client (`packages/client`)**

- **React + Vite**: The frontend UI.
- **SimplePeer**: Handles WebRTC peer connections.
- **Socket.IO Client**: Connects to the signaling server.
- **Shared Codebase**: The same React app runs in the Browser (Client Mode) and Electron (Admin Mode), with behavior toggled by `isElectron` detection.

## 3. Critical Workflows

### 3.1. Connection & Signaling

- **Room Strategy**: All participants (Admin + Clients) join a **single shared room** hardcoded as `'main-hub'`. This ensures a full mesh network where everyone can see everyone.
- **Signaling**:
  - Clients connect -> Emit `join-room`.
  - Server emits `all-users`.
  - Newcomer initiates WebRTC `offer` to existing peers.
  - Existing peers respond with `answer`.
  - Result: Full mesh P2P connection.

### 3.2. Admin Broadcasting (The "Pipe")

1.  **Capture**: The React app captures a `MediaStream` (from a camera or the Grid canvas).
2.  **Chunking**: The `MediaRecorder` API slices the stream into `WebM` chunks.
3.  **IPC Transport**: Chunks are sent from the Renderer (React) to the Main Process (Electron) via `ipcRenderer.send('ffmpeg-pipe-chunk', { chunk, streamKey })`.
4.  **FFmpeg Transcoding**: The Main Process writes chunks to a `PassThrough` stream, which feeds into an FFmpeg process.
5.  **RTMP Output**: FFmpeg transcodes the stream (to FLV/H.264) and pushes it to `rtmp://localhost/live/{streamKey}`.

## 4. "Gotchas" & Resolved Issues (CRITICAL)

### 4.1. Connectivity & Room Isolation

- **Issue**: Clients and Admin were joining different rooms based on usernames, preventing visibility.
- **Fix**: Hardcoded `roomId: 'main-hub'` in `useWebRTC.ts`. **DO NOT CHANGE THIS** unless implementing multi-room support with explicit UI controls.

### 4.1b. Trickle ICE (latency)

- **Change**: `trickle: true` in both `createPeer` and `addPeer` in `useWebRTC.ts`.
- **Why**: `trickle: false` delayed P2P connection setup by 1–5 seconds while all ICE candidates were gathered before sending the offer. With `trickle: true`, candidates are sent as discovered and connection establishes in ~300 ms for LAN peers.
- **Safety**: The signal routing in `bindPeerEvents` already handles the three signal shapes correctly — `signal.type === 'offer'`, `signal.type === 'answer'`, and `signal.candidate` for trickle candidates. **Do not set `trickle: false`** — it also breaks renegotiation ordering.

### 4.2. Electron Detection

- **Issue**: `navigator.userAgent` is unreliable alone.
- **Fix**: Use a robust check:
  ```typescript
  const isElectron =
    typeof window !== "undefined" &&
    (navigator.userAgent.toLowerCase().includes(" electron/") ||
      (window as any).process?.versions?.electron);
  ```

### 4.3. Admin Camera Visibility (The "Black Box")

- **Issue**: When Admin toggles their camera _after_ joining, clients received an "Answer" signal instead of an "Offer", causing the stream to be ignored.
- **Fix**: Updated `useWebRTC.ts` to strictly route signals based on `type`. If Admin initiates a renegotiation (adds a track), it sends an `offer`. The signaling logic now explicitly checks `signal.type === 'offer'` vs `'answer'`.

### 4.4. FFmpeg Stream Collisions

- **Issue**: Chunks from different feeds (e.g., Grid vs Camera 1) were mixing in the same FFmpeg pipe, causing "Invalid data" errors.
- **Fix**:
  1.  **Frontend**: Send `{ chunk, streamKey }` in IPC messages.
  2.  **Backend (`main.js`)**: Track `activeStreamKey`. Only write chunks matching the active key to the FFmpeg process.

### 4.5. FFmpeg Input Format

- **Issue**: `MediaRecorder` produces WebM. FFmpeg's `webm` format demuxer can be unstable with piped input.
- **Fix**: Use `-f matroska` (WebM parent container) and flags `-fflags nobuffer+igndts+genpts -flags low_delay -probesize 5000000 -analyzeduration 1000000`.
- **Removed**: `-analyze_max_extrapolation` (unsupported option that caused crashes).
- **Note**: `probesize 5000000` / `analyzeduration 1000000` are intentionally large — smaller values cause "Discarding interframe without a prior keyframe" errors at startup.

### 4.7. RTMP Stream Viewability from External Clients (OBS/VLC)

Two root causes prevented external RTMP playback:

1. **`gop_cache: false`** — With GOP cache disabled, a client connecting mid-stream has to wait up to 1 GOP interval (≈1 s at `-g 30` / 30fps) before receiving a keyframe. Many players timeout and disconnect. **Fix**: Set `gop_cache: true` in `nmsConfig.rtmp`.

2. **Missing audio codec header** — The `-an` flag produced video-only FLV streams. OBS and VLC both silently fail or refuse to buffer a stream with no audio track. Canvas-captured streams (`grid`, etc.) have no audio source; peer feed streams (`feed-*`) have real Opus audio from MediaRecorder.
   - **Fix for grid/canvas streams**: Inject an infinite silent lavfi source as input 1 and map it explicitly:
     ```
     -f lavfi -i aevalsrc=0:channel_layout=stereo:sample_rate=44100
     -map 0:v:0 -map 1:a:0 -c:a aac -b:a 32k
     ```
   - **Fix for feed-* streams**: Remove `-an`, add `-c:a aac -b:a 128k` to transcode the Opus audio from the WebM input.

The distinction is made in `main.js` via `const hasFeedAudio = streamKey.startsWith('feed-')`.

### 4.8. FFmpeg Health Monitoring

The renderer has no direct visibility into whether the FFmpeg process is alive or healthy. Added a `broadcastIPC(channel, data)` helper that sends events to all `BrowserWindow` renderers:

- **`ffmpeg-status`**: `{ state: 'starting'|'running'|'stopped'|'error', streamKey, message? }` — emitted on pipe start, first frame, clean stop, and error.
- **`ffmpeg-stats`**: `{ frame, fps, size, time, bitrate, speed, streamKey }` — parsed from FFmpeg's periodic stderr stats line and emitted on every update.

The client listens in `App.tsx` and displays a **FFmpeg Pipeline** health panel in the sidebar with a coloured LED indicator and live stats.

### 4.6. Grid Management

- **Feature**: Admin can manually select which feeds appear in the composite grid.
- **Implementation**: `App.tsx` manages a `gridMembers` Set. `GridView` filters streams based on this set.
- **Diagnostics & Overlays**: The GridView canvas supports drawing a timestamp watermark and a "Burn-in Settings" diagnostic overlay (Bitrate, Preset, Hardware Acceleration). These are drawn directly onto the canvas in the `requestAnimationFrame` loop _before_ `captureStream(30)` sends the feed to FFmpeg.

## 5. Future Development Guidelines

1.  **State Management**: Keep UI state (like `gridMembers`) in `App.tsx` and pass down. Avoid complex state in deeply nested components.
2.  **Signaling**: Always respect the `signal.type`. Do not assume "I am the initiator" means "I always send offers". Renegotiation flips roles.
3.  **FFmpeg**: Test any FFmpeg flag changes carefully against the `MediaRecorder` output. Latency is the priority.
