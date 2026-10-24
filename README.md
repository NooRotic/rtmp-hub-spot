# RTMP Hub Spot

Guests join from a phone or laptop browser over WebRTC. The host's desktop app composites their cameras into one canvas grid, encodes it with FFmpeg, and publishes it to a built-in RTMP server that OBS and VLC can pull from. It can also relay any of its streams to YouTube, Twitch, Kick, TikTok, Facebook or a custom RTMP server, several at once, without re-encoding.

Built with Electron, React 18, TypeScript, Socket.IO, simple-peer, FFmpeg and Node-Media-Server, with a dark take on the Windows NT 4.0 interface.

[![CI](https://github.com/NooRotic/rtmp-hub-spot/actions/workflows/ci.yml/badge.svg)](https://github.com/NooRotic/rtmp-hub-spot/actions/workflows/ci.yml)

<!-- PLACEHOLDER (plan 004, H-3): replace this block with the 90-second demo clip link (YouTube, unlisted). -->
> **Demo clip: not recorded yet.** A 90-second walkthrough (two guests join, the grid composites, the Broadcast Console relays to two destinations) will be linked here.

<!-- PLACEHOLDER (plan 004, PR-4): admin window screenshot. Suggested file: docs/media/admin.png, 1600 px wide PNG. Not in the repo yet. -->
> _Screenshot to come: the admin window, with guest tiles on the stage, the Combined Grid View, and the Broadcast Console below._

---

## Status

- **Run it from source.** There is no downloadable build or GitHub Release yet.
- **The packaged `.exe` doesn't start on `main` yet.** `npm run release` builds a portable Windows `.exe`, but two server modules are missing from the package list and the FFmpeg binary is packed inside `app.asar`, where it can't run. A fix is in progress.
- **Checked on real hardware (July 2026):** switching cameras mid-session, the LAN address the hub advertises, and window placement on the stage.
- **Not confirmed yet:** a long, stable grid broadcast into OBS. The runtime encoder check described below is the suspected fix for a broadcast that used to stop on its own; a 10-minute run on real hardware is still to do.
- **Not tested against live platforms yet:** relaying to two or more real destinations at once. The relay code has unit tests.

The release checklist is in [`docs/RELEASE-TODO.md`](docs/RELEASE-TODO.md), and the PR-by-PR plan is in [`docs/plans/004-release-p1-execution.md`](docs/plans/004-release-p1-execution.md).

---

## What it does

### For guests

- Open the join link the host shares, preview your camera, type a name (and the room PIN if the host set one), then press **JOIN HUB**.
- Works in a desktop or phone browser on the same network as the host. The page uses HTTPS with a self-signed certificate, so the browser warns first; see [Security model](#security-model).

### For the host (the Electron window)

- **Stage.** Every guest's camera appears as a tile. **★** spotlights a guest; **✕** removes them (host only).
- **Grid.** The Combined Grid View draws the feeds onto one canvas, 1920×1080 with Auto Layout on. A spotlighted guest takes 80% of the height and the rest share a strip below. Guests are always in the grid; **Include Admin** adds the host's own camera, and each external feed has its own **Grid** checkbox. Optional timestamp watermark and burned-in encoder settings.
- **Broadcast.** **START GRID BROADCAST** publishes the grid to `rtmp://<host>:1935/live/grid`. The **BROADCAST** button on a tile publishes that guest alone as `live/feed-<name>`. Each stream gets its own FFmpeg process, so the grid and individual feeds can publish at the same time.
- **Hardware encoding.** At startup the app lists the H.264 encoders compiled into FFmpeg (AMD AMF, NVIDIA NVENC, Intel QSV), runs a one-frame test encode with each, and keeps only the ones that work on this machine. It picks the first that passes, in that order, and falls back to software x264. You can override the choice, the bitrate and the x264 preset in Settings.
- **Broadcast Console.** One row per live stream: a health dot, a **Copy** button for its RTMP address (localhost or LAN), the viewer count, an inline preview, and **Rec**. The header shows FFmpeg's state and its live frame rate and bitrate.
- **Restream.** Add destinations for YouTube, Twitch, Kick, TikTok, Facebook or any RTMP/RTMPS server, then tick which live stream goes to which. Each relay is its own `ffmpeg -c copy` process, so nothing is re-encoded. A relay starts when its source goes live and stops when the source ends. Stream keys are encrypted on disk with Electron `safeStorage` and masked on screen.
- **Recording.** **Rec** copies a live stream to MP4 (`-c copy`, fragmented) in `Videos\RTMP-Hub-Recordings`.
- **External RTMP feeds.** Point OBS or any encoder at `rtmp://<host>:1935/live/<key>`, then **＋ Feed** pulls that stream in so it can join the grid.
- **Recovery.** If FFmpeg crashes, the pipe restarts after 2, 4 and 6 seconds, then stops and shows the error, with FFmpeg's last stderr lines written to `main.log`. A watchdog flags the grid broadcast if no video reaches FFmpeg for 3 seconds. Dropped relays go through one reconnect queue, one at a time, backing off from 1.5 up to 30 seconds.
- **Chat** between the host and guests, docked beside the console.

---

## How it works

```text
 Guest browser (phone or laptop)
   camera + mic
        |
        |  WebRTC, full mesh (simple-peer)
        |  signaling over Socket.IO on HTTPS :4001
        v
 Host PC: Electron admin window (React)
   stage tiles --> GridView <canvas> --> captureStream(30) --> MediaRecorder
                                         (VP8 WebM, 500 ms chunks)
        |
        |  Electron IPC
        v
 Host PC: Electron main process
   pipe-manager --> FFmpeg, one process per stream key (H.264 + AAC, FLV out)
        |
        v
 Node-Media-Server   rtmp://<host>:1935/live/<key>
        |
        +--> OBS / VLC pull the stream
        +--> Rec:   ffmpeg -c copy --> MP4
        +--> Relay: ffmpeg -c copy --> YouTube, Twitch, Kick, TikTok, Facebook, custom RTMP
```

1. **Signaling and mesh.** Everyone joins one Socket.IO room, `main-hub`. A newcomer sends offers to the peers already there (`packages/client/src/hooks/useWebRTC.ts`). The server forwards offers, answers and ICE candidates only for sockets that have joined.
2. **Composite.** `GridView.tsx` draws each `MediaStream` onto a `<canvas>` on every animation frame.
3. **Capture.** `canvas.captureStream(30)` feeds a `MediaRecorder` that emits VP8 WebM in 500 ms chunks. FFmpeg starts only when the first chunk arrives, because that chunk carries the WebM header and first keyframe; starting earlier produced "Discarding interframe without a prior keyframe" errors.
4. **Encode.** `pipe-manager.js` runs one FFmpeg process per stream key, fed through a `PassThrough` stream from Electron IPC. `ffmpeg-args.js` builds the command: Matroska input with a 5 MB probe, low-delay flags, the chosen encoder, a 30-frame GOP, FLV out to the local RTMP server.
5. **Serve.** Node-Media-Server accepts the FLV on `:1935` and serves it to RTMP players, with the last GOP cached.
6. **Fan out.** `broadcast-orchestrator.js`, `relay-manager.js` and `reconnection-supervisor.js` start a copy relay for each destination bound to a stream and keep it connected.

### Problems solved along the way

- **OBS and VLC wouldn't play the stream.** Two causes. FFmpeg was publishing video-only FLV, which both players silently rejected; the grid now carries a silent stereo AAC track from `aevalsrc=0`, and guest feeds carry their own audio as AAC. And players that joined late waited for the next keyframe; turning on Node-Media-Server's GOP cache (`gop_cache: true`) hands them the cached one right away. (See `CHANGELOG.md`, 1.0.1.)
- **A GPU encoder that isn't really there.** The `ffmpeg-static` build reports `h264_amf`, `h264_nvenc` and `h264_qsv` on every machine, whatever GPU it has. Choosing AMF on a non-AMD box failed with `amfrt64.dll failed to open` and crashed every broadcast pipe. Each encoder now has to pass a one-frame test encode before the app offers it (`canInitEncoder` in `packages/server/main.js`).
- **Trusting the host without trusting localhost.** In development, Vite proxies guests' Socket.IO traffic, so remote guests also arrive from `127.0.0.1`. The host skips the PIN because it presents a random token minted at startup and handed over only through Electron IPC, not because of its address.

---

## Quick start (from source)

### Requirements

- **Windows.** The packaging config targets Windows only. (CI runs the test suites on Ubuntu.)
- **Node.js 20.19 or newer.** CI uses Node 20.
- **Git.**
- **FFmpeg: nothing to install.** The app runs the binary from the [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) npm package, which `npm install` downloads.
- **A GPU is optional.** Without NVENC, AMF or QSV, FFmpeg encodes with x264 on the CPU.
- **Guests** need a browser with camera access on the same network as the host.

### Install and run

```bash
git clone https://github.com/NooRotic/rtmp-hub-spot.git
cd rtmp-hub-spot
npm install
npm run dev
```

`npm run dev` starts the Vite dev server on `https://localhost:4443`, waits up to 30 seconds for it, then launches Electron, which opens the admin window.

To bring in a guest, read the **Join** address in the admin top bar (`https://<LAN-IP>:4443` in development), open it on a phone or laptop on the same network, accept the certificate warning, allow the camera, and press **JOIN HUB**. If Windows asks whether to let Node.js or Electron through the firewall, allow private networks, or guests won't reach the host.

The defaults need no `.env` files. To change ports or the bind address, copy `packages/server/.env.example` to `packages/server/.env` (and `packages/client/.env.example` to `packages/client/.env`) and edit them. The in-app preview player expects HTTP-FLV on port 8000.

### Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the Vitest suites in every workspace (client, server, shared). |
| `npm run build` | Type-checks and builds the client (`tsc && vite build`). |
| `npm run release` | Builds the client, then a portable Windows `.exe` into `dist/` with electron-builder. Not usable on `main` yet; see [Status](#status). |
| `npm run docs` | Generates JSDoc for `packages/server/main.js` into `jsDocs/`. |

### Ports

| Port | Service | Notes |
|---|---|---|
| 4443 | Vite dev server (HTTPS) | Development only. Guests load the app here; their Socket.IO traffic is proxied to 4001. |
| 4001 | Signaling (HTTPS + Socket.IO) | The packaged app also serves the built client from here. |
| 1935 | RTMP (Node-Media-Server) | OBS, VLC, recordings and relays pull from here. |
| 8000 | HTTP-FLV (Node-Media-Server) | The in-app preview and **＋ Feed** tiles read it over `127.0.0.1`. |

---

## Use it with OBS or VLC

1. In the admin window, make sure the Combined Grid View is showing (**ENABLE GRID VIEW** on the stage toggles it), then click **START GRID BROADCAST** in its title bar.
2. The `grid` stream appears in the Broadcast Console under **SOURCES**. **Copy** puts `rtmp://127.0.0.1:1935/live/grid` on the clipboard; **use LAN** switches it to the host's LAN address for a second machine.
3. **OBS:** **Sources → + → Media Source**. Untick **Local File**, paste the address into **Input**, leave **Input Format** blank (or type `flv`), set **Network Buffering** to 1 or 2 MB, and tick **Restart playback when source becomes active**.
4. **VLC:** **Media → Open Network Stream**, then paste the address.
5. To send one guest on their own, click **BROADCAST** on their tile. Their stream is `live/feed-<name>`.

If a source stays black in OBS, toggle its visibility (the eye icon) to force a reconnect.

**Audio.** The grid's audio track is silent: the canvas has no sound, and the silent track is there so OBS and VLC accept the stream. Each `feed-<name>` stream records the guest's camera and microphone, and FFmpeg encodes the audio as AAC at 128 kbps. To bring a guest's voice into OBS, add their feed as another Media Source.

<!-- PLACEHOLDER (plan 004, PR-4): OBS Media Source settings screenshot. Suggested file: docs/media/obs-media-source.png, 1600 px wide PNG. Not in the repo yet. -->
> _Screenshot to come: the OBS Media Source dialog set up for the hub's RTMP address._

---

## Free and Pro

- **Free (built):** relay any live stream to the destinations you add, with `-c copy`, so each relay remuxes instead of re-encoding.
- **Pro (planned, not built):** a per-destination transcode and a per-destination watermark, which need decode, overlay and re-encode for each destination. The data types are reserved in `packages/shared/index.ts`, and the Settings drawer shows the watermark option disabled.

---

## Security model

RTMP Hub Spot is built for a local network you trust. This is what `main` does today.

**In place:**

- **LAN by default.** The servers bind `0.0.0.0` so phones on the same Wi-Fi can reach them. Set `RHS_BIND_LOOPBACK=1` to bind to `127.0.0.1` only, or `BIND_IP` to pick one address. There is no TURN server, and nothing is set up for guests outside the local network.
- **Room PIN, optional.** Set it in **⚙ Settings → Room Access**. The server checks it before a guest can join the room or see who is in it, and the top bar shows 🔒 while a PIN is set. Five wrong tries from one address lock that address out for 60 seconds. The PIN is saved in the app's user-data folder.
- **Host exempt by token.** The host window skips the PIN by presenting a per-launch token it gets over Electron IPC (see above). Address alone earns no trust.
- **Joined sockets only.** The server ignores offers, answers, ICE candidates and chat from sockets that haven't joined the room, and accepts **✕** (kick) only from the host.
- **Destination keys encrypted** on disk with Electron `safeStorage`.
- **Electron settings.** The renderer runs with `contextIsolation`, `sandbox` and no `nodeIntegration`, reaches the main process only through a preload bridge, and gets a Content-Security-Policy header. Self-signed certificates are trusted only for loopback hosts.

**Certificate step for guests.** The guest page is HTTPS with a self-signed certificate, because browsers allow camera access only on secure pages. The browser warns first: choose **Advanced**, then **Proceed** (the wording varies by browser). Without that step the camera stays blocked. The signaling server makes a new certificate at every launch, so with the packaged app guests accept it again after each restart.

**Not protected yet:**

- **No PIN by default.** With no PIN saved, anyone on the network who opens the join address can join. Set a PIN before guests arrive.
- **RTMP publishing on 1935 has no authentication.** Anyone on the network can publish to `rtmp://<host>:1935/live/<key>`, including `grid`, and a stream with relays bound to it goes out to those platforms.
- **HTTP-FLV on 8000 is open to the network,** so anyone on it can watch a live stream at `http://<host>:8000/live/<key>.flv`. (RTMP playback on 1935 is open on purpose, so OBS on another machine can pull.)
- **Server status goes to every connected socket,** joined or not, including the host's LAN address, live stream names and publisher addresses.

Fixes for the first three are planned as PR-2 and PR-3 in [`docs/plans/004-release-p1-execution.md`](docs/plans/004-release-p1-execution.md).

---

## Project layout

```text
packages/
  client/   React 18 + Vite + TypeScript: the admin UI (AdminApp) and the guest page (ClientPortal), one bundle
  server/   Electron main process: Node-Media-Server, Socket.IO signaling, FFmpeg pipes and relays
  shared/   TypeScript types used by both (streams, destinations, bindings, relay status)
docs/       release checklist, plans, design specs, handoff notes
```

| File | Role |
|---|---|
| `packages/server/main.js` | Electron entry: window, Node-Media-Server config, signaling, IPC, recording, encoder probe |
| `packages/server/pipe-manager.js` | One FFmpeg process per stream key, restart with backoff |
| `packages/server/ffmpeg-args.js` | FFmpeg flags per encoder, and the audio handling |
| `packages/server/relay-manager.js`, `broadcast-orchestrator.js`, `reconnection-supervisor.js` | Copy relays to destinations and their reconnect queue |
| `packages/server/room-pin.js` | PIN check and lockout |
| `packages/client/src/hooks/useWebRTC.ts` | Signaling and the simple-peer mesh |
| `packages/client/src/components/GridView.tsx` | Canvas compositor and the MediaRecorder-to-IPC pipe |
| `packages/client/src/admin/console/BroadcastConsole.tsx` | Sources, destinations and routing |

**Tests:** 73 Vitest test files (58 client, 14 server, 1 shared) run in CI on every push and pull request to `main`. The WebRTC mesh and live broadcasting are checked by hand on real devices; the test suite doesn't cover them.

**Look:** a dark version of Windows NT 4.0 (bevelled windows, navy title bars, Tahoma), with windows you can drag and resize inside the stage.

---

## License

MIT. See [LICENSE](LICENSE).

Built by Walter Pollard Jr ([@NooRotic](https://github.com/NooRotic)).
