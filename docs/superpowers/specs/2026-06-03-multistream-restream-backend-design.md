# Multi-Stream Pro — Restream Backend Design

- **Date:** 2026-06-03
- **Branch:** `feat/multi-stream-pro`
- **Status:** Approved design — ready for implementation plan
- **Goal of this phase:** Build the backend fan-out + metadata so the UI redesign has a complete, stable data contract to render. No UI work in this phase.

## Acronym key

| Term | Meaning |
|---|---|
| NMS | Node-Media-Server — the local RTMP server inside Electron (`rtmp://localhost:1935/live/{key}`) |
| RTMP / FLV | Real-Time Messaging Protocol / its Flash-Video container — the standard live-push transport |
| Relay | An FFmpeg process that **pulls** from local NMS and **pushes** to an external platform with `-c copy` |
| Source pipe | Existing FFmpeg process fed WebM chunks via `PassThrough`, **encodes** to local NMS |
| DI | Dependency Injection — collaborators passed in so modules test without Electron/FFmpeg |
| Binding | A matrix cell: `(source, destination, active)` |
| ERTMP / Enhanced Broadcasting | Twitch's multitrack extension — **explicitly out of scope** (see §9) |

## 1. Context & product framing

End goal is **C (full matrix: any source → any subset of destinations)**. This phase ships **MVP = A (restream)**: one source fanned out to multiple external platforms simultaneously.

Driving workflow (user): OBS owns the **Twitch** stream natively (to keep Enhanced Broadcasting); the **hub restreams the same source to the other platforms** (YouTube / Kick / TikTok / custom). See memory `multistream-product-refs-and-vision`.

Today there are two **disconnected** "destination" concepts:
- The **local NMS output** — every source pipe outputs to `rtmp://localhost:1935/live/{streamKey}`. This runs today.
- The **`RtmpDestination` model** (Phase 1) — persisted, encrypted, full CRUD over IPC, **but nothing reads it.** The address book exists; nobody dials it.

This phase connects them: enabled destinations become live **relays** off the local NMS stream.

## 2. Scope

**In scope (MVP):**
- Fan-out via `-c copy` relays (one shared source encode, copied to every destination).
- Per-destination live status + stats (health LEDs, bitrate, dropped frames, uptime).
- Matrix-ready data model (shared address book + per-source toggles).
- Graceful, staggered, priority-ordered reconnection.

**Out of scope (this phase):**
- Per-destination transcoding (different bitrate/res per platform) — **Pro/paid feature**, data model accommodates it (`RtmpDestination.encode?`) but no implementation now.
- Twitch Enhanced Broadcasting / ERTMP multitrack — see §9.
- Any UI work — this phase defines the contract the UI will later render.

## 3. Architecture decision — copy-relay from NMS (chosen) vs `tee`

**Chosen: ① Relay-from-NMS with `-c copy`.** For each active destination, spawn one FFmpeg that reads `rtmp://localhost:1935/live/{sourceKey}` and pushes to the platform with `-c copy` (no re-encode). Keyed `relay:{sourceKey}:{destId}`.

Rationale:
- The hub **already** encodes each source once and publishes it to NMS. A relay is then a near-free copy — NMS already did the hard part.
- One process per destination → **clean per-destination health + stats for free** (the metadata the UI needs).
- Physical isolation: one platform failing cannot stall another (no shared encoder).
- The Pro transcode path is the *same* relay with encode flags swapped for `-c copy` — no structural change.

**Rejected: ② single `tee` muxer per source.** Fewer processes, but FFmpeg reports **aggregate** stats — you cannot show "Kick specifically is dropping frames," which defeats the per-platform health UI. Per-output failure isolation is also harder.

## 4. The metadata contract (3-level hierarchy)

Everything the UI renders falls into exactly one level. Levels 1–2 exist today; Level 3 is new and mirrors Level 2's event shape so the renderer reuses one health component.

**Level 1 — Server** (`server-status` socket event, unchanged):
`{ local, public, clientCount, rtmpCount, rtmpSessions[], rtmpPublishers[] }`

**Level 2 — Source** (encode → NMS, exists today, per `streamKey`):
- `ffmpeg-status` → `{ state, streamKey, message? }`
- `ffmpeg-stats` → `{ frame, fps, size, time, bitrate, speed, streamKey }`

**Level 3 — Destination relay** (NEW, per `(source × destination)`):

