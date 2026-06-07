# ClientPortal extraction + mobile dark-NT re-skin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `App.tsx` from a 3-mode god component into a thin router, extracting a self-contained `ClientPortal` (its own `useWebRTC` + participant state) and an `AdminApp` (the relocated admin orchestration), then re-skin `ClientPortal` as a mobile dark-NT join-&-go-live surface.

**Architecture:** React hooks run before any conditional return, so App can't keep calling `useWebRTC` while a child also does (→ double signaling). So: **lift App's whole body into `AdminApp` (App becomes hook-free), build a self-contained `ClientPortal`, then App routes** between them by mode. Admin and client never mount together → each owns exactly one `useWebRTC`. Phase 1 (T1–T3) is a behavior-preserving refactor verified by the green suite; Phase 2 (T4) re-skins the now-isolated `ClientPortal`.

**Tech Stack:** React 18 + TS, Vitest + jsdom, the `ui/` dark-NT primitives, existing hooks/components (`useWebRTC`, `useMediaDevices`, `usePersistence`, `Lobby`, `VideoFeed`, `ChatBox`).

**Source of truth:** `docs/superpowers/specs/2026-06-07-clientportal-design.md`. Branch `feat/client-portal` (off `main`).

**Refactor-move note:** T1 and parts of T2/T3 are *moves* of existing code, not rewrites. Where a step says "move … verbatim," reproduce the current code exactly (do not re-author it); the plan gives precise boundaries + verification rather than re-printing ~700 lines. `npm run test -w client` (34 files / 142 tests today) is the regression net — it must stay green after every task.

---

## State ownership map (from App.tsx today)

**Admin-only** (→ `AdminApp`): `useResizableSidebar`; `gridMembers`/`gridAutoLayout`/`spotlightId`/`previewOpen`/`toggleGridMember`; `adminCamActive`/`showGrid`/`gridStream`/`isGridShared`; `useBroadcastSettings`/`useRelays`/`useDestinations`/`useFfmpegPipeline`/`useRecordings`; `showWatermark`/`watermarkPos`/`showSettingsOverlay`; `syntheticFeeds`/`newFeedKey`/`newFeedLabel`/`feedPlayersRef` + synthetic-feed effect + `addSyntheticFeed`/`removeSyntheticFeed`; `refreshTelemetry` + telemetry interval; `gridStreams`/`allStreams`/`adminData` memos + `<AdminDataProvider>`; the admin-monitor auto-connect effect.

**Client-only** (→ `ClientPortal`): `localCameraActive`; `handleLobbyJoin`; the lobby-connect effect; the kick→lobby effect; the participant JSX.

