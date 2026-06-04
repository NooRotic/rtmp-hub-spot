# Multi-Stream Pro — Admin UI Redesign (Design Spec)

- **Date:** 2026-06-04
- **Branch:** `feat/multi-stream-ui`
- **Status:** Design approved (visuals + IA via visual-companion brainstorm); ready for implementation plan.
- **Supersedes for this phase:** the "Windows NT 4.0 identity is fixed" framing in `CLAUDE.md`. The NT look was an experiment; this redesign keeps the *NT structure* but in **dark mode** with semantic color.

## 1. Goal & context

The restream backend (one source → N external RTMP destinations via `-c copy` relays) is merged to `main` and live-verified, but has **no UI** — destinations and bindings are only reachable through devtools IPC. This redesign builds the operator UI over the existing 3-level telemetry contract and, in the process, reorganizes the ~1,110-line `App.tsx` god component (audit finding #2) into a tabbed workspace.

The UI is a **pure function of the 3-level hierarchy** already emitted by the backend:
- **L1 Server** — `server-status` (clients, publishers, IPs).
- **L2 Source** — `ffmpeg-status` / `ffmpeg-stats`, keyed by `streamKey` (`grid`, `feed-*`).
- **L3 Relay** — `relay-status` / `relay-stats`, keyed by `(sourceKey, destinationId)`. (New layer.)

## 2. Locked decisions

| # | Decision |
|---|---|
| D1 | **Structure:** reorganize the admin into a tabbed workspace (approach B), decomposing `App.tsx`. |
| D2 | **Visual language:** "dark-mode NT" — retro beveled chrome + navy title bars, dark palette, **white highlight edge** on fields, **field borders colored to status**. |
| D3 | **Top priority:** copying the hub's own RTMP ingest routes is a first-class, one-click action everywhere a source appears. |
| D4 | **Preview:** ship **B-core** (one in-app preview monitor + source selector). **B-detach** (pop-out to a 2nd OS window) is deferred. |
| D5 | **Watermark/Pro = option C:** Free streams carry a small **removable** RTMP-Hub brand mark; **Pro** removes it *and* adds custom per-destination logos. Pro controls ship **visible-but-locked** in the MVP. |
| D6 | Requirements throughout: at-a-glance type sizing, real semantic color, plain-language naming (no "CONNECT EXT FEED" / raw stream-key jargon). |

## 3. Visual language (dark-NT)

A small primitives layer encodes the look once (tokens in `index.css` as dark-mode variables):
- **Window:** face `#2b2b2b`; bevel = light top-left highlight (`#585858`) + dark bottom-right shadow (`#0a0a0a`) + drop shadow. Title bar keeps NT navy gradient (`#000064→#0a59b0`).
- **Field:** dark inset (`#141414`) with a **white inner highlight edge** (`inset 1px 1px rgba(255,255,255,.55)`) and a **2px status-colored border**.
- **Status palette (border + dot + text, redundant encoding):** live `#2ee06a` · reconnecting/warn `#f0a020` · error `#ff4d4d` · idle/disabled `#555`.
- **Buttons:** beveled; primary `.go` variant is green. Copy buttons use `.go`.

Status is always encoded **three ways** (border color + dot + text label) for at-a-glance reading and color-vision accessibility.

## 4. Information architecture

**Top, always visible:** App title bar (existing chrome) → **Server status strip** (L1: Hub/Signaling LEDs, Local IP, Clients, Publishers, plus a rollup "● N sources live → M destinations").

**Tabs:** `Live` · `Destinations` · `Recordings` · `Settings`.

- **Live** (default, the operating view) — two panes:
  - *Left (≈38%):* **Preview Monitor** (B-core: "Watching: [source ▾]", pop-out shown disabled "(soon)") + **Clients & Feeds** (peers with grid/spotlight/kick chips, "＋ Add camera feed").
  - *Right (≈62%):* **Sources & Routes** — one card per source, each with status pill + **copy-able Ingest URL** + its **Destination** health rows + "＋ Add destination".
- **Destinations** — the destination *library* (CRUD): add/edit/remove/enable platforms. Rare setup, kept out of the operating view.
- **Recordings** — existing recordings panel (active recordings, REC/STOP, open folder).
- **Settings** — broadcast quality (bitrate/preset/encoder + GPU detect) and grid options (auto-layout, watermark, burn-in).

The new restream layer is split by *frequency of use*: **configure** destinations in their tab, **operate/copy/monitor** them on the Live source cards. Same data (`RtmpDestination` + `relay-status`), two views.

## 5. Component architecture

```
packages/client/src/
├─ App.tsx                      SLIM shell → <AdminWorkspace> | <ClientPortal>
├─ ui/                          NEW · dark-NT primitives (look defined once)
│   NTWindow · NTField · NTButton · StatusDot · StatusTag · CopyRouteField
├─ hooks/
│   useWebRTC (keep) · useMediaDevices (keep)
│   useElectronBridge   NEW  single isElectron+ipc (kills audit #9 dup)
│   useRelays           NEW  L3: relay-status/stats → Map<"src::destId", {state,stats}>
│   useDestinations     NEW  destinations + bindings CRUD (+ removeBinding/cascade)
│   useFfmpegPipeline   NEW  L2: ffmpeg-status/stats out of App
│   useRecordings       NEW  recording state + auto-stop sync
│   useBroadcastSettings NEW bitrate/preset/hwAccel + GPU + localStorage (fixes issue #5)
├─ admin/
│   AdminWorkspace · ServerStatusBar
│   live/  LiveView · PreviewMonitor · ClientsPanel · SourcesAndRoutes · SourceCard · DestinationRow
│   destinations/  DestinationsTab · DestinationForm · AddDestinationPicker
│   recordings/  RecordingsTab
│   settings/  SettingsTab
├─ client/  ClientPortal        NEW · extracts the browser-participant view from App
└─ components/  RtmpPlayerTile (extracted) · GridView · VideoFeed · ChatBox · Lobby  (keep)
```

**Unchanged on purpose:** `GridView` keeps owning canvas compositing + the MediaRecorder→FFmpeg pipe (delicate, out of scope). The single hardcoded `'main-hub'` room is untouched.

**Free wins (no extra scope):** audit #2 (god component), audit #9 (ipc dup), known issue #5 (settings persistence). `RtmpPlayerTile` (already in `App.tsx`) moves to its own file, reused by the preview monitor and the recordings preview.

## 6. State & data flow

**Event → hook → state → component**

| Channel | Hook | State | Renders |
|---|---|---|---|
| `server-status` (socket) | useWebRTC | `serverStatus` | ServerStatusBar |
| `ffmpeg-status`/`ffmpeg-stats` | useFfmpegPipeline | `Map<streamKey,…>` | SourceCard pill |
| `relay-status`/`relay-stats` | useRelays | `Map<"src::destId",…>` | DestinationRow |
| `destinations:list/add/update/remove` | useDestinations | `RtmpDestination[]` | DestinationsTab, picker |
| `bindings:list/set` | useDestinations | `DestinationBinding[]` | source↔destination rows |

**State ownership:** a thin `AdminDataProvider` context wraps `AdminWorkspace` and exposes `{ serverStatus, sources, relays, destinations, bindings, settings, actions }` via `useAdminData()`, avoiding prop-drilling through tabs.

**Source list derivation (no new IPC):** `sources = union(serverStatus.rtmpPublishers' keys, distinct sourceKeys in bindings)`. The union lets a source be **pre-wired** while offline and still surfaces anything currently publishing. A source's rows = `bindings.where(sourceKey==s && active)` ⋈ `useRelays` (health) ⋈ destination library (name/platform).

**"Add destination" flow:**
1. ＋ Add destination on a SourceCard → `AddDestinationPicker` (library, or "＋ New" → `destinations:add`).
2. Pick → `bindings:set({sourceKey, destinationId, active:true})`; optimistic row appears `connecting` (amber).
3. Backend persists **and** (gap G1) starts the relay if the source is live → `relay-status: connecting→live` reconciles the row green.
4. Failure → `relay-status: error` (reason) → row red.

**Copy-route:** `CopyRouteField` writes `rtmp://{host}:1935/live/{streamKey}` and flashes "copied!". A small **`localhost ⇄ LAN`** host toggle ensures the copied URL is right for local OBS vs a LAN device. (Outbound platform keys are *pasted in*, never copied out — opposite flow; keys are masked + encrypted.)

## 7. Backend changes required (small, TDD'd via existing DI seams)

The UI's core flow needs three server gaps closed. Today `bindings:set` only persists and `destinations:remove` doesn't cascade.

- **G1 — live add:** `bindings:set` must, when the source is currently publishing and the destination is enabled, enqueue that relay (inject `orchestrator` + an `isSourceLive(streamKey)` predicate backed by the NMS publisher set `main.js` already tracks). New `orchestrator.onBindingAdded(sourceKey, destination)`.
- **G2 — unbind stops relay:** setting a binding inactive (or `bindings:remove`) must stop that one relay. New `relayManager.stop(sourceKey, destinationId)`.
- **G3 — delete cascade:** `destinations:remove` must remove that destination's bindings (`store.removeBindingsForDestination`) and stop its relays across all sources (`relayManager.stopForDestination(id)`).

`destinationHandlers.js` signature extends from `(ipcMain, store)` to `(ipcMain, { store, orchestrator, relayManager, isSourceLive })`. Each is injectable → unit-testable Electron-free, matching the existing backend style.

## 8. Destinations & bindings UX

- **Library:** rows = platform badge, name, masked key, enabled toggle, edit/remove. Inline signals from the `platform` enum (e.g. Twitch "⚠ 6000k cap", Facebook "rtmps").
- **Add/Edit form:** **Platform → Ingest URL auto-prefills** (e.g. `rtmp://a.rtmp.youtube.com/live2`); name; **masked, encrypted** stream key; enabled; priority; a platform hint box. The relay must accept `rtmps://` (Facebook requires it — FFmpeg handles it; verify TLS build).
- **Binding picker** ("＋ Add destination → <source>"): checkbox the library destinations; "Bind N → start relays" calls `bindings:set` per pick (G1 starts relays if live). Disabled destinations are greyed/unpickable.

**Platform ingest reference** (RTMP publish = `{ingest}/{app}/{streamKey}`; key is a *path segment*, not a query param): YouTube `a.rtmp.youtube.com/live2`; Twitch `live.twitch.tv/app` (or regional); Facebook `rtmps://live-api-s.facebook.com:443/rtmp` (RTMPS required); Kick/TikTok = dashboard URL+key (TikTok access-gated); Instagram has no official RTMP.

## 9. Monetization / Pro affordances (ship locked in MVP)

The MVP renders Pro controls **visible but disabled** with an upsell — they reserve the data model and advertise the upgrade; they do nothing until the Pro transcode milestone.

- **Free brand watermark (option C):** a small removable "RTMP Hub" mark. Cheapest place is the **grid/source encode** (extends the existing canvas burn-in); on by default for Free. Caveat: a canvas-level mark also shows on local preview/recordings — acceptable for MVP; per-destination marks are Pro.
- **Pro (locked now, built later):** per-destination **custom watermark/logo** + per-destination **encode** (bitrate/resolution/fps). Both require decode→overlay→re-encode, impossible under Free's `-c copy` — which is *why* they're Pro.
- **Data model additions** (reserve now in `packages/shared/index.ts`): `WatermarkConfig { logoPath?/text?, position, opacity? }`; `EncodeOverride.watermark?: WatermarkConfig`; a Free-brand-watermark removal flag in app settings (Pro-gated).

## 10. Error & edge handling

- Relay state→UI: connecting/reconnecting = amber; **live = green but optimistic** (process up ≠ platform-confirmed); error = red + classified reason; idle/stopped = grey. No per-destination retry count (global backoff; contract omits it).
- Optimistic→reconcile: optimistic on action; `relay-status` is authoritative; a start-timeout flips a never-confirmed row to `error: failed to start`.
- Empty/zero states: no destinations → "Add your first destination"; live source, no bindings → "Not restreaming — ＋ Add destination".
- Resilience: on IPC/main reconnect, re-fetch `destinations:list` + `bindings:list`; UI defensively filters bindings whose destination is gone (atop G3 cascade).

## 11. Testing

- **No regressions:** existing 78 server / 40 client tests stay green.
- **New client unit tests** (vitest+jsdom, existing setup): `useRelays` (event→Map reducer), `useDestinations` (CRUD+optimistic), `useBroadcastSettings` (persistence); components `SourceCard` (renders 3-level), `CopyRouteField` (clipboard+feedback+host toggle), `DestinationRow` (status→border).
- **New server tests (G1–G3), TDD:** live-add enqueues when source publishing; unbind stops the relay; `destinations:remove` cascades + stops. Via existing DI seams.
- **Manual smoke:** add YouTube+Kick, rows light up, copy a route into OBS (same shape as the passed backend smoke).

## 12. Out of scope / deferred

- **B-detach** preview pop-out (separate OS window) — additive fast-follow.
- **Pro build-out** — actual per-destination transcode + watermark rendering (only locked UI ships now).
- **Goal C full matrix** (any source → any subset) — current binding model supports it in data, but UI optimizes for the common "grid → many platforms" case.
- **Room-PIN auth** (pre-public-launch, separate thread) and **Twitch Enhanced Broadcasting** (parked).

## 13. Risks / open questions

- **R1 — RTMPS verify:** confirm the bundled FFmpeg accepts `rtmps://` outputs (needed for Facebook). Low risk; standard TLS FFmpeg build.
- **R2 — Free watermark surface:** option C's canvas-level mark also marks preview/recordings. Confirm acceptable, or accept a small per-output cost to mark only outbound.
- **R3 — `isSourceLive` source of truth:** G1 needs a reliable "is this streamKey publishing now" predicate; bind it to the same NMS publisher tracking `server-status` uses to avoid a second source of truth.
- **R4 — Scope size:** this is both a feature (restream UI) and a refactor (god-component decomposition). The plan should sequence so the app stays runnable at each step (extract hooks behind current UI first, then re-skin), not a big-bang rewrite.