```ts
// packages/shared/index.ts

type Platform = 'youtube' | 'kick' | 'tiktok' | 'twitch' | 'facebook' | 'custom';

interface EncodeOverride {        // PRO (later) — undefined = copy relay
  bitrate?: string;
  resolution?: string;
  fps?: number;
}

// Address-book entry (persisted; streamKey encrypted at rest)
interface RtmpDestination {
  id: string;
  name: string;                   // "My YouTube"
  platform: Platform;             // drives icon + sane ingest-URL default
  url: string;                    // rtmp ingest URL
  streamKey: string;              // secret
  enabled: boolean;               // account-level on/off
  priority?: number;              // reconnection order (default = list order); lower = sooner
  encode?: EncodeOverride;        // PRO; undefined => -c copy
}

// Matrix cell — which source feeds which destination
interface DestinationBinding {
  sourceKey: string;              // 'grid' | 'feed-<slug>'
  destinationId: string;
  active: boolean;                // user flipped this cell on
}

type RelayState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error' | 'stopped';

// Pushed per relay (Level-3 analog of ffmpeg-status)
interface RelayStatus {
  sourceKey: string;
  destinationId: string;
  state: RelayState;
  message?: string;
  restartCount?: number;
}

// Pushed per relay (Level-3 analog of ffmpeg-stats)
interface RelayStats {
  sourceKey: string;
  destinationId: string;
  fps: number;
  bitrate: string;                // outgoing
  speed: number;                  // <1.0 == falling behind (key health signal)
  droppedFrames?: number;         // ffmpeg 'drop=' — the "platform choking" signal
  frame: number;
  size: string;
  time: string;
  uptimeSec: number;
}
```

> The UI is a pure function of these types: **Server header → each Source card → that source's Destination rows** (health LED = `RelayState`, stat strip = `RelayStats`). `speed < 1.0` and `droppedFrames` are first-class because they are what actually tell a streamer a platform is in trouble.

## 5. Data model & persistence

- `destinations.json` already persists `RtmpDestination[]` with the `streamKey` encrypted via `safeStorage` (existing `destinationStore`).
- Add `priority?` to `RtmpDestination`.
- **Bindings** are small, non-secret. Persist via the existing `destinationStore` pattern (second method / `bindings.json`) rather than a new IO module. Bindings tolerate a **dangling `sourceKey`** (a feed not currently present) — such a binding stays armed-idle.
- **Stream-key sanitization:** slugify source keys so a label like `Mobile rotic - camera 2, facing back` no longer becomes `feed-mobile-rotic---camera-2,-facing-back`. Source keys flow into RTMP paths *and* relay keys, so sanitize at the single point of derivation.

## 6. Relay lifecycle & state machine (`relay-manager.js`)

A relay differs structurally from a source pipe: a source pipe is **push-fed** WebM chunks via `PassThrough`; a relay **pulls** from an RTMP URL and copies onward. Same Map-of-keyed-pipes pattern, different input model, no `writeChunk`. So relays live in a **sibling `relay-manager.js`** (not overloading `pipe-manager`), with a pure `buildRelayArgs()` mirroring `buildFfmpegArgs()`.

`buildRelayArgs({ destination, sourceKey, rtmpPort })` → input `rtmp://localhost:{rtmpPort}/live/{sourceKey}`; output composed as `{destination.url}/{destination.streamKey}` (RTMP convention: `url` is the application/ingest endpoint, `streamKey` is the path segment appended — joined with a single `/`, trimming any duplicate slash); flags `-c copy`, `-f flv`. No silent-audio injection (the NMS source already carries audio). The existing stderr stats regex in `pipe-manager` works unchanged on a copy relay → `RelayStats` from the same parser.

**State machine (per `relay:{source}:{dest}`):**

```
                 source live + binding active
   idle ───────────────────────────────────────► connecting
    ▲                                                  │ ffmpeg 'start'
    │ source down / user toggles off                   ▼
    │◄───────────────────────────── stopped ◄────── live ⇄ reconnecting
                                       ▲                │      (transient drop)
                                       │ fatal error    │
                                       └────────────────┘
```

**Defining rule — relays are slaved to their source:**
- A relay runs only while its source pipe is publishing to NMS. Toggle a binding on while the source is down → marked `active`, sits in `idle` (armed).
- A thin **orchestrator** listens to source state: source → `running` auto-starts every active binding for that source; source → `stopped` tears those relays down to armed-`idle` (not a frantic reconnect — the input legitimately vanished).
- The orchestrator is its own injectable module (kept out of `main.js`) so it is unit-testable.

## 6.1 Reconnection supervision (`reconnection-supervisor.js`)

**Scope note:** source pipes push to loopback and are **unaffected** by a WiFi/network drop; only **relays' outbound push** fails. So during an outage, sources stay green and only relays reconnect.

