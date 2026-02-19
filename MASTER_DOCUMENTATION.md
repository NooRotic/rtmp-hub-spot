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
- **Fix**: Use `-f matroska` (WebM parent container) and flags `-fflags nobuffer+igndts -flags low_delay -analyzeduration 0 -probesize 32`.
- **Removed**: `-analyze_max_extrapolation` (unsupported option that caused crashes).

### 4.6. Grid Management

- **Feature**: Admin can manually select which feeds appear in the composite grid.
- **Implementation**: `App.tsx` manages a `gridMembers` Set. `GridView` filters streams based on this set.

## 5. Future Development Guidelines

1.  **State Management**: Keep UI state (like `gridMembers`) in `App.tsx` and pass down. Avoid complex state in deeply nested components.
2.  **Signaling**: Always respect the `signal.type`. Do not assume "I am the initiator" means "I always send offers". Renegotiation flips roles.
3.  **FFmpeg**: Test any FFmpeg flag changes carefully against the `MediaRecorder` output. Latency is the priority.
