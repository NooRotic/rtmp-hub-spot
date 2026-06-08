# Room-PIN auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight, server-validated shared room PIN: the host sets/clears it from the admin UI (persisted), participants enter it in the lobby, and the signaling server admits remote joins only with the correct PIN — loopback (the local host) is always exempt.

**Architecture:** A pure `room-pin.js` module (PIN state + loopback check + brute-force throttle, all dependency-injected → unit-testable without Electron) is the testable core; `main.js` wires it (load/persist via `userData`, IPC set/get, and a gate call inside `join-room`). The client threads a `pin` through `Lobby → ClientPortal → useWebRTC`'s `join-room` emit and reacts to a `join-denied` event; the admin gets a "Room Access" control + a lock glyph.

**Tech Stack:** Node (Electron main + Socket.IO), Vitest (server + client/jsdom), React 18 + TS, the existing IPC bridge + dark-NT `ui/` primitives.

**Source of truth:** `docs/superpowers/specs/2026-06-07-room-pin-auth-design.md`. Branch `feat/room-pin-auth` (off `main`). Decisions: Q1–Q4 all = A (lightweight shared PIN / host-set+persisted+default-open / loopback-exempt / always-present optional lobby field).

**Codebase patterns:** server logic lives in extracted modules (`reconnection-supervisor.js`, `relay-manager.js`, …) wired by `main.js`; those modules are what the 91-test server suite covers. PIN logic follows that pattern. `main.js` already `require('fs')` (line 21), uses `app.getPath(...)`, and `ipcMain.on/handle`. Client hooks take `ipc` as a DI param (testable with a fake). Run server tests: `npm run test -w server`; client: `npm run test -w client`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/server/room-pin.js` | Create | Pure room-gate: PIN state, `isLoopback`, throttle, `check()` — DI'd `now`, no fs/electron. |
| `packages/server/room-pin.test.js` | Create | Unit tests for the gate. |
| `packages/server/main.js` | Modify | Wire the gate: load/persist PIN (`userData/room-config.json`), IPC `set-room-pin`/`get-room-pin`, gate call in `join-room`. |
| `packages/server/preload.js` | Modify | Expose the new IPC channels (if the bridge allow-lists channels). |
| `packages/client/src/hooks/useWebRTC.ts` | Modify | `pin` option in `join-room` emit; `join-denied` listener → `joinDenied` state. |
| `packages/client/src/components/Lobby.tsx` | Modify | Optional PIN field; `onJoin(name, pin)`; denial error. |
| `packages/client/src/components/Lobby.test.tsx` | Modify | PIN field + onJoin(name,pin) + error. |
| `packages/client/src/ClientPortal.tsx` | Modify | Thread pin Lobby→useWebRTC; `joinDenied` → back to lobby. |
| `packages/client/src/ClientPortal.test.tsx` | Modify | Denial returns to lobby. |
| `packages/client/src/hooks/useRoomPin.ts` | Create | Admin hook: `{ locked, setPin, clearPin, refresh }` over `ipc`. |
| `packages/client/src/hooks/useRoomPin.test.tsx` | Create | Hook behavior (fake ipc). |
| `packages/client/src/admin/AdminDataProvider.tsx` | Modify | Add `roomAccess` slice to `AdminData`. |
| `packages/client/src/AdminApp.tsx` | Modify | Call `useRoomPin(ipc)`; feed `roomAccess` into `adminData`. |
| `packages/client/src/admin/tabs/SettingsTab.tsx` | Modify | "Room Access" section (set/clear PIN + locked indicator). |
| `packages/client/src/admin/tabs/SettingsTab.test.tsx` | Modify | Room Access control. |
| `packages/client/src/admin/ServerStatusBar.tsx` | Modify | 🔒/🔓 glyph next to the Join URL. |

---

### Task 1: `room-pin.js` pure gate module

**Files:**
- Create: `packages/server/room-pin.js` + `packages/server/room-pin.test.js`

**Context:** The testable core — PIN state, loopback detection, throttle, and a single `check(address, candidate)` decision. No `fs`/Electron (persistence is `main.js`'s job). `now` is injected for deterministic throttle tests.

- [ ] **Step 1: Write the failing test** — Create `packages/server/room-pin.test.js`:

```js
const { describe, it, expect } = require('vitest');
const { isLoopback, createRoomGate } = require('./room-pin');

