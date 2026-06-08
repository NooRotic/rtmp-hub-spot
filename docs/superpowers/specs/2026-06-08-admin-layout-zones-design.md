# Admin layout redesign — zone-based (top bar · stage · broadcast console · drawers) — design

**Date:** 2026-06-08
**Branch:** new, off `main` (post room-PIN + socket-auth merges)
**Status:** approved design → implementation plan next

## Goal

Replace the single scrolling left sidebar (which stacks status + operating controls + the tabbed workspace + chat) with a **zone-based layout** organized by purpose and frequency: a global **top bar**, a video-dominant **stage**, a persistent **Broadcast Console** (sources + outputs with live health), and two on-demand **drawers** (chat, settings). Serves the two north stars — **glance-ability** and **effortless RTMP-route copy (#1)** — and the operator's real workflow: monitor feed health, restream to platforms.

## Resolved decisions (brainstorm)

- Direction: **top bar + stage + zones**, NOT a scroll sidebar. Principle: **no catch-all panel** — every old sidebar section relocates by purpose.
- Restream placement: **C — a horizontal dock under the stage**, promoted to a full **Broadcast Console**.
- Clients & Chat: **A — fully contextual.** Per-client actions live **on the stage tiles** (no separate "Connected Clients" list); **Chat is an on-demand drawer** with an **unread indicator** on its toggle.
- Monitoring (the old "Live" tab + "Active RTMP Links"): **first-class + persistent**, unified into the Broadcast Console's **Sources** lane; **expand-a-source for deep detail** (preview/REC/viewer detail) rather than a separate buried view.

## The five zones

```
┌─ TOP BAR (global, always visible) ─────────────────────────────────────────┐
│ ● Signaling  IP  Join https://…:4443  4→2   │  ＋Feed ⚙Settings 📁Rec 💬•  🔒 │
├────────────────────────────────────────────────────────────────────────────┤
│  STAGE — video grid (= the connected clients). Per-tile hover: ★ spotlight / │
│  ✕ kick / 🔇 mute. Slim toolbar: ▶ Start/Stop Broadcast · Grid layout · Share │
├─ BROADCAST CONSOLE (persistent, under the stage) ──────────────────────────┤
│ SOURCES (feeds OBS pulls)                           FFmpeg ● RUNNING 32fps   │
│  ● grid        rtmp://…/live/grid        📋  ▸2 viewers  3.3Mbps             │
│  ⚠ feed-guest  rtmp://…/live/feed-guest  📋  ▸0 · reconnecting…   ▸expand    │
│ ──────────────────────────────────────────────────────────────────────────  │
│ OUTPUTS (restream)   grid → ● YouTube live · ● Twitch live · ＋ add          │
└────────────────────────────────────────────────────────────────────────────┘
   💬 Chat drawer (right, on toggle)        ⚙ Settings drawer/modal (on toggle)
```

### §1 Top bar (global)
Extends today's `ServerStatusBar`: signaling dot · IP · **copyable Join URL** · sources→destinations rollup · 🔒 room-lock glyph. Adds a right action cluster: **＋ Add Feed** (opens a small dialog), **⚙ Settings** (drawer), **📁 Recordings** (drawer/popover with the active-recordings list + open-folder), **💬 Chat** (toggles the chat drawer; carries an **unread badge `•`/count** that lights when messages arrive while closed and clears on open). Everything here is global or low-frequency.

### §2 Stage
Today's main area (`GridView` + the Admin Video Hub camera/grid controls). The video grid is dominant and **is** the client roster — each tile gets **hover/click controls** (★ spotlight, ✕ kick [host-only], 🔇 mute) that replace the old "Connected Clients & Feeds" list. A slim **operating toolbar** on the stage: **▶ Start/Stop Broadcast**, grid-layout toggle, **Share to all**, and the camera/mic device pickers (or a compact device menu). `GridView`/`VideoFeed` internals (the MediaRecorder→FFmpeg pipe) are NOT changed — only their surrounding chrome + the per-tile control overlay.

### §3 Broadcast Console (persistent)
A horizontal deck under the stage = the broadcast I/O, always visible:
- **SOURCES lane** — one line per RTMP publisher/source (grid, feed-*, out-a/out-b): **health dot** (● active / ⚠ issue·reconnecting / ○ down), **route URL + 📋 one-click copy** (the #1 priority, right where you grab it for OBS), **viewer count** (is OBS pulling?), **bitrate**. A **▸ expand** per source reveals the inline RTMP **preview player + REC** + per-viewer detail (the old "Live Publishers" + "RTMP Viewers" content, on demand).
- **OUTPUTS lane** — source → destinations with **live relay dots** + **＋ add destination** (today's `DestinationsTab` logic: library + binding + relay status). Clicking a destination expands its manage controls (edit/unbind).
- **FFmpeg pipeline health** chip in the console header (RUNNING · fps · bitrate) — the broadcast's vital sign.

This unifies three old sidebar/tab sections (Active RTMP Links + Live Publishers + RTMP Viewers) into one console answering "are my feeds healthy and is OBS getting them?" at a glance, plus the restream outputs.

### §4 Chat drawer
Today's `ChatBox`, moved into a right-side **collapsible drawer** toggled from the top bar.
- **Open by default**, but the open/closed state **persists** (localStorage, e.g. `hub-chat-open`): once the admin collapses it, it **stays collapsed** across reloads until reopened. (Default `true` on first run.)
- The toggle shows an **unread indicator** (dot/count) that increments on new messages **while collapsed** and clears on open. (Requires tracking last-seen vs incoming `chatMessages`; the badge is only meaningful when closed, since an open drawer shows the messages.)

### §5 Settings drawer
The low-frequency config that was scattered, gathered into a **⚙ drawer/modal**: broadcast quality (bitrate/preset/encoder — today's `SettingsTab`), **Room PIN** (Room Access), **grid options** (include-admin / auto-layout / watermark / burn-in — from the old Grid Controls), the **Pro** watermark toggle, and **System Status** (NMS/WebRTC/RTMP diagnostics). Configure-once, out of the operating surface.

## Component & data mapping

**Data layer unchanged.** The provider/hooks architecture (`AdminDataProvider`/`useAdminData`, `useWebRTC`, `useDestinations`, `useRelays`, `useRecordings`, `useFfmpegPipeline`, `useBroadcastSettings`, `useRoomPin`) stays exactly as-is — this is a **presentation/layout restructure** that consumes the same data through new container components. That makes it lower-risk than it looks: no logic/state changes, just new layout containers + relocated rendering.

| Old surface | New home |
|---|---|
| `ServerStatusBar` | Top bar (extended with the action cluster) |
| `AdminWorkspace` tabs | Dissolved — its tabs redistribute below |
| `DestinationsTab` | Broadcast Console → OUTPUTS lane |
| `LiveTab` (FFmpeg health / publishers / viewers) | Console FFmpeg chip + SOURCES lane + per-source expand |
| `RecordingsTab` | 📁 Recordings drawer/popover (top bar) |
| `SettingsTab` | ⚙ Settings drawer |
| Sidebar: System Status | ⚙ Settings (diagnostics) |
| Sidebar: Connected Clients & Feeds | On-tile controls (stage) — no list |
| Sidebar: Grid Controls | ⚙ Settings (grid options) + stage toolbar |
| Sidebar: Add RTMP Feed | ＋ Add Feed dialog (top bar) |
| Sidebar: Active RTMP Links | Console → SOURCES lane (route + 📋 copy) |
| `ChatBox` | 💬 Chat drawer (+ unread badge) |
| `GridView` / `VideoFeed` | Stage (internals untouched; + per-tile control overlay) |

New container components (consume `useAdminData`): `AdminTopBar`, `BroadcastConsole` (+ `ConsoleSourceRow`, reusing the existing `RtmpPlayerTile` for expand), `ChatDrawer`, `SettingsDrawer`, `StageTileControls`. `AdminApp`'s render becomes a thin zone arranger.

## Phasing (one spec → phased plan)
1. **Top bar** — extend ServerStatusBar with the action cluster + drawer toggles (no-op toggles first).
2. **Settings drawer** — move SettingsTab + grid options + system status + room PIN into ⚙; remove from sidebar/tabs.
3. **Chat drawer + unread badge** — move ChatBox into 💬 drawer; add unread tracking.
4. **Broadcast Console** — build the dock: OUTPUTS (from DestinationsTab) + SOURCES (publishers/links/viewers) + FFmpeg chip + per-source expand (preview/REC).
5. **Stage tiles** — per-tile spotlight/kick/mute overlay; remove the Connected Clients list.
6. **Dissolve & arrange** — remove AdminWorkspace + the old sidebar; AdminApp render = the zones; responsive checks.

Each phase keeps the suite green + is independently eyeball-able (the UI stays usable between phases — e.g., a section moves but still works).

## Testing
Reuse the established pattern: container components consume `useAdminData` and are tested with the provider + a stub `AdminData` (like the existing tab tests); behavior assertions (toggles open drawers, copy fires, unread badge appears, source health renders, expand shows the player). The dark-NT primitives + tokens are reused. Full client + server suites stay green; per-phase eyeball.

## Non-goals
- No change to the data layer / hooks / provider, or to `GridView`/`VideoFeed` pipe internals (only chrome + control overlay).
- No new color tokens — reuse `.ntd-*`.
- ClientPortal (mobile participant) is already done — not touched.
- Not building new *features* (no new restream/recording capability) — this is a layout/IA reorganization of existing functionality.

## Success criteria
- The scroll sidebar is gone; admin content lives in the five zones by purpose.
- RTMP source health + route-copy + viewers are **persistently visible** in the Broadcast Console; a dropping feed shows ⚠ without a click.
- Restream outputs + relay status are always in view.
- Chat is on-demand with an unread heads-up; Settings/Recordings are top-bar drawers.
- Glance-ability + one-click route copy preserved/improved. Full suites green; dark-NT cohesive.
