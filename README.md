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
```

### Development

```bash
# Start both Client and Server in one go
npm run dev
```

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