**Each owns its OWN copy** (mutually exclusive, no sharing): `isElectron`/`ipc` (`useElectronBridge`), `isAdminMode`, `selectedVideo`/`selectedAudio`, `userName`, `useMediaDevices`, `usePersistence`, `lobbyDone`, `handleConnect`, and a mode-appropriate `useWebRTC` call.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/AdminApp.tsx` | Create | The relocated admin orchestration (verbatim move of App's current body): admin `useWebRTC` + all admin hooks/state/memos + `<AdminDataProvider>` + the admin JSX (app frame, ServerStatusBar, sidebar, AdminWorkspace, main area). |
| `packages/client/src/ClientPortal.tsx` | Create | Self-contained participant: own `useWebRTC` (client constraints), participant state, lobby flow, participant JSX. |
| `packages/client/src/ClientPortal.test.tsx` | Create | Lobby pre-join → in-session controls; camera/connect wiring (mocked `useWebRTC`). |
| `packages/client/src/App.tsx` | Modify | Reduce to a mode router (no orchestration hooks) + keep the `RtmpPlayerTile`/`localFlvUrl` re-export. |
| `packages/client/src/App.test.tsx` | Modify | Assert routing: participant→ClientPortal, electron/admin→AdminApp. |
| `packages/client/src/ui/dark-nt.css` | Modify (T4) | Mobile/touch ClientPortal classes. |

---

### Task 1: Lift App's body into `AdminApp` (App → hook-free wrapper)

**Files:**
- Create: `packages/client/src/AdminApp.tsx`
- Modify: `packages/client/src/App.tsx`

**Context:** Make App stop calling hooks (prereq for routing) by relocating its entire current implementation into `AdminApp` **verbatim**. After this task `App` renders `<AdminApp/>` for ALL modes — zero behavior change, suite stays green. (ClientPortal split happens in T2/T3.)

- [ ] **Step 1: Create `AdminApp.tsx` as a verbatim move of App's component**

Read `packages/client/src/App.tsx`. Create `packages/client/src/AdminApp.tsx` containing:
- ALL of App.tsx's imports EXCEPT the two `RtmpPlayerTile` lines (see Step 2). This includes `mpegts`, `localFlvUrl` (import from `./components/RtmpPlayerTile`), all hooks, components, `admin/*`, `ui/*`.
- The entire `function App() { … }` body, renamed to `function AdminApp() { … }`, byte-identical inside.
- `export default AdminApp;`
Adjust relative import paths only if they change (they don't — AdminApp.tsx sits in the same `src/` dir as App.tsx, so all `./...` paths resolve identically). Do NOT change any logic.

- [ ] **Step 2: Reduce `App.tsx` to a wrapper**

Replace App.tsx's entire content with:
```tsx
import AdminApp from './AdminApp';

// RtmpPlayerTile/localFlvUrl re-exported here for back-compat (App.rtmp-preview.test imports from './App').
export { RtmpPlayerTile, localFlvUrl } from './components/RtmpPlayerTile';

export default function App() {
  return <AdminApp />;
}
```
(Confirm `App.rtmp-preview.test.tsx` still imports `RtmpPlayerTile` from `./App` — the re-export keeps it valid.)

- [ ] **Step 3: Full suite + build**

Run: `npm run test -w client`
Expected: 34 files / 142 tests pass, 0 failures (pure move — `App.test` still renders `<App/>` → `<AdminApp/>` with identical output).
Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/AdminApp.tsx packages/client/src/App.tsx
git commit -m "refactor(client): lift App body into AdminApp; App becomes a hook-free wrapper"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: Build self-contained `ClientPortal`

**Files:**
- Create: `packages/client/src/ClientPortal.tsx` + `ClientPortal.test.tsx`

**Context:** A self-contained browser-participant component owning its OWN `useWebRTC` + participant state + the lobby flow. In Phase 1 it reproduces the CURRENT participant behavior/appearance (the `!isElectron && !isAdminMode` branches in AdminApp); Phase 2 (T4) re-skins it. It is NOT yet wired into App (T3 does that) — so it can be built + tested in isolation.

Read the participant-relevant code in `AdminApp.tsx` (the non-electron, non-admin branches): the device `<select>`s, the name input + `START/STOP CAMERA` + `CONNECT/DISCONNECT` controls, the self `<VideoFeed>` (with `userStream`, `isVideoEnabled`/`setIsVideoEnabled`, etc.), the `cameraError` placeholder, the `<ChatBox>`, the `<Lobby>` + live-banner, and the handlers `handleConnect`/`handleLobbyJoin` + the lobby-connect & kick effects.

- [ ] **Step 1: Write the failing test** — Create `packages/client/src/ClientPortal.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from './test/testUtils';

// Mock useWebRTC so the component is deterministic (no real signaling/getUserMedia).
const wrtc = {
  serverStatus: null, isConnected: false, socketStatus: 'disconnected', peers: [],
  userStream: null, cameraError: null,
  isVideoEnabled: true, setIsVideoEnabled: vi.fn(), isAudioEnabled: true, setIsAudioEnabled: vi.fn(),
  chatMessages: [], sendMessage: vi.fn(), disconnect: vi.fn(), connect: vi.fn(),
  recordingStopped: null, wasKicked: false, kickUser: vi.fn(), isLive: false,
};
vi.mock('./hooks/useWebRTC', () => ({ useWebRTC: () => wrtc }));

import { ClientPortal } from './ClientPortal';

beforeEach(() => { wrtc.connect.mockClear(); localStorage.clear(); });
afterEach(cleanup);

describe('ClientPortal', () => {
  it('shows the lobby (join) before joining', () => {
    render(<ClientPortal />);
    // Lobby renders a name input + a join control
    expect(document.querySelector('input')).toBeTruthy();
    expect(screen.queryByText(/start camera|stop camera/i)).toBeNull(); // not in-session yet
  });

  it('after joining the lobby, shows the in-session controls and connects', () => {
    render(<ClientPortal />);
    const name = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Tester' } });
    // Lobby's join button (label may be JOIN/Join/Go Live — match the actual Lobby control)
    fireEvent.click(screen.getByRole('button'));
    // now in-session: a camera control appears
    expect(screen.getByText(/start camera|stop camera/i)).toBeTruthy();
  });
});
```
NOTE: the join interaction depends on `Lobby`'s actual markup. READ `packages/client/src/components/Lobby.tsx` first and adjust the name-input/join-button selectors so the test drives the real Lobby. Keep the two assertions (pre-join shows lobby; post-join shows an in-session camera control). If `Lobby`'s join requires a permission-granted state that jsdom can't satisfy, instead test ClientPortal's in-session view directly by rendering with a forced post-lobby state — but prefer driving the real Lobby. Report which path you took.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w client -- ClientPortal`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `ClientPortal.tsx`**

Create `packages/client/src/ClientPortal.tsx`. It is the participant world, lifted from AdminApp's client branches and made self-contained. Structure:

```tsx
import { useState, useEffect, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useMediaDevices } from './hooks/useMediaDevices';
import { usePersistence } from './hooks/usePersistence';        // confirm exact path/name in App's imports
import Lobby from './components/Lobby';                          // confirm default vs named export
import VideoFeed from './components/VideoFeed';                  // confirm export style
import ChatBox from './components/ChatBox';

/** Self-contained browser-participant experience (lobby → join → in-session camera + chat). */
export function ClientPortal() {
  const [lobbyDone, setLobbyDone] = useState(false);
  const [userName, setUserName] = useState<string>(() => localStorage.getItem('hub-username') || '');
  const [selectedVideo, setSelectedVideo] = useState<string>(localStorage.getItem('hub-video-device') || '');
  const [selectedAudio, setSelectedAudio] = useState<string>(localStorage.getItem('hub-audio-device') || '');
  const [localCameraActive, setLocalCameraActive] = useState(false);
  const pendingConnectRef = useRef(false);

  usePersistence(selectedVideo, selectedAudio);
  const { videoDevices, audioDevices } = useMediaDevices();

  const {
    isConnected, peers, userStream, cameraError,
    isVideoEnabled, setIsVideoEnabled, isAudioEnabled, setIsAudioEnabled,
    chatMessages, sendMessage, disconnect, connect, wasKicked, isLive,
  } = useWebRTC('main-hub', {
    videoId: localCameraActive ? (selectedVideo || undefined) : undefined,
    audioId: localCameraActive ? (selectedAudio || undefined) : undefined,
    userName,
    cameraLabel: videoDevices.find(d => d.deviceId === selectedVideo)?.label || 'Default Camera',
    captureVideo: localCameraActive,
    overrideStream: null,
  });

  const handleConnect = () => {
    if (!userName.trim()) { alert('Please enter your name before connecting.'); return; }
    localStorage.setItem('hub-username', userName);
    connect();
  };
  const handleLobbyJoin = (name: string) => {
    setUserName(name);
    localStorage.setItem('hub-username', name);
    setLocalCameraActive(true);
    setLobbyDone(true);
    pendingConnectRef.current = true;
  };

  // connect once lobby set the name (state update is async → ref flag), mirrors AdminApp
  useEffect(() => {
    if (pendingConnectRef.current && lobbyDone && userName) {
      pendingConnectRef.current = false;
      connect();
    }
  }, [userName, lobbyDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // kicked → back to lobby
  useEffect(() => {
    if (wasKicked) { setLobbyDone(false); setLocalCameraActive(false); }
  }, [wasKicked]);

  if (!lobbyDone) {
    return <Lobby onJoin={handleLobbyJoin} initialName={userName} wasKicked={wasKicked} />;
  }

  // In-session participant view — reproduce the CURRENT client JSX from AdminApp's
  // `!isElectron && !isAdminMode` branch: device selects, name input + START/STOP CAMERA +
  // CONNECT/DISCONNECT, the cameraError placeholder, the self VideoFeed (userStream), ChatBox,
  // and the "YOU ARE LIVE" banner. Use the SAME dark-NT classes it currently uses (ntd-field /
  // ntd-btn). Keep all handler wiring identical (setLocalCameraActive, handleConnect/disconnect,
  // setSelectedVideo/Audio, setIsVideoEnabled, sendMessage). Phase 2 re-skins this block.
  return (
    <div className="ntd" style={{ /* container — phase 2 makes this mobile-first */ }}>
      {isLive && <div className="live-banner">◉ YOU ARE LIVE</div>}
      {/* …participant controls + cameraError placeholder + <VideoFeed .../> + <ChatBox …/> … */}
    </div>
  );
}
```
IMPORTANT for Step 3:
- VERIFY the exact import styles by reading AdminApp's imports (e.g. is `Lobby`/`VideoFeed`/`ChatBox` a default or named export? what's the `usePersistence` path?). Match them.
- Reproduce the participant in-session JSX faithfully from AdminApp's client branch (the `else` arm at the controls + the `userStream && <VideoFeed>` area + the `cameraError` placeholder + `{!isElectron && <ChatBox>}`). Same classes, same handlers. This is a MOVE of that JSX into ClientPortal's own state.
- Do NOT include any admin-only state/JSX (no grid, no broadcast settings, no synthetic feeds).
- `localStorage` keys must match existing (`hub-username`, `hub-video-device`, `hub-audio-device`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w client -- ClientPortal`
Expected: PASS (2 tests).

- [ ] **Step 5: Build + full suite**

Run: `npm run build` → clean. `npm run test -w client` → 0 failures (ClientPortal isn't wired into App yet; nothing else changed).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/ClientPortal.tsx packages/client/src/ClientPortal.test.tsx
git commit -m "feat(client): self-contained ClientPortal (own useWebRTC + lobby + participant view)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 3: App routes by mode; prune dead client branches from `AdminApp`

**Files:**
- Modify: `packages/client/src/App.tsx`
- Modify: `packages/client/src/App.test.tsx`
- Modify: `packages/client/src/AdminApp.tsx`

**Context:** Wire the router and remove the now-unreachable participant code from `AdminApp` (AdminApp only renders for Electron/admin after this).

- [ ] **Step 1: Make App the router**

Replace `App.tsx`'s component (keep the re-export line) with:
```tsx
import AdminApp from './AdminApp';
import { ClientPortal } from './ClientPortal';
import { isElectron } from './hooks/useElectronBridge';

export { RtmpPlayerTile, localFlvUrl } from './components/RtmpPlayerTile';

function isAdminRole(): boolean {
  if (isElectron) return true;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('role') === 'admin';
}

export default function App() {
  return isAdminRole() ? <AdminApp /> : <ClientPortal />;
}
```
VERIFY: `isElectron` is exported from `./hooks/useElectronBridge` as a value (the spec says `useElectronBridge` exports `isElectron`). If it's only available via the hook, call the hook here instead (App calling ONE trivial hook is fine — the constraint is App must not call `useWebRTC`/orchestration hooks, and `useElectronBridge` is a cheap bridge accessor). Match the existing `isAdminMode` logic from AdminApp exactly (the `?role=admin` check) — do not simplify the Electron detection (project rule).

- [ ] **Step 2: Update `App.test.tsx`**

Read the current `App.test.tsx`. It renders `<App/>` and asserts on content. Update its assertions to the routing behavior:
- In the default jsdom env (`isElectron` false, no `?role=admin`) → App renders `ClientPortal` → assert a participant/lobby marker is present (e.g. the lobby name input, or text the Lobby/ClientPortal shows) and that an admin-only marker (e.g. "System Status" / "Admin Video Hub") is ABSENT.
- Keep it minimal; if the old test asserted admin content that now only renders under `?role=admin`/Electron, replace those assertions with the participant-routing assertion. Report what you changed.
(If simulating Electron/admin in the test is awkward, one routing assertion — default env renders ClientPortal not AdminApp — is sufficient.)

- [ ] **Step 3: Prune dead client branches from `AdminApp`**

In `AdminApp.tsx`, AdminApp now only renders for Electron or `?role=admin`. Remove the now-unreachable participant-only code:
- `localCameraActive` state + its uses; `handleLobbyJoin`; the lobby-connect effect (the `pendingConnectRef`/`lobbyDone` participant path — KEEP what admin-monitor needs: `lobbyDone` is initialized `true` for admin, and the admin-monitor auto-connect effect stays); the kick→lobby effect (`wasKicked && !isAdminMode` — unreachable now since AdminApp is always admin → remove); the `<Lobby>` render (`!isAdminMode && !lobbyDone` — unreachable → remove); the live-banner (`!isElectron && !isAdminMode` → remove); the client `else` arm of the controls (the name input + START CAMERA + CONNECT branch) and the `{!isElectron && <ChatBox>}` client chat.
- Simplify the controls block: it now only needs the Electron branch and the `isAdminMode` (monitor) branch — the `else` (participant) arm is dead.
- Be surgical: only remove code unreachable when `isElectron || isAdminMode` is always true. Anything still used by Electron OR admin-monitor stays. After removing, fix any now-unused imports/vars the build flags.
VERIFY by reading: AdminApp must still fully render the admin experience (frame, ServerStatusBar, sidebar, AdminWorkspace, main area incl. the admin self `VideoFeed` + GridView + admin ChatBox). Do not touch admin logic.

- [ ] **Step 4: Full suite + build**

Run: `npm run test -w client`
Expected: 0 failures. (App.test now asserts routing; everything else green.)
Run: `npm run build`
Expected: clean (no unused-var/import errors from the prune).

- [ ] **Step 5: Manual eyeball (behavior-preserving checkpoint)**

Run `npm run dev`. Verify BOTH paths still work, identical to before:
- Admin (Electron window): frame/sidebar/AdminWorkspace/main area all present and functional.
- Participant: open `https://<LAN-IP>:4443` (no `?role=admin`) in a browser → lobby → join → camera + connect + chat work (same look as before — re-skin is T4).
THIS is the Phase-1 done gate: the refactor changed structure, not behavior.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/App.test.tsx packages/client/src/AdminApp.tsx
git commit -m "refactor(client): App routes admin↔client by mode; prune dead client branches from AdminApp"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: Mobile dark-NT re-skin of `ClientPortal` (Phase 2)

**Files:**
- Modify: `packages/client/src/ClientPortal.tsx`
- Modify: `packages/client/src/ui/dark-nt.css`

**Context:** Now that the participant view is isolated, give it a mobile-first dark-NT layout (spec §3): single responsive column, preview-dominant, touch targets ≥44px, reuse `.ntd` tokens + primitives, drop dense window-chrome. Presentational — behavior/handlers unchanged; ClientPortal.test stays green.

- [ ] **Step 1: Add mobile ClientPortal CSS**

Append to `packages/client/src/ui/dark-nt.css`:
```css
/* ClientPortal — mobile-first participant surface. */
.ntd-portal { min-height: 100vh; background: var(--ntd-face); color: var(--ntd-text); display: flex; flex-direction: column; gap: 12px; padding: 16px; box-sizing: border-box; max-width: 720px; margin: 0 auto; }
.ntd-portal__preview { width: 100%; background: #000; border: 2px solid var(--ntd-sh); aspect-ratio: 16/9; }
.ntd-portal__bar { display: flex; flex-wrap: wrap; gap: 10px; }
.ntd-portal__bar .ntd-btn { flex: 1 1 auto; min-height: 44px; font-size: 14px; }
.ntd-portal__field { min-height: 44px; font-size: 16px; } /* 16px avoids iOS zoom-on-focus */
.ntd-portal__chat { margin-top: auto; }
@media (max-width: 520px) { .ntd-portal { padding: 10px; gap: 10px; } }
```

- [ ] **Step 2: Apply the layout in `ClientPortal.tsx`**

Restructure the in-session JSX (NOT the handlers/state) into the mobile layout:
- Root: `<div className="ntd ntd-portal">`.
- Live banner (if `isLive`): a dark-NT status row with a `StatusDot`/`StatusTag` (reuse `../ui/StatusTag`) reading "● LIVE" instead of the old `.live-banner`.
- Preview: the self `<VideoFeed>` (or the `cameraError` placeholder when `cameraError && !userStream`) inside `.ntd-portal__preview`.
- Controls: name input (`.ntd-field ntd-portal__field`), device selects (`.ntd-field`), and a `.ntd-portal__bar` of `NTButton`s (camera on/off, mic mute, connect/disconnect) with touch sizing.
- Chat: `<ChatBox>` in `.ntd-portal__chat` (it's already dark-NT from the earlier ChatBox re-skin).
Reuse `NTButton`/`StatusDot`/`StatusTag` from `../ui/*` (DRY — no bespoke buttons). Keep every handler/value/checked identical.

- [ ] **Step 3: Verify**

Run: `npm run test -w client -- ClientPortal` → still passes (markers preserved: a name input pre-join; a camera control in-session).
Run: `npm run test -w client` → 0 failures. `npm run build` → clean.

- [ ] **Step 4: Manual eyeball (phone)**

`npm run dev`, open `https://<LAN-IP>:4443` on a phone (use the admin's **Join URL**). Verify: lobby → join → big camera preview, big touch buttons, readable dark-NT, chat usable, "● LIVE" when broadcasting. Refine spacing/touch sizing here (CSS only).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ClientPortal.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(ui): mobile dark-NT re-skin of ClientPortal (join & go-live surface)"
```
(+ `Co-Authored-By` trailer.)

---

## Self-Review

**Spec coverage:**
- §1 App→router + AdminApp + self-contained ClientPortal each with own useWebRTC → T1 (lift), T2 (ClientPortal), T3 (router + prune). ✅
- §2 ClientPortal phases (lobby → in-session) → T2 (lobby gating + in-session JSX). ✅
- §3 mobile dark-NT reskin → T4. ✅
- §4 testing (ClientPortal.test, App.test routing, suite green) → T2 Step 1, T3 Step 2, every task's suite run. ✅
- §5 sequencing (Phase 1 refactor T1–T3 behavior-preserving; Phase 2 reskin T4) → matches. ✅

**Placeholder scan:** The refactor-move steps (T1 verbatim move; T2/T3 reproduce/prune existing JSX) intentionally reference "the current code" rather than reprinting ~700 lines — this is the correct granularity for a behavior-preserving move, and each is bounded + verified by the green suite + eyeball. T4's CSS/skeletons are concrete; final spacing is the documented eyeball step. Concrete code is given for the new bits (App router, ClientPortal scaffold + client useWebRTC options, tests, CSS).

**Type/name consistency:** `useWebRTC('main-hub', {...})` client options mirror App.tsx:163-170's non-electron branch exactly (videoId/audioId gated on `localCameraActive`, `captureVideo: localCameraActive`, `overrideStream: null`). `isElectron`/`isAdminMode` detection reproduced verbatim (project rule: don't simplify). localStorage keys (`hub-username`/`hub-video-device`/`hub-audio-device`) match. Re-export of `RtmpPlayerTile`/`localFlvUrl` from `./App` preserved for `App.rtmp-preview.test`. Imports (Lobby/VideoFeed/ChatBox default-vs-named, usePersistence path) flagged to verify-on-read in T2.

**Risk note:** T1 is the riskiest (large verbatim move) but the lowest-logic (no behavior change, full suite is the net). T3's prune must be surgical — the step enumerates exactly which participant-only branches are now dead.