**Problem:** a network drop hits every relay at the same instant → synchronized backoff (permanent herd), and the instant the uplink returns N simultaneous RTMP+TLS handshakes slam a congested link (shared with every other app reconnecting), causing failures → more retries.

**Mechanism — one shared, priority-ordered reconnect queue (not N independent timers):**
1. **Serial drain, concurrency cap = 1 (default)** with a **min inter-release gap (~1.5–2s, jittered).** Relays return as a calm wave.
2. **Priority order** via `RtmpDestination.priority` (default = list order) — primary platform reconnects first.
3. **Head of the queue is the connectivity canary:** if the network is still dead the head's attempt fails fast → the **whole queue holds and backs off** (jittered, ~2s→30s cap) before re-probing with the head. Never drain into a dead link; no separate ping target.
4. **Jitter** on both the inter-release gap and the queue-hold backoff so nothing re-synchronizes.

A **fatal** failure (bad key/auth/DNS) leaves the queue → `error`, no retry. A **transient** failure goes to the queue tail with increased backoff. A lone single-platform hiccup flows through the same queue but, being alone, reconnects immediately after its jittered gap.

## 7. IPC surface & events

**Persisted model:**
- existing `destinations:list | add | remove | update`
- new `bindings:list | set` (matrix cells)

**Runtime push (mirror Level-2 cadence/shape):**
- `relay-status` → `RelayStatus`
- `relay-stats` → `RelayStats`

## 8. Error handling

- **Fatal vs transient** classified by stderr pattern in `relay-manager` (same place stats are parsed). Fatal: auth rejected / invalid stream key / DNS failure → `error`, surfaced loudly, no retry. Transient: connection reset / broken pipe / timeout → `reconnecting` via the supervisor.
- One relay's failure is physically isolated (separate process, separate Map entry) — zero blast radius on siblings.

## 9. Out of scope / future

- **Pro — per-destination transcoding:** `RtmpDestination.encode` drives per-target bitrate/res/fps (N encodes). Data model ready; not implemented this phase.
- **Twitch Enhanced Broadcasting (ERTMP multitrack):** explicitly **not** replicated. Three walls: the Twitch-account config handshake isn't a public push spec; FFmpeg lacks Twitch multitrack muxing; it's N GPU-bound encodes. MVP handles Twitch as (a) an ordinary single-track relay target, or (b) OBS owns Twitch while the hub feeds OBS (scenarios C-1/C-2). Future moonshot: an OBS plugin that emits the negotiated multitrack config ("hacker-man time"). See memory `multistream-product-refs-and-vision`.

## 10. Testing strategy (all Electron-free via DI)

- `buildRelayArgs()` — pure: copy flags, correct input URL from `sourceKey`, output URL from `url`+`streamKey`, no silent-audio injection.
- `relay-manager` — inject fake `spawnRelay`: start/stop/restart, transient-backoff vs fatal-no-retry classification, Map isolation, stats emission.
- `orchestrator` — inject fake `relayManager` + synthetic source-state events: auto-start-on-source-live, auto-stop-on-source-down, armed-idle when source absent.
- `reconnection-supervisor` — inject fake clock/timer + fake relay-start: serial release, priority order, queue-hold-on-canary-fail, jitter bounds, fatal-leaves-queue.
- **Live smoke (manual):** grid → 2 real platforms concurrently; kill one platform's network; confirm the other stays live and the killed one shows `reconnecting` then recovers.

## 11. New / changed files (anticipated)

| File | Change |
|---|---|
| `packages/shared/index.ts` | Add `Platform`, `EncodeOverride`, `priority`/`platform` on `RtmpDestination`, `DestinationBinding`, `RelayState`, `RelayStatus`, `RelayStats` |
| `packages/server/relay-args.js` (+ test) | NEW pure `buildRelayArgs()` |
| `packages/server/relay-manager.js` (+ test) | NEW keyed copy-relay lifecycle |
| `packages/server/reconnection-supervisor.js` (+ test) | NEW staggered priority reconnect queue |
| `packages/server/broadcast-orchestrator.js` (+ test) | NEW source-state → relay start/stop |
| `packages/server/destinationStore.js` (+ test) | Add bindings persistence; slugify helper |
| `packages/server/destinationHandlers.js` (+ test) | Add `bindings:list|set` |
| `packages/server/main.js` | Wire relay-manager + orchestrator + supervisor; `spawnRelay` glue; slugify source keys |
| electron-builder `files` | Include new server modules (as Phase 1 did) |
