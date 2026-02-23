# 🛰️ RTMP HUB SPOT

**High-Performance WebRTC to RTMP Bridge with a Bittersweet Retro Soul.**

RTMP Hub Spot is a professional-grade streaming utility designed to bridge the gap between browser-based WebRTC participants and professional broadcast software (OBS, VLC, etc.). It combines a modern, hardware-accelerated media pipeline with a meticulous **Windows NT 4.0** aesthetic.

![WinNT Aesthetic](https://img.shields.io/badge/Aesthetic-WinNT%204.0%20Workstation-000080?style=for-the-badge&logo=windows)
![Tech Stack](https://img.shields.io/badge/Stack-React%20%7C%20Electron%20%7C%20FFmpeg-61DAFB?style=for-the-badge&logo=react)

## ✨ Features

- **🖥️ Retro WinNT Dashboard**: A pixel-perfect recreation of the classic NT interface, featuring native-style window controls, inset fields, and authentic typography.
- **🖼️ Real-Time Grid Compositing**: Capture all remote participants into a single high-performance canvas grid for monitoring or broadcasting.
- **📡 WebRTC to RTMP Bridge**: Seamlessly convert low-latency browser feeds into standard RTMP/FLV streams for easy integration with OBS, VLC, and CDN services.
- **🚀 Hardware Accelerated**: Native support for **NVIDIA (NVENC)**, **AMD (AMF)**, and **Intel (QSV)** encoding to ensure smooth streaming even on modest hardware.
- **🕵️‍♂️ Professional Surveillance**: Real-time telemetry tracking viewer IPs, stream paths, and session uptimes.
- **💬 Global Hub Chat**: Low-latency signaling chat for Hub coordination.

<!-- Screenshot Placeholder: Admin Dashboard illustrating the layout and grid controls -->

> _Screenshot: The Admin Dashboard showing the Grid View, Connected Clients list, and Broadcast Controls._

---

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [FFmpeg](https://ffmpeg.org/) (System-wide or via binary)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/rtmp-hub-spot.git
cd rtmp-hub-spot

# Install dependencies
npm install

# Setup environment variables
cp packages/client/.env.example packages/client/.env
cp packages/server/.env.example packages/server/.env
```

_Note: Edit the `.env` files if you need to change the default ports (4001, 1935, 8000)._

### Running the App

```bash
# Start both Client and Server in one go
npm run dev
```

---

## 🎥 OBS Setup Guide (The "Power User" Flow)

This guide explains how to pull high-quality feeds from RTMP Hub Spot into OBS Studio for professional broadcasting.

### 1. Start the Hub

Launch the application (`npm run dev`). The Admin window will open.

- **Check Status**: Ensure "NMS Server" says "Listening".
- **Grid View**: Click "ENABLE GRID VIEW" to see the composite layout.
- **Share Grid**: Click "SHARE GRID TO ALL" to start the internal RTMP stream.

### 2. Get the RTMP Link

Look at the **Active RTMP Links** section in the sidebar. You will see links like:

- **Grid**: `rtmp://localhost/live/grid` (or `rtmp://<YOUR_LAN_IP>/live/grid` for network access)
- **User Feed**: `rtmp://localhost/live/feed-username`

### 3. Configure OBS Studio

1.  **Add Source**: In OBS, click the `+` icon under Sources and select **Media Source**.
2.  **Name It**: E.g., "Hub Grid" or "Guest 1".
3.  **Properties Setup**:
    - **Local File**: Uncheck this (we are using a network stream).
    - **Input**: Paste the RTMP link (e.g., `rtmp://localhost/live/grid`).
    - **Input Format**: Leave blank or type `flv`.
    - **Network Buffering**: Set to `1 MB` or `2 MB` (lower = lower latency, higher = smoother).
    - **Restart playback when source becomes active**: Check this.
    - **Use hardware decoding**: Check this if available.
    - **Show nothing when playback ends**: Check this.
4.  **Click OK**.

> **Pro Tip**: If the feed doesn't appear immediately, toggle the visibility of the source in OBS (the eye icon) to force a reconnect.

<!-- Screenshot Placeholder: OBS Studio Source Properties dialog showing the RTMP input configuration -->

> _Screenshot: Correct Media Source settings in OBS for low-latency playback._

### 4. Audio Handling

The RTMP stream includes mixed audio from all participants.

- In OBS **Audio Mixer**, ensure your Media Source is active.
- To monitor audio without echo, set **Audio Monitoring** to "Monitor Off" (unless you are wearing headphones).

---

## 🏗 Architecture

The system uses a unique "Browser-as-Encoder" strategy:

1.  **Ingest**: Remote participants join via WebRTC (`socket.io` + `simple-peer`).
2.  **Composite**: The Admin dashboard renders participants into a high-refresh `<canvas>`.
3.  **Pipe**: The canvas stream is converted to WebM chunks and piped via Electron IPC to a server-side **FFmpeg** process.
4.  **Broadcast**: FFmpeg re-encodes the stream to RTMP/FLV, hosted by an internal **Node-Media-Server** instance.

## 🛠 Project Structure

```text
├── packages
│   ├── client      # React Portal (Vite + TS)
│   ├── server      # Electron App & Media Server
│   └── shared      # Common types and utilities
```

## 🎨 Design Principles

RTMP Hub Spot is not just a tool; it's a tribute. We adhere to strict WinNT design tokens:

- **Background**: `#c0c0c0` (WinFace)
- **Shadows**: `#808080` (WinShadow) / `#ffffff` (WinHighlight)
- **Title Bar**: `#000080` (Classic Navy)

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---

_Built with ❤️ by the AntiGravity Team. Stay Retro. Stay Stable._
