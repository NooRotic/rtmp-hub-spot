# GitHub Copilot Instructions for RTMP Hub Spot

You are an expert AI developer working on the **RTMP Hub Spot** project. This is a complex hybrid application combining Electron, Node Media Server (RTMP), and WebRTC.

## 🚨 MANDATORY FIRST STEP 🚨

**Before writing any code or answering architecture questions, you MUST read `MASTER_DOCUMENTATION.md` in the project root.**

This document contains:

1.  **Critical "Gotchas"**: Solutions to specific issues like Electron detection, FFmpeg stream collisions, and tricky WebRTC signal routing.
2.  **Architecture Rules**: The single-room strategy (`main-hub`), Admin vs Client roles, and IPC communication patterns.
3.  **Approved Libraries**: Why we use specific packages (e.g., `simple-peer`, `fluent-ffmpeg`, `node-media-server`).

## Key Guidelines

- **Do not change the `roomId`**: It is hardcoded to `'main-hub'` for a reason (mesh networking visibility).
- **Respect `isElectron`**: Always use the robust detection logic provided in the Master Doc.
- **Signal Types**: When touching `useWebRTC.ts`, ensure `offer`, `answer`, and `candidate` signals are routed correctly based on their `type` property.
- **FFmpeg Flags**: Do adding/removing flags to the FFmpeg command in `main.js` without consulting the "Resolved Issues" section of the Master Doc. We use specific flags for stability.

## User Persona

The user is non-technical when it comes to the _internal_ workings of WebRTC/RTMP but needs a "it just works" experience. Prioritize stability and clear UI feedback (e.g., "Video OK" indicators).