describe('isLoopback', () => {
  it('recognizes loopback addresses', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  });
  it('rejects LAN/remote + empty', () => {
    expect(isLoopback('10.0.0.156')).toBe(false);
    expect(isLoopback('192.168.1.5')).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });
});

describe('createRoomGate', () => {
  it('open hub (no pin) admits anyone', () => {
    const g = createRoomGate();
    expect(g.isLocked()).toBe(false);
    expect(g.check('10.0.0.5', '').allowed).toBe(true);
  });
  it('locked hub admits correct pin, denies wrong/missing for remote', () => {
    const g = createRoomGate();
    g.setPin('1234');
    expect(g.isLocked()).toBe(true);
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
    expect(g.check('10.0.0.5', '9999')).toEqual({ allowed: false, reason: 'pin' });
    expect(g.check('10.0.0.5', '')).toEqual({ allowed: false, reason: 'pin' });
  });
  it('loopback is always admitted even when locked', () => {
    const g = createRoomGate();
    g.setPin('1234');
    expect(g.check('127.0.0.1', '').allowed).toBe(true);
    expect(g.check('::1', 'wrong').allowed).toBe(true);
  });
  it('clearing the pin reopens the hub', () => {
    const g = createRoomGate();
    g.setPin('1234'); g.setPin('');
    expect(g.isLocked()).toBe(false);
    expect(g.check('10.0.0.5', '').allowed).toBe(true);
  });
  it('throttles after 5 failed attempts then cools down; correct pin resets', () => {
    let t = 1000;
    const g = createRoomGate({ now: () => t, maxFails: 5, cooldownMs: 60000 });
    g.setPin('1234');
    for (let i = 0; i < 4; i++) expect(g.check('10.0.0.5', 'x')).toEqual({ allowed: false, reason: 'pin' });
    const fifth = g.check('10.0.0.5', 'x');
    expect(fifth).toEqual({ allowed: false, reason: 'pin', lockout: true });
    // within cooldown: blocked regardless of pin correctness
    expect(g.check('10.0.0.5', '1234')).toEqual({ allowed: false, reason: 'cooldown' });
    // after cooldown: correct pin works again
    t += 60001;
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
  });
  it('a correct pin before lockout resets the fail counter', () => {
    const g = createRoomGate();
    g.setPin('1234');
    g.check('10.0.0.5', 'x'); g.check('10.0.0.5', 'x');
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
    // counter reset → 4 more fails don't trip lockout
    for (let i = 0; i < 4; i++) g.check('10.0.0.5', 'x');
    expect(g.check('10.0.0.5', '1234').allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w server -- room-pin`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — Create `packages/server/room-pin.js`:

```js
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** True if the socket's remote address is local (the trusted host machine). */
function isLoopback(address) {
  return !!address && LOOPBACK.has(address);
}

/**
 * Room access gate: holds the shared PIN + per-IP brute-force throttle.
 * Pure (no fs/electron); inject `now` for deterministic tests. Persistence is the caller's job.
 */
function createRoomGate({ now = () => Date.now(), maxFails = 5, cooldownMs = 60000 } = {}) {
  let pin = '';
  const ipState = new Map(); // address -> { fails, cooldownUntil }

  return {
    setPin(p) { pin = (p || '').trim(); },
    getPin() { return pin; },
    isLocked() { return pin !== ''; },

    /**
     * Decide a join attempt. Returns { allowed, reason?, lockout? }.
     * - loopback: always allowed.
     * - within IP cooldown: { allowed:false, reason:'cooldown' }.
     * - open hub: allowed.
     * - correct pin: allowed (resets the IP's fail counter).
     * - wrong/missing pin: { allowed:false, reason:'pin' }, and { lockout:true } on the Nth fail.
     */
    check(address, candidate) {
      if (isLoopback(address)) return { allowed: true };

      const st = ipState.get(address);
      if (st && st.cooldownUntil > now()) return { allowed: false, reason: 'cooldown' };

      if (!pin) return { allowed: true };

      if ((candidate || '') === pin) {
        ipState.delete(address);
        return { allowed: true };
      }

      const fails = (st && st.fails ? st.fails : 0) + 1;
      if (fails >= maxFails) {
        ipState.set(address, { fails, cooldownUntil: now() + cooldownMs });
        return { allowed: false, reason: 'pin', lockout: true };
      }
      ipState.set(address, { fails, cooldownUntil: 0 });
      return { allowed: false, reason: 'pin' };
    },
  };
}

module.exports = { isLoopback, createRoomGate };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w server -- room-pin`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/room-pin.js packages/server/room-pin.test.js
git commit -m "feat(server): room-pin gate module (loopback-exempt + throttle, pure/testable)"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: Wire the gate into `main.js` (persist + IPC + join-room)

**Files:**
- Modify: `packages/server/main.js`
- Modify: `packages/server/preload.js` (only if it allow-lists IPC channels)

**Context:** Glue the pure gate to Electron: load/persist the PIN in `userData/room-config.json`, expose IPC to set/get it, and gate `join-room`. Not unit-tested directly (Electron main); covered by Task 1's module tests + build + the Task 7 eyeball.

- [ ] **Step 1: Load the gate + persisted PIN at startup**

In `main.js`, near the other requires (with `fs` at line 21), add:
```js
const { createRoomGate } = require('./room-pin');
const roomGate = createRoomGate();
const roomConfigPath = () => path.join(app.getPath('userData'), 'room-config.json');
function loadRoomPin() {
  try {
    const raw = fs.readFileSync(roomConfigPath(), 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg.roomPin === 'string') roomGate.setPin(cfg.roomPin);
  } catch (_) { /* no config yet = open hub */ }
}
function saveRoomPin(pin) {
  try { fs.writeFileSync(roomConfigPath(), JSON.stringify({ roomPin: pin || '' }), 'utf8'); }
  catch (e) { console.error('[RoomPin] persist failed:', e); }
}
```
Call `loadRoomPin()` once Electron is ready (where other startup runs — e.g. inside `app.whenReady().then(...)` or right after `app.getPath` is safe to call; place it alongside the existing server init). If unsure of the exact init point, call it lazily at the top of `initializeServer()` (read main.js to find that function) — `app.getPath('userData')` is valid once the app is ready, which it is by server init.

- [ ] **Step 2: Add the IPC handlers**

Alongside the other `ipcMain` handlers (e.g. near line 433/535), add:
```js
ipcMain.on('set-room-pin', (event, { pin } = {}) => {
  const next = (pin || '').trim();
  roomGate.setPin(next);
  saveRoomPin(next);
  console.log(`[RoomPin] ${next ? 'locked' : 'open'}`);
});
ipcMain.handle('get-room-pin', () => ({ locked: roomGate.isLocked() }));
```

- [ ] **Step 3: Gate `join-room`**

Replace the current handler head (`main.js:363`):
```js
    socket.on('join-room', ({ roomId, userName }) => {
      socket.join(roomId);
```
with the gated version (keep the rest of the body unchanged):
```js
    socket.on('join-room', ({ roomId, userName, pin }) => {
      const verdict = roomGate.check(socket.handshake.address, pin);
      if (!verdict.allowed) {
        socket.emit('join-denied', { reason: verdict.reason });
        if (verdict.lockout) socket.disconnect(true);
        console.log(`[Signaling] join denied (${verdict.reason}) for ${socket.handshake.address}`);
        return;
      }
      socket.join(roomId);
```
(Everything after `socket.join(roomId);` — `users[socket.id] = …`, `all-users`, `user-joined`, `broadcastStatus` — stays exactly as is.)

NOTE on `socket.handshake.address`: Socket.IO exposes the client address there. If behind the Vite dev proxy (`/socket.io` → `https://localhost:4001`), a participant's socket may appear as the proxy's address. VERIFY during the Task 7 eyeball that a LAN participant is treated as non-loopback (gated) and the Electron host as loopback (exempt). If the dev proxy masks the real address as loopback, document it as a dev-only artifact (production serves the client from the same Electron Express origin, no proxy) — the gate still holds in the packaged app. Report findings.

- [ ] **Step 4: Preload channels (only if needed)**

Read `packages/server/preload.js`. If it exposes IPC via an explicit channel allow-list (e.g. a `validChannels` array for `send`/`invoke`), add `'set-room-pin'` (send) and `'get-room-pin'` (invoke) to the appropriate lists. If preload forwards all channels generically, no change needed. Report which.

- [ ] **Step 5: Build + server suite**

Run: `npm run build` → clean.
Run: `npm run test -w server` → 0 failures (Task 1's module tests included; main.js wiring doesn't break existing server tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/main.js packages/server/preload.js
git commit -m "feat(server): wire room-pin gate into main.js (persist + IPC + join-room validation)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 3: `useWebRTC` — send the PIN, handle `join-denied`

**Files:**
- Modify: `packages/client/src/hooks/useWebRTC.ts`

**Context:** Add a `pin` option included in the `join-room` emit, and a `join-denied` listener that exposes `joinDenied` so the UI can react. There is no existing useWebRTC test harness; add a focused test if feasible, else rely on the ClientPortal/integration tests (Task 5) + the spec's behavior. Prefer a minimal test by mocking `socket.io-client` if the file is testable; otherwise document why and cover via Task 5.

- [ ] **Step 1: Add the `pin` option + emit it**

In `useWebRTC.ts`, the options object (around the hook signature / the `useWebRTC('main-hub', { … })` opts) gains `pin?: string`. Thread it like the other opts (they're captured in refs — follow the existing `userNameRef`/`cameraLabelRef` pattern: add a `pinRef` updated on opts change, OR read the latest via a ref). Then change the emit (`useWebRTC.ts:148`):
```ts
      socketRef.current.emit('join-room', { roomId: effectiveRoomId, userName: fullIdentity, pin: pinRef.current || '' });
```
(Use whatever ref/closure pattern the existing options use so the latest pin is sent on (re)connect.)

- [ ] **Step 2: Add the `join-denied` listener + state**

Add state near the other hook state: `const [joinDenied, setJoinDenied] = useState<{ reason: string } | null>(null);`. Clear it on a successful `connect`/join (in the `connect` handler set `setJoinDenied(null)` before emitting join-room). Add a listener (with the other `socketRef.current.on(...)` registrations):
```ts
    socketRef.current.on('join-denied', (info: { reason: string }) => {
      console.warn('[WebRTC] join denied:', info?.reason);
      setJoinDenied(info || { reason: 'pin' });
      addLocalStatus(`Join denied: ${info?.reason || 'pin'}`);
    });
```
Expose `joinDenied` in the hook's return object (add `joinDenied,` near `cameraError,`).

- [ ] **Step 3: (If testable) add a focused test, else document**

If a `useWebRTC` test can mock `socket.io-client` cleanly, add one asserting (a) `join-room` payload includes the pin and (b) a `join-denied` event sets `joinDenied`. If the hook's socket wiring makes an isolated unit test impractical (no existing harness), SKIP and note it — Task 5 (ClientPortal) covers the denial→lobby behavior with a mocked useWebRTC. Report which path.

- [ ] **Step 4: Full client suite + build**

Run: `npm run test -w client` → 0 failures (existing tests still pass; the new option is optional/back-compat). Run: `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/hooks/useWebRTC.ts
git commit -m "feat(client): useWebRTC sends room pin + exposes joinDenied"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: `Lobby` — optional PIN field + denial error

**Files:**
- Modify: `packages/client/src/components/Lobby.tsx` + `Lobby.test.tsx`

**Context:** Add an optional "Room PIN" field; change `onJoin` to `onJoin(name, pin)`; accept an error prop to show a denial message + keep the field focused for retry.

- [ ] **Step 1: Update the test** — In `Lobby.test.tsx`, read the current tests, then add/adjust:

```tsx
  it('passes the entered name AND pin to onJoin', () => {
    const onJoin = vi.fn();
    const { container } = render(<Lobby onJoin={onJoin} initialName="" />);
    const inputs = container.querySelectorAll('input');
    const name = inputs[0] as HTMLInputElement;
    const pin = container.querySelector('input[data-field="room-pin"]') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Ann' } });
    fireEvent.change(pin, { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: /join hub/i }));
    expect(onJoin).toHaveBeenCalledWith('Ann', '4321');
  });

  it('shows a denial error when deniedReason is set', () => {
    render(<Lobby onJoin={() => {}} initialName="Ann" deniedReason="pin" />);
    expect(screen.getByText(/requires a valid pin|wrong pin|invalid pin/i)).toBeTruthy();
  });
```
(Keep existing Lobby tests; update any that call `onJoin` with one arg — it now passes `(name, pin)`. Existing call sites that don't care about pin still pass name as arg 0.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w client -- Lobby`
Expected: FAIL — no pin field / onJoin arity.

- [ ] **Step 3: Implement** — In `Lobby.tsx`:
- Add a `pin` state (`useState('')`).
- Add `deniedReason?: string` to the props.
- Add an optional PIN input below the name (reuse the same input styling the name field uses), with `data-field="room-pin"`, placeholder "Room PIN (leave blank if not provided)".
- Change the join handler to call `onJoin(name, pin)` (update the `onJoin` prop type to `(name: string, pin: string) => void`).
- When `deniedReason` is set, render an error line (e.g. red text "This hub requires a valid PIN.") near the PIN field.
Keep the existing name-required gating (JOIN HUB disabled until name).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w client -- Lobby`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/Lobby.tsx packages/client/src/components/Lobby.test.tsx
git commit -m "feat(client): Lobby optional Room PIN field + denial error; onJoin(name, pin)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 5: `ClientPortal` — thread the PIN + denial → lobby

**Files:**
- Modify: `packages/client/src/ClientPortal.tsx` + `ClientPortal.test.tsx`

**Context:** Store the PIN from the lobby, pass it to `useWebRTC`, and on `joinDenied` return the user to the lobby with the reason.

- [ ] **Step 1: Update the test** — In `ClientPortal.test.tsx`, extend the mocked `useWebRTC` to support `joinDenied`, and add:

```tsx
  it('returns to the lobby with an error when the join is denied', () => {
    wrtc.joinDenied = { reason: 'pin' };  // mock surfaces a denial
    render(<ClientPortal />);
    const name = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Tester' } });
    fireEvent.click(screen.getByRole('button', { name: /join hub/i }));
    // denied → still on lobby (no in-session camera control), error shown
    expect(screen.queryByText(/start camera|stop camera/i)).toBeNull();
    expect(screen.getByText(/requires a valid pin|wrong pin|invalid pin/i)).toBeTruthy();
    wrtc.joinDenied = null; // reset for other tests
  });
```
(Add `joinDenied: null` to the base `wrtc` mock object at the top of the file.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w client -- ClientPortal`
Expected: FAIL — pin not threaded / denial not handled.

- [ ] **Step 3: Implement** — In `ClientPortal.tsx`:
- Add `const [pin, setPin] = useState('')` and `const [deniedReason, setDeniedReason] = useState<string | null>(null)`.
- Destructure `joinDenied` from `useWebRTC(...)` and pass `pin` into the options: `useWebRTC('main-hub', { …, pin })`.
- `handleLobbyJoin(name, pin)` now takes the pin: `setUserName(name); setPin(pin); localStorage.setItem('hub-username', name); setLocalCameraActive(true); setLobbyDone(true); pendingConnectRef.current = true;`.
- Add an effect: `useEffect(() => { if (joinDenied) { setDeniedReason(joinDenied.reason); setLobbyDone(false); setLocalCameraActive(false); } }, [joinDenied]);` (denial → back to lobby).
- Pass `deniedReason` to `<Lobby onJoin={handleLobbyJoin} initialName={userName} wasKicked={wasKicked} deniedReason={deniedReason ?? undefined} />`.
- When the user re-joins from the lobby, clear the prior error (in `handleLobbyJoin`, `setDeniedReason(null)`).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w client -- ClientPortal` → PASS. Run: `npm run test -w client` → 0 failures (Lobby's new `onJoin(name,pin)` arity is satisfied here).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/ClientPortal.tsx packages/client/src/ClientPortal.test.tsx
git commit -m "feat(client): ClientPortal threads room PIN + returns to lobby on join-denied"
```
(+ `Co-Authored-By` trailer.)

---

### Task 6: Admin "Room Access" control + lock glyph

**Files:**
- Create: `packages/client/src/hooks/useRoomPin.ts` + `useRoomPin.test.tsx`
- Modify: `admin/AdminDataProvider.tsx`, `AdminApp.tsx`, `admin/tabs/SettingsTab.tsx` (+ test), `admin/ServerStatusBar.tsx`

**Context:** The host sets/clears the PIN from Settings; a lock glyph by the Join URL shows state at a glance. A small `useRoomPin(ipc)` hook owns the IPC; AdminApp feeds a `roomAccess` slice into `adminData` so both SettingsTab and ServerStatusBar read one source.

- [ ] **Step 1: Write the failing hook test** — Create `packages/client/src/hooks/useRoomPin.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '../test/testUtils'; // use the repo's renderHook harness
import { useRoomPin } from './useRoomPin';

function fakeIpc(locked = false) {
  return {
    send: vi.fn(),
    invoke: vi.fn(async (ch: string) => (ch === 'get-room-pin' ? { locked } : undefined)),
    on: vi.fn(() => () => {}),
  } as any;
}
afterEach(cleanup);

describe('useRoomPin', () => {
  it('reads initial locked state via get-room-pin', async () => {
    const ipc = fakeIpc(true);
    const { result } = renderHook(() => useRoomPin(ipc));
    await act(async () => {});
    expect(ipc.invoke).toHaveBeenCalledWith('get-room-pin');
    expect(result.current.locked).toBe(true);
  });
  it('setPin sends set-room-pin and marks locked', async () => {
    const ipc = fakeIpc(false);
    const { result } = renderHook(() => useRoomPin(ipc));
    await act(async () => { await result.current.setPin('1234'); });
    expect(ipc.send).toHaveBeenCalledWith('set-room-pin', { pin: '1234' });
    expect(result.current.locked).toBe(true);
  });
  it('clearPin sends empty + marks open', async () => {
    const ipc = fakeIpc(true);
    const { result } = renderHook(() => useRoomPin(ipc));
    await act(async () => { await result.current.clearPin(); });
    expect(ipc.send).toHaveBeenCalledWith('set-room-pin', { pin: '' });
    expect(result.current.locked).toBe(false);
  });
  it('no-ops without ipc (browser participant context)', () => {
    const { result } = renderHook(() => useRoomPin(null));
    expect(result.current.locked).toBe(false);
  });
});
```
(Match the repo's `renderHook` harness — check how `useRecordings.test`/`useDestinations.test` import it; mirror that exactly.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w client -- useRoomPin`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `useRoomPin.ts`**:

```ts
import { useState, useEffect, useCallback } from 'react';
import type { IpcBridge } from './useElectronBridge';

/** Admin-side control of the server's room PIN (locked state + set/clear), over IPC. */
export function useRoomPin(ipc: IpcBridge | null) {
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (!ipc) return;
    let alive = true;
    ipc.invoke('get-room-pin').then((r: { locked: boolean }) => { if (alive && r) setLocked(!!r.locked); }).catch(() => {});
    return () => { alive = false; };
  }, [ipc]);

  const setPin = useCallback(async (pin: string) => {
    if (!ipc) return;
    ipc.send('set-room-pin', { pin });
    setLocked(!!pin.trim());
  }, [ipc]);

  const clearPin = useCallback(async () => {
    if (!ipc) return;
    ipc.send('set-room-pin', { pin: '' });
    setLocked(false);
  }, [ipc]);

  const refresh = useCallback(async () => {
    if (!ipc) return;
    try { const r = await ipc.invoke('get-room-pin'); if (r) setLocked(!!r.locked); } catch (_) {}
  }, [ipc]);

  return { locked, setPin, clearPin, refresh };
}
```
(Confirm the `IpcBridge` type name/exported shape in `useElectronBridge.ts` — match it; if `invoke`/`send` differ, adapt.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w client -- useRoomPin` → PASS.

- [ ] **Step 5: Add `roomAccess` to AdminData + wire in AdminApp**

In `admin/AdminDataProvider.tsx`, add to the `AdminData` type:
```ts
  roomAccess: { locked: boolean; setPin: (pin: string) => Promise<void>; clearPin: () => Promise<void> };
```
In `AdminApp.tsx`: call `const { locked: roomLocked, setPin: setRoomPin, clearPin: clearRoomPin } = useRoomPin(ipc);` (with the other hooks), and add to the `adminData` useMemo object + its deps:
```ts
    roomAccess: { locked: roomLocked, setPin: setRoomPin, clearPin: clearRoomPin },
```
(Add `roomLocked, setRoomPin, clearRoomPin` to the memo dep array.)

- [ ] **Step 6: Room Access section in SettingsTab + test**

In `SettingsTab.test.tsx`, add `roomAccess` to the test's `base` AdminData fixture (`{ locked: false, setPin: vi.fn(async()=>{}), clearPin: vi.fn(async()=>{}) }`) and a test:
```tsx
  it('sets a room PIN via roomAccess.setPin', () => {
    const data = withSettings({}); // or the base fixture incl. roomAccess
    const setPin = vi.fn(async () => {});
    data.roomAccess = { locked: false, setPin, clearPin: vi.fn(async()=>{}) };
    const { container } = render(<AdminDataProvider value={data}><SettingsTab /></AdminDataProvider>);
    fireEvent.change(container.querySelector('input[data-field="room-pin-set"]')!, { target: { value: '1234' } });
    fireEvent.click(screen.getByText(/set pin|lock/i));
    expect(setPin).toHaveBeenCalledWith('1234');
  });
```
In `SettingsTab.tsx`, read `useAdminData().roomAccess` and add a "Room Access" section: a 🔓 Open / 🔒 Locked indicator (from `roomAccess.locked`), a PIN `<input data-field="room-pin-set">` + a "Set PIN" `NTButton` (→ `roomAccess.setPin(value)`) and a "Clear" `NTButton` (→ `roomAccess.clearPin()`). Reuse `.ntd-field`/`NTButton`. Brief helper text: "Participants must enter this PIN to join. The host (this app) is always exempt."

- [ ] **Step 7: Lock glyph in ServerStatusBar**

In `ServerStatusBar.tsx`, read `useAdminData().roomAccess.locked` and render a small glyph next to the existing Join URL item: `🔒` when locked, `🔓` when open (a `<span title="Room locked — PIN required">`). Update `ServerStatusBar.test.tsx`'s AdminData fixture to include `roomAccess` so it renders (assert the glyph reflects `locked`).

- [ ] **Step 8: Full suite + build**

Run: `npm run test -w client` → 0 failures (all fixtures updated with `roomAccess`). Run: `npm run build` → clean.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/hooks/useRoomPin.ts packages/client/src/hooks/useRoomPin.test.tsx packages/client/src/admin/AdminDataProvider.tsx packages/client/src/AdminApp.tsx packages/client/src/admin/tabs/SettingsTab.tsx packages/client/src/admin/tabs/SettingsTab.test.tsx packages/client/src/admin/ServerStatusBar.tsx packages/client/src/admin/ServerStatusBar.test.tsx
git commit -m "feat(admin): Room Access control (set/clear PIN) + lock glyph; useRoomPin hook"
```
(+ `Co-Authored-By` trailer.)

---

### Task 7: Manual eyeball (live)

- [ ] **Step 1:** `npm run dev`. In the admin (Settings → Room Access), set a PIN (e.g. `1234`) — the lock glyph by the Join URL flips to 🔒.
- [ ] **Step 2:** From a phone/second browser, open the Join URL → lobby → enter name, leave PIN blank → JOIN → expect denial ("requires a valid PIN") and stay on the lobby. Enter `1234` → JOIN → joins; admin sees the participant.
- [ ] **Step 3:** Confirm the **host is exempt**: the Electron admin never prompts for the PIN (loopback). Confirm `?role=admin` from a remote browser DOES require the PIN (no bypass).
- [ ] **Step 4:** Clear the PIN in Settings → glyph 🔓 → a participant joins with no PIN (open hub, back to today's behavior).
- [ ] **Step 5:** Restart the app → the PIN persists (still 🔒 if it was set).
- [ ] **Step 6:** (Throttle) wrong PIN ~5× from one device → socket disconnect + brief cooldown.
- [ ] **Verify the dev-proxy address caveat** (Task 2 Step 3): confirm a LAN participant is gated (treated non-loopback). If the Vite `/socket.io` proxy makes them appear loopback in dev, note it — production (Electron Express origin, no proxy) is unaffected. Report.
- [ ] No commit unless an eyeball CSS/UX tweak was made.

---

## Self-Review

**Spec coverage:**
- §1/§2 server gate + persist + IPC + join-room validation → Tasks 1 (module) + 2 (wiring). ✅
- §3 client: useWebRTC pin+join-denied (T3), Lobby field (T4), ClientPortal threading (T5), admin Room Access + glyph (T6). ✅
- §4 persistence (userData/room-config.json) → T2. ✅
- §5 testing → module tests (T1), client tests (T3–T6), eyeball (T7). ✅
- §6 non-goals respected (no accounts/hashing/TURN; throttle = simple cooldown; mid-session PIN change doesn't evict — not handled). ✅
- Q3 loopback-exempt + `?role=admin` bypass closed → T1 `isLoopback` + T2 gate on `socket.handshake.address`; verified in T7. ✅

**Placeholder scan:** Concrete code for the testable units (module, hook, Lobby, ClientPortal) + tests. T2 (Electron main glue) gives concrete diffs but flags the one runtime unknown — `socket.handshake.address` under the dev proxy — as an explicit T7 verification with a documented production-vs-dev distinction (not a hand-wave; it's a real environment caveat to confirm live). T3's optional useWebRTC test is conditioned on harness feasibility with a defined fallback (T5 covers the behavior).

**Type/name consistency:** `roomGate.check(address, candidate) → {allowed, reason?, lockout?}` used identically in T1/T2. IPC channels `set-room-pin` (send `{pin}`) / `get-room-pin` (invoke → `{locked}`) consistent across T2/T6. `join-denied` event `{reason}` consistent T2/T3/T5. `onJoin(name, pin)` consistent T4/T5. `roomAccess: {locked,setPin,clearPin}` consistent across AdminData/AdminApp/SettingsTab/ServerStatusBar (T6). localStorage/userData keys: `room-config.json` `{roomPin}`.
