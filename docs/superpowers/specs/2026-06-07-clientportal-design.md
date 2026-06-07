# ClientPortal — extraction + mobile dark-NT re-skin (design)

**Date:** 2026-06-07
**Branch:** `feat/client-portal` (off `main` @ 2da5898, the merged multi-stream UI arc)
**Status:** approved design → implementation plan next

## Goal

Turn `App.tsx` from a 3-mode god component into a thin router, extracting the browser-participant experience into a **self-contained `ClientPortal`**, then re-skin that participant view as a mobile-friendly dark-NT "join & go live" surface.

## Resolved decisions (brainstorm)

- **Q1 scope = C (both):** extract **and** re-skin, sequenced refactor-first then reskin.
- **Q2 participant look = C:** dark-NT **tokens**, **mobile-adapted chrome** — reuse the `.ntd` color/type language + primitives, but drop dense NT window-chrome and lay out for phones (the participant is the public, often-mobile audience reached via the Join URL).
- **Q3 depth = B (self-contained):** `ClientPortal` owns its own `useWebRTC` + participant state, not props from App.

## Key constraint (drives §1)

React hooks run before any conditional return, so App cannot keep calling `useWebRTC` at the top **and** have `ClientPortal` call its own — that would mount **two signaling connections** simultaneously. Therefore a self-contained `ClientPortal` forces App to call **no orchestration hooks itself**: App becomes a pure router that delegates the admin tree to a new `AdminApp` component and the participant tree to `ClientPortal`. Admin and participant modes are mutually exclusive (a window is either admin or client), so each component owns exactly one `useWebRTC` instance — no double-subscription.

## §1 Architecture — App becomes a router

- **`App.tsx`** shrinks to mode detection + routing only (no `useWebRTC`/state orchestration hooks):
  ```tsx
  // detect isElectron / isAdminMode (the existing checks, unchanged — do not simplify)
  if (isElectron || isAdminMode) return <AdminApp />;
  return <ClientPortal />;
  ```
  App may still own truly-global concerns that are mode-agnostic ONLY if needed; default is to push everything into the two children.
- **`AdminApp.tsx`** (new): a behavior-preserving *move* of App's current admin orchestration — its `useWebRTC` call, the Plan-2 hooks, `adminData` `useMemo`, `<AdminDataProvider>`, and the admin JSX (the app frame/title bar, `ServerStatusBar`, the dark-NT sidebar, `<AdminWorkspace/>`, the main-area window + `GridView`/`VideoFeed`, admin `ChatBox`). The browser **admin-monitor** mode (`isAdminMode && !isElectron`) lives here too — it is an admin surface. Nothing about admin behavior changes; it is relocated verbatim.
- **`ClientPortal.tsx`** (new): self-contained participant world — its own `useWebRTC('main-hub', { participant constraints })`, participant state (`userName`, selected camera/mic, `localCameraActive`, lobby gating `lobbyDone`, `isVideoEnabled`/`isAudioEnabled`, kick handling → back to lobby), the connect/disconnect + lobby-join handlers, and the participant UI.
- **Reused leaves, unchanged:** `Lobby`, `VideoFeed`, `ChatBox`, the `ui/` dark-NT primitives. **DRY:** do not duplicate `VideoFeed`/`ChatBox`/device-enumeration logic — `ClientPortal` consumes the same components/hooks (`useMediaDevices`) the admin path uses.

## §2 ClientPortal internals — two phases

- **Pre-join:** reuse `<Lobby>` (camera/mic permission preview + name capture) → on join, set name + advance to in-session. `wasKicked` returns the user to the lobby.
- **In-session (mobile-first):**
  - Dominant self-camera preview (`<VideoFeed>` with the participant's `userStream`).
  - Compact control bar: camera on/off, mic mute, connect/disconnect, a "● LIVE" status dot (reuse `StatusDot`/`StatusTag`).
  - Camera-error placeholder (the `cameraError` from `useWebRTC`, same as admin) shown in the preview area.
  - Chat (`<ChatBox>`), collapsible on narrow screens.

## §3 Re-skin — dark-NT tokens, mobile-adapted

- Root wrapped in `.ntd` scope so the dark tokens resolve.
- Single responsive column that stacks on phones; touch targets ≥44px; preview-dominant.
- Reuse `NTButton`/`StatusDot`/`StatusTag` (relaxed sizing for touch); dark-NT colors/type from the existing tokens. Drop the dense NT window-chrome (title bars, beveled insets) in favor of a clean stacked layout. Connecting/live shown via semantic dots, not a status table.
- No new color tokens — reuse `--ntd-*`.

## §4 Testing

- **`ClientPortal.test.tsx`:** renders the lobby pre-join; after join shows the in-session controls; camera-toggle + connect handlers fire. Mock `useWebRTC` (the pattern `LiveTab.test` used to mock `RtmpPlayerTile`) so the test is deterministic; the existing `test/setup.ts` already stubs `MediaStream`/`mediaDevices`.
- **`App.test.tsx`:** updated to assert routing — a browser participant renders `ClientPortal`; Electron/admin renders `AdminApp` (or its distinctive content). Minimal.
- **`AdminApp`:** a smoke test that it renders without crashing is sufficient (its internals are already covered by the admin/* suites).
- **`Lobby.test`:** unchanged.
- All client tests must stay green throughout (full suite is the regression net for the Phase-1 move).

## §5 Sequencing — one spec, phased plan

- **Phase 1 — refactor (behavior-preserving):** create `AdminApp` (move admin orchestration out of App), create `ClientPortal` owning its own `useWebRTC` + participant state, reduce `App` to the router. The participant view looks identical — just relocated and self-contained. Verified by the suite staying green + an eyeball that admin AND a browser participant still work. This isolates the risky hook-split before any visual change.
- **Phase 2 — re-skin:** mobile-adapted dark-NT layout inside the now-isolated `ClientPortal`. Eyeball-validated on a phone via the Join URL.

## Out of scope / deferred

- Admin view visual changes (it's done — Phase 1 only *moves* it).
- The OBS virtual-cam paid hook (separate future brainstorm — see memory `obs-integration-loe-and-virtualcam-hook`).
- Room-PIN auth (pre-existing pre-launch item).

## Success criteria

- `App.tsx` is a thin router (no orchestration hooks); admin + participant logic each live in a self-contained component with its own `useWebRTC`.
- Browser participant can join (lobby → camera → connect) and the in-session view is mobile-usable + cohesively dark-NT.
- Admin experience unchanged. Full client + server suites green. Build clean.
