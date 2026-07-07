# Dev Handoff — rtmp-hub-spot

_Last updated: 2026-07-07. **`main` is clean** @ `5a12e93` — the AdminApp refactor, WebRTC/NT-UX
work, and three follow-up fixes (PRs #14–#18) are all merged; feature branches deleted. Camera
switching, LAN-IP display, and the NT-window stage bounds are validated on real hardware. Active
branch: `chore/next-tasks` (no commits yet)._

> **▶ RESUME HERE — PAUSED 2026-07-07 for a job interview.** The current goal is **MVP / public
> release**. The full prioritized plan is **`docs/RELEASE-TODO.md`** (P1/P2/P3, with file:line refs).
> **Start with P1‑Packaging:** the shipped `.exe` is currently broken two ways — (1) `build.files`
> omits `room-pin.js`+`local-ip.js` so it won't launch, and (2) `ffmpeg-static` isn't `asarUnpack`ed so
> it can't broadcast. Both are ~30-min fixes. See RELEASE-TODO.md for the rest.

## What this project is
RTMP/WebRTC client-server hub with a retro WinNT UI. npm workspaces:
- `packages/client` — React 18 + Vite 5, the admin dashboard (`AdminApp`) and the participant view (`ClientPortal`). Runs in the Electron admin window and in browsers (`?role=admin` = monitor).
- `packages/server` — Electron main process + Socket.io signaling + Node Media Server (RTMP) + FFmpeg broadcast pipeline.
- `packages/shared`.

## Run / test / build
```
cd /m/dev/rtmp-hub-spot
npm run dev        # Vite client + Electron admin (concurrently)
# clients: open https://<LAN-IP>:4443 on another device, accept the cert
npm test           # client 259 + server 116 + shared 3 = 378, all green (2026-07-06)
npm run build      # tsc + vite build (client); 1 benign >500kB chunk warning
npx tsc -p packages/client --noEmit   # clean
```
- electron-log file (server-side logs incl. broadcast/ffmpeg): `C:\Users\NooRo\AppData\Roaming\server\logs\main.log` (electron-log uses the package name `server`, not the productName). Grep `[FFMPEG]` / `[GPU]`.
- Per-file vitest coverage gate is enforced on `AdminApp.tsx`.
- **WebRTC mesh + broadcast are NOT covered by the test suite** — they require a real 2-device manual retest.

## Current state (main @ 5a12e93)
No open PRs. On `main`:
- **AdminApp refactor** (#14) — `AdminApp.tsx` decomposed into hooks + zones + split context; the previously-dead `gridMembers` "Include Admin" / per-feed "Grid" checkboxes now gate the grid. Plan: `docs/plans/003-adminapp-refactor.md`.
- **WebRTC + NT-UX fixes** (#15) — admin→client video (relay `renegotiate` + live `userStreamRef`), late-joiner mesh stability, drag/resize NT windows, ClientPortal top-row layout, self-tile `(Self)` dedupe, USB-id stripped from the camera label.
- **Broadcast/encoder + logging** (#15) — runtime-verified GPU encoder probe (`canInitEncoder` drops `h264_amf` that fails init on a non-AMD box), NVENC default, log-noise reduction.
- **#16 camera switch** — swaps the outbound track in place (`routeStreamToPeer` → `replaceTrack`, not `addStream`), **releases the old camera before acquiring the next**, and **retries `getUserMedia` on transient `NotReadableError`** (`acquireStreamWithRetry`, 5×/200ms). Validated: Elgato switch lands first-try, right feed everywhere, old device releases.
- **#17 LAN IP** — `pickLocalIP` skips virtual adapters (Hyper-V/WSL/Docker); the UI shows the real `10.0.0.175` instead of a `172.x` vEthernet. Validated.
- **#18 NT stage box** — `[data-nt-stage]` scoped to the tiles+grid, *below* the camera/mic controls, so a window can't clamp over the controls. Validated.

## Open work (RESUME HERE)
1. **Grid broadcast — real-hardware pass still pending.** The runtime-verify encoder probe (#15) is the *suspected* root-cause fix for "broadcast silently dies," but a clean end-to-end grid-broadcast hasn't been confirmed. Start a grid broadcast, pull `rtmp://10.0.0.175:1935/live/grid` in VLC/OBS; if it fails, capture `…\Roaming\server\logs\main.log` (`[FFMPEG]`/`[GPU]`).
2. **Combined Grid View is draggable → can cover tiles.** Deferred by decision (memory: `gridview-draggable-revisit`). When revisited: make GridView resize-only (drop drag-move). Workaround meanwhile: clear `hub-pos-*` / `hub-size-*` in localStorage + reload.
3. **Housekeeping:** mark the `docs/plans/003` phases ✅ if not already.

## Release plan
See **`docs/RELEASE-TODO.md`** — the consolidated P1/P2/P3 release checklist from the 2026-07-06
security + packaging review. This file and RELEASE-TODO.md are now **committed to `main`** for
cross-session/cross-machine recovery.

## Untracked debug artifacts
`docs/debug/screenshot/*` (Walter's retest screenshots) are untracked — keep out of commits or gitignore them.
