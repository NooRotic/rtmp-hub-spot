# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-03-11

### Added (Tier 2 — UX)
- **Pre-flight guest lobby** (`Lobby.tsx`): Browser clients now see a camera preview + name input screen before joining. Single "JOIN HUB" button replaces the old two-step flow. Lobby reappears with a "removed by admin" message if the user is kicked.
- **"You are live" banner**: Clients display a green pulsing `◉ YOU ARE LIVE` bar when connected to at least one peer with an active stream.
- **Admin kick**: Per-peer ✕ button in Connected Clients sidebar. Server disconnects the socket and emits `kicked` to the target; client resets to lobby.
- **Admin spotlight**: Per-peer ★ button pins a feed to 80% of the GridView canvas; other feeds render as a 20% thumbnail strip at the bottom.
- **Stale closure fix in `useWebRTC`**: `userNameRef` / `cameraLabelRef` mirror the latest prop values so reconnect timers always send the current name, not the name captured when the timer was registered.

### Added (Tier 3 — Standout)
- **"Add to OBS" clipboard copy**: Every RTMP link in the Active RTMP Links panel has a COPY button that writes the `rtmp://` URL to clipboard.
- **In-app RTMP preview**: Each Live Publisher row has a `▶ PREVIEW` toggle that mounts a self-contained mpegts.js FLV player inline. Player is destroyed when toggled off.
- **GridView spotlight layout**: `spotlightId` prop on `GridView`. Spotlit stream gets 80% canvas height with a name badge and ◉ LIVE badge; all others fill a 20% thumbnail strip.

### Fixed
- `kick-user` socket handler added to server — previously the UI placeholder had no server-side counterpart.

---

## [1.0.1] — 2026-03-11

### Fixed (Critical)
- **RTMP streams not viewable in OBS/VLC** — two root causes:
  - `gop_cache: false` → `gop_cache: true` in NMS config. Late-joining players now receive a keyframe immediately instead of waiting up to ~1 s.
  - `-an` flag removed from FFmpeg output. Video-only FLV streams were silently rejected by OBS/VLC. Canvas/grid streams now get a silent `aevalsrc=0` lavfi audio track; feed streams get real AAC (`-c:a aac -b:a 128k`).
- **Production build blank window** — `win.loadURL('https://localhost:4443')` hardcoded. Fixed with `app.isPackaged` branch loading `https://localhost:${SIGNALING_PORT}`.
- **Recording state desync** — `recording-stopped` Socket.IO event unhandled on client. Added listener in `useWebRTC`, exposed `recordingStopped`, synced in App.tsx.

### Fixed (High)
- **No FFmpeg crash recovery** — added `schedulePipeRestart()` with 2 s / 4 s / 6 s linear backoff, max 3 attempts. `lastPipeConfig` stores the last known config. Clean stops (`SIGKILL`/`SIGINT`) clear `lastPipeConfig` to prevent spurious restarts.
- **No WebSocket reconnect on drop** — added `connectInternal()` + `scheduleReconnect()` with `1.5^n × 2000 ms` exponential backoff, cap at 10 attempts. `Socket.IO reconnection: false` hands full control to the manual system.
- **Stale peers on reconnect** — `cleanupPeers()` now called before every reconnect attempt.

### Improved
- **P2P connection latency** — `trickle: false` → `trickle: true`. Setup time drops from 2–5 s to ~300 ms on LAN.
- **FFmpeg startup latency** — `analyzeduration` reduced from 1 000 000 → 500 000 µs.
- **FFmpeg per-packet flush** — `-flush_packets 1` added to reduce steady-state RTMP lag.

### Added
- **FFmpeg Pipeline health panel** in admin sidebar: LED indicator (grey/amber/green/red), live stats (FRAME, FPS, RATE, SPEED, TIME, SIZE) parsed from FFmpeg stderr and pushed to renderer via `broadcastIPC`.
- **`broadcastIPC(channel, data)`** helper — pushes IPC events to all live BrowserWindow renderers without a specific `event.sender`.
- **Status bar reconnect state** — Hub status shows "RECONNECTING…" with amber LED during socket backoff.

---

## [Unreleased → 1.0.0] — 2026-02-23 to 2026-03-11

### Added
- External RTMP Feed Camera integration via HTTP-FLV and `mpegts.js`.
- Timestamp watermarks and burn-in settings diagnostics drawn onto the Grid canvas.
- `.env` support for ports and endpoints.

### Changed
- Major refactoring in `useWebRTC.ts` to deduplicate WebRTC offer/answer logic.
- Extracted `4001`, `1935`, `8000` ports into `.env.example`.
- Updated README.md with comprehensive OBS setup guide and `.env` instructions.

---

## [1.0.0] — 2026-02-23

### Added
- Initial public release of RTMP Hub Spot.
- WinNT 4.0 pixel-perfect aesthetic dashboard.
- Real-time grid compositing for remote WebRTC participants.
- Native Electron app leveraging FFmpeg to pipe the browser canvas into standard RTMP/FLV streams.
- Hardware acceleration support (NVENC, AMF, QSV) for ultra-low latency broadcasting.
- Global low-latency signaling chat for hub coordination.

---

## Open Items (post-1.1.0)

### Medium priority
- `peer.addStream()` deprecated — migrate to `addTrack()` (`useWebRTC.ts` lines ~313, 350)
- `replaceTrack()` used without validating transceiver state — silent failures possible
- `gridMembers` is a `Set` — not serializable, cannot persist to localStorage
- Broadcast settings (bitrate/preset/hwAccel) not persisted between sessions
- Port 8000 for NMS HTTP still hardcoded in App.tsx — should read from `serverStatus`
- `contextIsolation: false` + `nodeIntegration: true` — no preload script (security debt)

### Low priority
- Test coverage ~10% — no hook, IPC, or server-side tests
- Chat capped at 50 messages with no persistence
- `recording-stopped` emitted via `io.emit` (all clients) — should target admin socket only
- Kick has no auth gate — server-side trust is currently implicit (LAN-only acceptable for now)

### Phase 2 (Internet / Public launch)
- TURN server for NAT traversal
- Real TLS certificate (Let's Encrypt) to replace self-signed
- Streamer-controlled invite links with session tokens
- Admin token auth for browser-based admin monitor (`?role=admin&token=<uuid>`)
- Proper preload script + contextIsolation for Electron security hardening
