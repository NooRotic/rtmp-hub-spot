# Room-PIN auth (lightweight, server-validated) — design

**Date:** 2026-06-07
**Branch:** `feat/room-pin-auth` (off `main` @ 0970f07)
**Status:** approved design → implementation plan next

## Goal

Add a lightweight, **server-validated** shared room PIN so an uninvited person with the Join URL can't join `main-hub`. The host sets/clears the PIN from the admin UI; participants enter it in the lobby; the signaling server is the only place the PIN is checked.

## Resolved decisions (brainstorm)

- **Q1 scope = A:** lightweight shared room-PIN (one PIN for the room), server-validated, with basic brute-force throttling. NOT per-user accounts/hashed storage/TURN.
- **Q2 lifecycle = A:** host sets/clears in the admin UI; **persisted** across restarts (Electron main `userData`); **default OPEN** (no PIN until set); 🔓 Open / 🔒 Locked indicator.
- **Q3 exemption = A:** **loopback-exempt** — the server requires the PIN for every non-loopback (LAN/internet) join, including a remote `?role=admin` monitor; loopback (the local Electron host) is always admitted. This closes the `?role=admin` bypass (the check is on network origin, not a client-claimed role).
- **Q4 lobby UX = A:** an always-present **optional** "Room PIN" field in the Lobby ("leave blank if you weren't given one") + denial feedback on wrong/missing PIN (re-focus, retry). No pre-check round-trip.

## Key constraint

Validation MUST be server-side (in `main.js`'s `join-room` handler) — any client-side check is bypassable. The current handler (`main.js:363`) admits anyone: `socket.on('join-room', ({ roomId, userName }) => { socket.join(roomId); ... })`. The PIN gate inserts before `socket.join`.

## §1 Architecture & data flow

Single source of truth = `roomPin` (module scope in `main.js`), loaded at startup from `userData/room-config.json`. The host sets/clears it via admin UI → IPC → main (persist + update `roomPin`). On `join-room`: if `roomPin` is set AND the socket is non-loopback AND the supplied `pin !== roomPin` → deny (emit `join-denied`, do NOT `socket.join`); otherwise admit as today. Loopback sockets are always admitted. Participants supply the PIN via the Lobby; denial → retry. Throttling guards brute force.

## §2 Server (`main.js`)

- `let roomPin = ''` (module scope), loaded at startup from `userData/room-config.json` (`{ "roomPin": "" }`; empty = open).
- **IPC** (via the existing preload bridge):
  - `set-room-pin` (send): payload `{ pin: string }` — empty string clears (open). Updates `roomPin` + rewrites `room-config.json`.
  - `get-room-pin` (invoke): returns `{ locked: boolean }` (do NOT return the PIN itself to the renderer beyond what the host typed; the admin UI tracks what it set). For the admin's own display of the current PIN, the renderer can keep the last-set value in its own state; `get-room-pin` just reports locked/open on startup.
- **`join-room` validation** — handler gains a `pin` field:
  ```js
  socket.on('join-room', ({ roomId, userName, pin }) => {
    if (roomPin && !isLoopback(socket) && pin !== roomPin) {
      registerFailedAttempt(socket);          // throttle bookkeeping
      socket.emit('join-denied', { reason: 'pin' });
      return;                                  // never socket.join
    }
    socket.join(roomId);
    // …existing admit logic (users[], all-users emit) unchanged…
  });
  ```
- **`isLoopback(socket)`**: inspect `socket.handshake.address` (and/or `socket.conn.remoteAddress`) against `127.0.0.1`, `::1`, `::ffff:127.0.0.1`. Pure helper (testable).
- **Throttle**: a per-IP map `{ fails, cooldownUntil }`. `registerFailedAttempt` increments fails; at ≥5 fails → `socket.disconnect(true)` + set `cooldownUntil = now + 60_000`. A connection from an IP within cooldown is denied/disconnected immediately on `join-room`. Successful join resets that IP's counter. Keep it a small, testable pure-ish module (inject "now" for tests).

## §3 Client

- **`useWebRTC`**: add a `pin` option; include it in the `join-room` emit (`useWebRTC.ts:148`). Add a `join-denied` listener → expose `joinDenied: { reason } | null` and ensure the hook does NOT report connected on denial (the socket may stay connected but un-joined; expose the denial so the UI reacts).
- **`Lobby`**: add an optional "Room PIN" field; change `onJoin` to `onJoin(name, pin)`; accept a `deniedReason?`/error prop to show "This hub requires a valid PIN" + re-focus the PIN field.
- **`ClientPortal`**: `handleLobbyJoin(name, pin)` stores the pin and threads it into `useWebRTC({ pin })`; when `joinDenied` fires, drop back to the lobby (`lobbyDone=false`) with the denial reason shown.
- **Admin UI**: a "Room Access" section in the **Settings tab** — shows 🔓 Open / 🔒 Locked, a PIN input + Set / Clear buttons (→ `set-room-pin`), persisted; reads startup lock state via `get-room-pin`. Plus a small 🔒/🔓 glyph next to the **Join URL** in `ServerStatusBar` so lock state is glanceable. (Approved placement.)

## §4 Persistence

Plaintext `roomPin` in `userData/room-config.json`, loaded at startup, rewritten on change. Plaintext is acceptable for a shared room PIN on the trusted host machine (it is not a credential database). Over the wire the PIN travels inside the existing `wss`/TLS join payload.

## §5 Testing

- **Server (vitest):** `isLoopback` (loopback vs LAN addresses); `join-room` — open hub admits; locked hub denies wrong/missing PIN for a non-loopback socket; loopback socket admitted even when locked; throttle disconnects + cools down an IP after 5 fails and a correct PIN resets it. Use fakes for socket (`{ handshake, emit, join, disconnect }`) + inject `now` into the throttle.
- **Client (vitest + jsdom):** `Lobby` renders the PIN field + calls `onJoin(name, pin)`; shows the denial error when given. `useWebRTC` emits the pin in `join-room` and surfaces `joinDenied` on the event (mock socket). `ClientPortal` returns to the lobby on `joinDenied`. The admin "Room Access" control calls `set-room-pin` / reflects locked state (mock ipc).
- Full client + server suites stay green.

## §6 Non-goals / noted edge cases

- No per-user accounts, no hashed storage, no lockout beyond the 60s IP cooldown, no TURN.
- Changing the PIN mid-session does NOT evict already-joined sockets (gate is on join; the host can kick). Noted, not handled.
- The admin renderer never needs the PIN to function (the Electron host is loopback-exempt); the PIN it shows is just what the host typed.

## Success criteria

- With a PIN set, a remote browser (LAN) cannot join without the correct PIN (including via `?role=admin`); the local Electron host joins without prompting.
- Open hub (no PIN) behaves exactly as today (backward-compatible).
- Wrong/missing PIN → clear lobby error + retry; brute-force attempts get throttled.
- PIN persists across host restarts. Full suites green; build clean.
