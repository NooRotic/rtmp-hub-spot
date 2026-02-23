# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- External RTMP Feed Camera integration via HTTP-FLV and `mpegts.js`.
- Ability to draw timestamp watermarks and burn-in settings diagnostics directly on the Grid render canvas.
- `.env` support to securely manage hardcoded ports and endpoints.

### Changed

- Major refactoring in `useWebRTC.ts` to deduplicate WebRTC offer/answer logic and streamline simple-peer event bindings.
- Extract `4001`, `1935`, and `8000` ports into environment variable files `.env.example`.
- Update README.md with comprehensive OBS Setup guides and `.env` setup instructions.

## [1.0.0] - 2026-02-23

### Added

- Initial public release of RTMP Hub Spot.
- WinNT 4.0 pixel-perfect aesthetic dashboard.
- Real-Time Grid Compositing for remote WebRTC participants.
- Native Electron app leveraging FFmpeg to pipe the browser canvas into standard RTMP/FLV streams.
- Hardware Acceleration support (NVENC, AMF, QSV) for ultra-low latency broadcasting.
- Global low-latency signaling chat for Hub coordination.
