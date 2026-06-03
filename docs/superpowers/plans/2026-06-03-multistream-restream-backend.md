# Multi-Stream Pro Restream Backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fan a live source out to multiple external RTMP platforms via cheap `-c copy` relays off the local NMS, emitting per-destination health/stats so the UI redesign has a complete data contract.

**Architecture:** One FFmpeg relay process per destination, pulling `rtmp://localhost:1935/live/{sourceKey}` and copying to the platform (keyed `relay:{sourceKey}:{destId}` in a relay-manager Map, sibling to the existing pipe-manager). A reconnection-supervisor serializes + priority-orders + jitter-staggers all (re)connects to avoid a thundering herd on a network drop. A broadcast-orchestrator couples NMS publish/unpublish to relay start/stop. All modules are dependency-injected and unit-tested Electron-free; main.js only wires them.

**Tech Stack:** Node CommonJS, fluent-ffmpeg, Node-Media-Server, Electron IPC, Vitest (v1.6.1), React/Vite client (TypeScript).

**Spec:** `docs/superpowers/specs/2026-06-03-multistream-restream-backend-design.md`

**Conventions to match (audited):** `'use strict'` + JSDoc header per module; `module.exports = { createX }`; tests are `import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'`, co-located `*.test.js`, inline factory helpers (e.g. `makeManager()`) returning `{ manager, ...fakes }`, fakes record into arrays (`broadcasts.push(...)`), spies via `vi.fn()`, fake timers via `vi.useFakeTimers()`. Run a single file: `npx vitest run packages/server/<file>.test.js`.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/server/ffmpeg-progress.js` (+test) | NEW pure parser for ffmpeg's stderr progress line (shared by pipe-manager + relay-manager). DRY: extracts the regex currently private to pipe-manager. |
| `packages/server/pipe-manager.js` | MODIFY: `parseStats` delegates to `ffmpeg-progress` (no behavior change). |
| `packages/shared/index.ts` | MODIFY: add relay/binding types. |
| `packages/server/relay-args.js` (+test) | NEW pure `buildRelayArgs()`. |
| `packages/server/relay-manager.js` (+test) | NEW keyed copy-relay lifecycle (start/stop/stopForSource/stopAll, state + stats broadcast, fatal/transient classification). |
| `packages/server/reconnection-supervisor.js` (+test) | NEW serial, priority-ordered, jittered (re)connect scheduler. |
| `packages/server/broadcast-orchestrator.js` (+test) | NEW NMS-publish → relay fan-out coupling. |
| `packages/server/destinationStore.js` (+test) | MODIFY: add bindings persistence (`bindings.json`, unencrypted). |
| `packages/server/destinationHandlers.js` (+test) | MODIFY: add `bindings:list|set` handlers. |
| `packages/client/src/utils/streamKey.ts` (+test) | NEW slugify helper; DRY the two inline copies + harden. |
| `packages/client/src/components/VideoFeed.tsx` | MODIFY: use `feedKey()` at the two sites. |
| `packages/server/main.js` | MODIFY: `spawnRelay` glue; construct + wire the three managers; hook NMS events; quit cleanup. |
| `packages/server/preload.js` | MODIFY: allowlist new IPC channels. |
| `packages/server/package.json` | MODIFY: add new modules to `build.files`. |

**Build order rationale:** pure leaves first (`ffmpeg-progress`, types, `relay-args`), then `relay-manager` (uses both), then `reconnection-supervisor` and `broadcast-orchestrator` (depend only on injected interfaces, mockable), then persistence + handlers, then the client slug, then main.js wiring last (integration).

---

## Task 1: Extract shared ffmpeg progress parser (DRY)

**Files:**
- Create: `packages/server/ffmpeg-progress.js`
- Create: `packages/server/ffmpeg-progress.test.js`
- Modify: `packages/server/pipe-manager.js:24-38`

- [ ] **Step 1: Write the failing test**

`packages/server/ffmpeg-progress.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { parseFfmpegProgress } from './ffmpeg-progress.js';

const LINE =
  'frame=  123 fps= 30 q=28.0 size=    456kB time=00:00:04.10 bitrate=2500.0kbits/s speed=1.0x';

describe('parseFfmpegProgress', () => {
  it('parses a standard progress line', () => {
    expect(parseFfmpegProgress(LINE)).toEqual({
      frame: 123,
      fps: 30,
      size: '456kB',
      time: '00:00:04.10',
      bitrate: '2500.0kbits/s',
      speed: 1.0,
      droppedFrames: undefined,
    });
  });

  it('captures drop= when present', () => {
    const dropping =
      'frame=  900 fps= 30 q=28.0 drop=7 size=  1024kB time=00:00:30.00 bitrate=2500.0kbits/s speed=0.97x';
    const p = parseFfmpegProgress(dropping);
    expect(p.droppedFrames).toBe(7);
    expect(p.speed).toBe(0.97);
  });

  it('returns null for a non-progress line', () => {
    expect(parseFfmpegProgress('Input #0, matroska,webm')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/ffmpeg-progress.test.js`
Expected: FAIL — cannot resolve `./ffmpeg-progress.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/server/ffmpeg-progress.js`:
```javascript
'use strict';

/**
 * Pure parser for FFmpeg's periodic stderr progress line. Shared by pipe-manager
 * (source encode) and relay-manager (copy relay) so the regex lives in exactly
 * one place. Also captures the optional `drop=` field, which appears when an
 * output can't keep up — the key "falling behind" signal for relays.
 *
 * @param {string} line - one stderr line from ffmpeg
 * @returns {null | {frame:number, fps:number, size:string, time:string,
 *                   bitrate:string, speed:number, droppedFrames:(number|undefined)}}
 */
function parseFfmpegProgress(line) {
  const m = line.match(
    /frame=\s*(\d+)\s+fps=\s*([\d.]+).*?size=\s*([\d.]+\s*\w+).*?time=([\d:.]+).*?bitrate=\s*([\d.]+\s*\S+).*?speed=\s*([\d.]+)x/,
  );
  if (!m) return null;
  const drop = line.match(/drop=\s*(\d+)/);
  return {
    frame: parseInt(m[1], 10),
    fps: parseFloat(m[2]),
    size: m[3].trim(),
    time: m[4],
    bitrate: m[5].trim(),
    speed: parseFloat(m[6]),
    droppedFrames: drop ? parseInt(drop[1], 10) : undefined,
  };
}

module.exports = { parseFfmpegProgress };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/ffmpeg-progress.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Refactor pipe-manager to reuse it (no behavior change)**

In `packages/server/pipe-manager.js`, add near the top after `'use strict';`:
```javascript
const { parseFfmpegProgress } = require('./ffmpeg-progress');
```
Replace the existing `parseStats` function body (lines ~24-38) with:
```javascript
  function parseStats(line, streamKey) {
    const p = parseFfmpegProgress(line);
    if (!p) return null;
    return {
      frame: p.frame,
      fps: p.fps,
      size: p.size,
      time: p.time,
      bitrate: p.bitrate,
      speed: p.speed,
      streamKey,
    };
  }
```
(Note: this preserves the exact existing `ffmpeg-stats` shape — no `droppedFrames` key — so pipe-manager's characterization tests stay green.)

- [ ] **Step 6: Run the pipe-manager suite to verify no regression**

Run: `npx vitest run packages/server/pipe-manager.test.js`
Expected: PASS (all existing tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/ffmpeg-progress.js packages/server/ffmpeg-progress.test.js packages/server/pipe-manager.js
git commit -m "refactor(server): extract shared ffmpeg-progress parser (DRY pipe/relay)"
```

---

## Task 2: Shared types for relays + bindings

**Files:**
- Modify: `packages/shared/index.ts:15-22`

- [ ] **Step 1: Add the types**

Replace the existing `RtmpDestination` interface (lines 15-22) with:
```typescript
export type Platform =
  | 'youtube'
  | 'kick'
  | 'tiktok'
  | 'twitch'
  | 'facebook'
  | 'custom';

/** PRO (later): per-destination transcode overrides. undefined => -c copy relay. */
export interface EncodeOverride {
  bitrate?: string;
  resolution?: string;
  fps?: number;
}

export interface RtmpDestination {
  id: string;
  name: string;
  platform: Platform;
  url: string;
  streamKey: string;
  enabled: boolean;
  /** Reconnection order; lower = sooner. Defaults to list order when undefined. */
  priority?: number;
  encode?: EncodeOverride;
}

/** Matrix cell — which source feeds which destination. */
export interface DestinationBinding {
  sourceKey: string;
  destinationId: string;
  active: boolean;
}

export type RelayState =
  | 'idle'
  | 'connecting'
  | 'live'
  | 'reconnecting'
  | 'error'
  | 'stopped';

/** Pushed per relay over IPC channel 'relay-status'. */
export interface RelayStatus {
  sourceKey: string;
  destinationId: string;
  state: RelayState;
  message?: string;
  restartCount?: number;
}

/** Pushed per relay over IPC channel 'relay-stats'. */
export interface RelayStats {
  sourceKey: string;
  destinationId: string;
  fps: number;
  bitrate: string;
  speed: number;
  droppedFrames?: number;
  frame: number;
  size: string;
  time: string;
  uptimeSec: number;
}
```

- [ ] **Step 2: Verify the client still type-checks / builds**

Run: `npm run build -w client`
Expected: build succeeds (no consumers of the new fields yet; the widened `RtmpDestination` is backward-compatible — `platform` is the only new required field and is not yet constructed anywhere).
Note: if any existing test constructs an `RtmpDestination` literal without `platform`, update it to include `platform: 'custom'`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/index.ts
git commit -m "feat(shared): relay + binding types (Platform, RelayStatus/Stats, DestinationBinding)"
```

---

## Task 3: Pure `buildRelayArgs`

**Files:**
- Create: `packages/server/relay-args.js`
- Create: `packages/server/relay-args.test.js`

- [ ] **Step 1: Write the failing test**

`packages/server/relay-args.test.js`:
```javascript
import { describe, it, expect } from 'vitest';
import { buildRelayArgs } from './relay-args.js';

describe('buildRelayArgs', () => {
  const destination = {
    id: 'd1',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'abcd-efgh',
  };

  it('pulls from local NMS and copies to the destination', () => {
    const a = buildRelayArgs({ sourceKey: 'grid', destination, rtmpPort: 1935 });
    expect(a.inputUrl).toBe('rtmp://localhost:1935/live/grid');
    expect(a.outputUrl).toBe('rtmp://a.rtmp.youtube.com/live2/abcd-efgh');
    expect(a.outputOptions).toContain('-c copy');
    expect(a.outputOptions).toContain('-f flv');
  });

  it('joins url + streamKey with a single slash even if url has a trailing slash', () => {
    const a = buildRelayArgs({
      sourceKey: 'feed-x',
      destination: { ...destination, url: 'rtmp://a.rtmp.youtube.com/live2/' },
      rtmpPort: 1935,
    });
    expect(a.outputUrl).toBe('rtmp://a.rtmp.youtube.com/live2/abcd-efgh');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/relay-args.test.js`
Expected: FAIL — cannot resolve `./relay-args.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/server/relay-args.js`:
```javascript
'use strict';

/**
 * Pure construction of the FFmpeg relay arguments: pull one stream from the
 * local NMS and copy it (no re-encode) to an external RTMP destination. Mirror
 * of buildFfmpegArgs for the copy-relay path; holds no fluent-ffmpeg/electron/
 * singleton state so it unit-tests in isolation.
 *
 * @param {object} opts
 * @param {string} opts.sourceKey - local NMS stream to relay (e.g. 'grid')
 * @param {{url:string, streamKey:string}} opts.destination - external target
 * @param {number} opts.rtmpPort - local NMS RTMP port
 * @returns {{inputUrl:string, inputOptions:string[], outputOptions:string[], outputUrl:string}}
 */
function buildRelayArgs({ sourceKey, destination, rtmpPort }) {
  const inputUrl = `rtmp://localhost:${rtmpPort}/live/${sourceKey}`;
  const inputOptions = ['-fflags nobuffer', '-flags low_delay'];
  const outputOptions = ['-c copy', '-f flv', '-flush_packets 1'];
  const base = destination.url.replace(/\/+$/, '');
  const outputUrl = `${base}/${destination.streamKey}`;
  return { inputUrl, inputOptions, outputOptions, outputUrl };
}

module.exports = { buildRelayArgs };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/relay-args.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/relay-args.js packages/server/relay-args.test.js
git commit -m "feat(server): pure buildRelayArgs (copy-relay from NMS)"
```

---

## Task 4: `relay-manager` — keyed copy-relay lifecycle

**Files:**
- Create: `packages/server/relay-manager.js`
- Create: `packages/server/relay-manager.test.js`

- [ ] **Step 1: Write the failing test**

`packages/server/relay-manager.test.js`:
```javascript
import { describe, it, expect, vi } from 'vitest';
import { createRelayManager } from './relay-manager.js';
import { buildRelayArgs } from './relay-args.js';

function makeManager(overrides = {}) {
  const spawned = [];
  const broadcasts = [];
  const live = [];
  const transient = [];
  const spawnRelay = vi.fn((args, handlers) => {
    const proc = { kill: vi.fn() };
    spawned.push({ args, handlers, proc });
    return proc;
  });
  const manager = createRelayManager({
    spawnRelay,
    buildRelayArgs,
    broadcastIPC: (channel, data) => broadcasts.push({ channel, data }),
    rtmpPort: 1935,
    now: () => 1000,
    onLive: (s, d) => live.push({ s, d }),
    onTransientFailure: (item) => transient.push(item),
    ...overrides,
  });
  return { manager, spawned, broadcasts, live, transient, spawnRelay };
}

const DEST = { id: 'd1', url: 'rtmp://x/live2', streamKey: 'key1' };

describe('relay-manager', () => {
  it('starts a relay, broadcasts connecting then live, and fires onLive', () => {
    const { manager, spawned, broadcasts, live } = makeManager();
    manager.start('grid', DEST);
    expect(broadcasts[0]).toEqual({
      channel: 'relay-status',
      data: { sourceKey: 'grid', destinationId: 'd1', state: 'connecting' },
    });
    spawned[0].handlers.onStart();
    expect(broadcasts.at(-1).data.state).toBe('live');
    expect(live).toEqual([{ s: 'grid', d: 'd1' }]);
    expect(manager.has('grid', 'd1')).toBe(true);
    expect(manager.size()).toBe(1);
  });

  it('emits relay-stats parsed from stderr with uptime', () => {
    const { manager, spawned, broadcasts } = makeManager({ now: () => 5000 });
    manager.start('grid', DEST);
    spawned[0].handlers.onStderr(
      'frame= 90 fps= 30 drop=2 size= 100kB time=00:00:03.00 bitrate=2500.0kbits/s speed=1.0x',
    );
    const stat = broadcasts.find((b) => b.channel === 'relay-stats').data;
    expect(stat.fps).toBe(30);
    expect(stat.droppedFrames).toBe(2);
    expect(stat.sourceKey).toBe('grid');
    expect(stat.destinationId).toBe('d1');
    expect(stat.uptimeSec).toBe(0); // now()-startedAt both 5000
  });

  it('classifies an auth error as fatal: error state, no transient retry', () => {
    const { manager, spawned, broadcasts, transient } = makeManager();
    manager.start('grid', DEST);
    spawned[0].handlers.onError(new Error('401 Unauthorized'));
    expect(broadcasts.at(-1).data.state).toBe('error');
    expect(transient).toHaveLength(0);
    expect(manager.has('grid', 'd1')).toBe(false);
  });

  it('classifies a network error as transient: reconnecting + onTransientFailure', () => {
    const { manager, spawned, broadcasts, transient } = makeManager();
    manager.start('grid', DEST);
    spawned[0].handlers.onError(new Error('Connection reset by peer'));
    expect(broadcasts.at(-1).data.state).toBe('reconnecting');
    expect(transient).toEqual([{ sourceKey: 'grid', destination: DEST }]);
    expect(manager.has('grid', 'd1')).toBe(false);
  });

  it('treats SIGKILL as a clean stop (no retry, no error)', () => {
    const { manager, spawned, broadcasts, transient } = makeManager();
    manager.start('grid', DEST);
    spawned[0].handlers.onError(new Error('ffmpeg was killed with signal SIGKILL'));
    expect(broadcasts.at(-1).data.state).toBe('stopped');
    expect(transient).toHaveLength(0);
  });

  it('stop() kills the proc and removes the entry; stopForSource targets one source', () => {
    const { manager, spawned } = makeManager();
    manager.start('grid', DEST);
    manager.start('feed-x', { id: 'd2', url: 'rtmp://y/app', streamKey: 'k2' });
    manager.stopForSource('grid');
    expect(spawned[0].proc.kill).toHaveBeenCalled();
    expect(manager.has('grid', 'd1')).toBe(false);
    expect(manager.has('feed-x', 'd2')).toBe(true);
    manager.stopAll();
    expect(manager.size()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/relay-manager.test.js`
Expected: FAIL — cannot resolve `./relay-manager.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/server/relay-manager.js`:
```javascript
'use strict';

const { parseFfmpegProgress } = require('./ffmpeg-progress');

// Clear config/auth failures that will NOT self-heal — surface as error, no retry.
const FATAL = /(401|403|Unauthorized|Forbidden|Invalid stream key|no such host|Name or service not known|nonexistent stream)/i;

/**
 * Keyed copy-relay engine (sibling of pipe-manager). One FFmpeg process per
 * destination, pulling from local NMS and copying to a platform. Does NOT
 * self-restart: transient failures are handed to onTransientFailure so the
 * reconnection-supervisor can stagger/prioritize reconnects globally.
 *
 * @param {object} deps
 * @param {(args:object, handlers:{onStart:Function,onStderr:Function,onError:Function}) => {kill:Function}} deps.spawnRelay
 * @param {Function} deps.buildRelayArgs
 * @param {(channel:string,data:object)=>void} deps.broadcastIPC
 * @param {number} deps.rtmpPort
 * @param {() => number} [deps.now]
 * @param {(sourceKey:string,destinationId:string)=>void} [deps.onLive]
 * @param {(item:{sourceKey:string,destination:object})=>void} [deps.onTransientFailure]
 */
function createRelayManager({
  spawnRelay,
  buildRelayArgs,
  broadcastIPC,
  rtmpPort,
  now = () => Date.now(),
  onLive = () => {},
  onTransientFailure = () => {},
}) {
  const relays = new Map(); // key -> { proc, sourceKey, destination, startedAt }
  const keyOf = (sourceKey, destinationId) => `relay:${sourceKey}:${destinationId}`;

  function start(sourceKey, destination) {
    const key = keyOf(sourceKey, destination.id);
    const existing = relays.get(key);
    if (existing && existing.proc) existing.proc.kill();

    const args = buildRelayArgs({ sourceKey, destination, rtmpPort });
    broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'connecting' });

    const entry = { proc: null, sourceKey, destination, startedAt: now() };
    relays.set(key, entry);

    entry.proc = spawnRelay(args, {
      onStart: () => {
        broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'live' });
        onLive(sourceKey, destination.id);
      },
      onStderr: (line) => {
        const p = parseFfmpegProgress(line);
        if (!p) return;
        broadcastIPC('relay-stats', {
          sourceKey,
          destinationId: destination.id,
          fps: p.fps,
          bitrate: p.bitrate,
          speed: p.speed,
          droppedFrames: p.droppedFrames,
          frame: p.frame,
          size: p.size,
          time: p.time,
          uptimeSec: Math.floor((now() - entry.startedAt) / 1000),
        });
      },
      onError: (err) => handleError(key, err),
    });
  }

  function handleError(key, err) {
    const entry = relays.get(key);
    if (!entry) return;
    const { sourceKey, destination } = entry;
    const message = (err && err.message) || String(err);

    if (/SIGKILL|SIGINT|killed/i.test(message)) {
      broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'stopped' });
      relays.delete(key);
      return;
    }
    if (FATAL.test(message)) {
      broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'error', message });
      relays.delete(key);
      return;
    }
    // Transient (default): let the supervisor schedule a staggered reconnect.
    broadcastIPC('relay-status', { sourceKey, destinationId: destination.id, state: 'reconnecting', message });
    relays.delete(key);
    onTransientFailure({ sourceKey, destination });
  }

  function stop(sourceKey, destinationId) {
    const key = keyOf(sourceKey, destinationId);
    const entry = relays.get(key);
    if (!entry) return;
    if (entry.proc) entry.proc.kill();
    relays.delete(key);
    broadcastIPC('relay-status', { sourceKey, destinationId, state: 'stopped' });
  }

  function stopForSource(sourceKey) {
    for (const entry of [...relays.values()]) {
      if (entry.sourceKey === sourceKey) stop(sourceKey, entry.destination.id);
    }
  }

  function stopAll() {
    for (const entry of [...relays.values()]) stop(entry.sourceKey, entry.destination.id);
  }

  return {
    start,
    stop,
    stopForSource,
    stopAll,
    has: (s, d) => relays.has(keyOf(s, d)),
    size: () => relays.size,
  };
}

module.exports = { createRelayManager };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/relay-manager.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/relay-manager.js packages/server/relay-manager.test.js
git commit -m "feat(server): relay-manager keyed copy-relay lifecycle"
```

---

## Task 5: `reconnection-supervisor` — staggered, priority-ordered reconnects

**Note on the spec's "head-is-canary" intent:** realized here as a *global failure-streak backoff*. All (re)connects flow through ONE queue drained serially (never N starts at once), highest-priority first, each start paced by `delay + jitter`. Sustained failures grow the global delay up to `maxDelay` (effectively holding the queue against a dead link); any relay reaching `live` calls `notifyLive()` which resets the streak. This delivers the spec's guarantees: serial, priority-ordered, jitter-desynchronized, backed-off, self-resetting.

**Files:**
- Create: `packages/server/reconnection-supervisor.js`
- Create: `packages/server/reconnection-supervisor.test.js`

- [ ] **Step 1: Write the failing test**

`packages/server/reconnection-supervisor.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReconnectionSupervisor } from './reconnection-supervisor.js';

const D = (id, priority) => ({ id, url: 'rtmp://x/app', streamKey: 'k', priority });

function makeSup(overrides = {}) {
  const started = [];
  const sup = createReconnectionSupervisor({
    startRelay: (item) => started.push(item),
    setTimer: setTimeout,
    clearTimer: clearTimeout,
    now: () => nowVal,
    jitter: () => 0,
    baseDelay: 1000,
    maxDelay: 8000,
    ...overrides,
  });
  return { sup, started };
}
let nowVal = 0;

describe('reconnection-supervisor', () => {
  beforeEach(() => { vi.useFakeTimers(); nowVal = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('drains serially in priority order, one start per tick', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('low', 5) });
    sup.enqueue({ sourceKey: 'grid', destination: D('high', 0) });
    sup.enqueue({ sourceKey: 'grid', destination: D('mid', 2) });

    vi.advanceTimersByTime(0);            // first drain
    expect(started.map((s) => s.destination.id)).toEqual(['high']);
    vi.advanceTimersByTime(1000);
    expect(started.map((s) => s.destination.id)).toEqual(['high', 'mid']);
    vi.advanceTimersByTime(1000);
    expect(started.map((s) => s.destination.id)).toEqual(['high', 'mid', 'low']);
  });

  it('de-dupes a re-enqueued item already pending', () => {
    const { sup } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    expect(sup.pending()).toBe(1);
  });

  it('grows the delay when an item is re-enqueued soon after starting (failure)', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    vi.advanceTimersByTime(0);            // start 'a' (streak 0 -> delay 1000)
    expect(started).toHaveLength(1);
    nowVal = 100;                         // shortly after
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) }); // re-enqueue = it failed
    vi.advanceTimersByTime(1999);
    expect(started).toHaveLength(1);      // not yet — backoff grew past 1000
    vi.advanceTimersByTime(1);            // 2000ms => 2^1 * 1000
    expect(started).toHaveLength(2);
  });

  it('notifyLive resets the backoff streak', () => {
    const { sup, started } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    vi.advanceTimersByTime(0);
    nowVal = 100;
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) }); // streak -> 1
    sup.notifyLive('grid', 'b');                                 // any live resets
    vi.advanceTimersByTime(1000);                                // back to base delay
    expect(started).toHaveLength(2);
  });

  it('cancel removes pending items for a source', () => {
    const { sup } = makeSup();
    sup.enqueue({ sourceKey: 'grid', destination: D('a', 0) });
    sup.enqueue({ sourceKey: 'feed-x', destination: D('b', 0) });
    sup.cancel('grid');
    expect(sup.pending()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/reconnection-supervisor.test.js`
Expected: FAIL — cannot resolve `./reconnection-supervisor.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/server/reconnection-supervisor.js`:
```javascript
'use strict';

/**
 * Staggered, priority-ordered (re)connect scheduler for relays. Solves the
 * thundering-herd problem: a network drop fails every relay at once, so instead
 * of each spinning its own synchronized backoff, ALL (re)connects flow through
 * one queue drained serially (one start per tick), highest-priority first, each
 * paced by delay + jitter. Sustained failures grow a global backoff up to
 * maxDelay (holding the queue against a dead link); any relay reaching 'live'
 * calls notifyLive() to reset it. Time + jitter are injected for deterministic
 * tests.
 *
 * @param {object} deps
 * @param {(item:{sourceKey:string,destination:object})=>void} deps.startRelay
 * @param {Function} [deps.setTimer]   - setTimeout-compatible
 * @param {Function} [deps.clearTimer] - clearTimeout-compatible
 * @param {() => number} [deps.now]
 * @param {() => number} [deps.jitter] - extra ms added to each scheduled delay
 * @param {number} [deps.baseDelay]
 * @param {number} [deps.maxDelay]
 */
function createReconnectionSupervisor({
  startRelay,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  jitter = () => 0,
  baseDelay = 1500,
  maxDelay = 30000,
}) {
  const queue = [];          // [{ sourceKey, destination }]
  const lastStart = new Map(); // id -> timestamp
  let streak = 0;
  let scheduled = false;
  let timer = null;

  const idOf = (i) => `${i.sourceKey}:${i.destination.id}`;
  const prio = (i) =>
    typeof i.destination.priority === 'number' ? i.destination.priority : Number.MAX_SAFE_INTEGER;
  const delay = () => Math.min(baseDelay * Math.pow(2, streak), maxDelay);

  function enqueue(item) {
    const id = idOf(item);
    const startedAt = lastStart.get(id);
    // Re-enqueued soon after we started it => that attempt failed; grow backoff.
    if (startedAt != null && now() - startedAt < maxDelay) streak += 1;
    if (!queue.some((q) => idOf(q) === id)) {
      queue.push(item);
      queue.sort((a, b) => prio(a) - prio(b));
    }
    schedule(delay());
  }

  function cancel(sourceKey, destinationId) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q.sourceKey === sourceKey && (destinationId == null || q.destination.id === destinationId)) {
        lastStart.delete(idOf(q));
        queue.splice(i, 1);
      }
    }
  }

  function notifyLive(sourceKey, destinationId) {
    streak = 0;
    lastStart.delete(`${sourceKey}:${destinationId}`);
  }

  function schedule(ms) {
    if (scheduled || queue.length === 0) return;
    scheduled = true;
    if (timer) clearTimer(timer);
    timer = setTimer(run, ms + jitter());
  }

  function run() {
    scheduled = false;
    if (queue.length === 0) return;
    const head = queue.shift();
    lastStart.set(idOf(head), now());
    startRelay({ sourceKey: head.sourceKey, destination: head.destination });
    schedule(delay()); // pace the next start
  }

  return { enqueue, cancel, notifyLive, pending: () => queue.length };
}

module.exports = { createReconnectionSupervisor };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/reconnection-supervisor.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/reconnection-supervisor.js packages/server/reconnection-supervisor.test.js
git commit -m "feat(server): reconnection-supervisor (serial, priority, jittered backoff)"
```

---

## Task 6: `broadcast-orchestrator` — couple NMS liveness to relay fan-out

**Files:**
- Create: `packages/server/broadcast-orchestrator.js`
- Create: `packages/server/broadcast-orchestrator.test.js`

- [ ] **Step 1: Write the failing test**

`packages/server/broadcast-orchestrator.test.js`:
```javascript
import { describe, it, expect, vi } from 'vitest';
import { createBroadcastOrchestrator } from './broadcast-orchestrator.js';

function make({ bindings = [], destinations = [] } = {}) {
  const enq = [];
  const supervisor = { enqueue: (i) => enq.push(i), cancel: vi.fn() };
  const relayManager = { stopForSource: vi.fn() };
  const orch = createBroadcastOrchestrator({
    supervisor,
    relayManager,
    listBindings: () => bindings,
    listDestinations: () => destinations,
  });
  return { orch, enq, supervisor, relayManager };
}

const YT = { id: 'yt', url: 'rtmp://x', streamKey: 'k', enabled: true };
const KICK = { id: 'kick', url: 'rtmp://y', streamKey: 'k2', enabled: true };

describe('broadcast-orchestrator', () => {
  it('enqueues every active+enabled destination for a published source', () => {
    const { orch, enq } = make({
      bindings: [
        { sourceKey: 'grid', destinationId: 'yt', active: true },
        { sourceKey: 'grid', destinationId: 'kick', active: false },
      ],
      destinations: [YT, KICK],
    });
    orch.onSourcePublished('grid');
    expect(enq).toEqual([{ sourceKey: 'grid', destination: YT }]);
  });

  it('skips disabled destinations even when the binding is active', () => {
    const { orch, enq } = make({
      bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }],
      destinations: [{ ...YT, enabled: false }],
    });
    orch.onSourcePublished('grid');
    expect(enq).toHaveLength(0);
  });

  it('on unpublish cancels pending and stops running relays for that source', () => {
    const { orch, supervisor, relayManager } = make();
    orch.onSourceUnpublished('grid');
    expect(supervisor.cancel).toHaveBeenCalledWith('grid');
    expect(relayManager.stopForSource).toHaveBeenCalledWith('grid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/broadcast-orchestrator.test.js`
Expected: FAIL — cannot resolve `./broadcast-orchestrator.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/server/broadcast-orchestrator.js`:
```javascript
'use strict';

/**
 * Couples source liveness (NMS postPublish/donePublish) to relay fan-out. When a
 * source goes live on the local NMS, every ACTIVE binding for that source whose
 * destination is enabled is enqueued for a (staggered) relay start; when the
 * source stops, pending reconnects are cancelled and running relays are stopped.
 * Keeps this cross-module logic out of main.js and fully unit-testable.
 *
 * @param {object} deps
 * @param {{enqueue:Function, cancel:Function}} deps.supervisor
 * @param {{stopForSource:Function}} deps.relayManager
 * @param {() => Array} deps.listBindings
 * @param {() => Array} deps.listDestinations
 */
function createBroadcastOrchestrator({ supervisor, relayManager, listBindings, listDestinations }) {
  function destinationsForSource(sourceKey) {
    const active = listBindings().filter((b) => b.sourceKey === sourceKey && b.active);
    const byId = new Map(listDestinations().map((d) => [d.id, d]));
    return active.map((b) => byId.get(b.destinationId)).filter((d) => d && d.enabled);
  }

  function onSourcePublished(sourceKey) {
    for (const destination of destinationsForSource(sourceKey)) {
      supervisor.enqueue({ sourceKey, destination });
    }
  }

  function onSourceUnpublished(sourceKey) {
    supervisor.cancel(sourceKey);
    relayManager.stopForSource(sourceKey);
  }

  return { onSourcePublished, onSourceUnpublished, destinationsForSource };
}

module.exports = { createBroadcastOrchestrator };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/broadcast-orchestrator.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/broadcast-orchestrator.js packages/server/broadcast-orchestrator.test.js
git commit -m "feat(server): broadcast-orchestrator (NMS liveness -> relay fan-out)"
```

---

## Task 7: Bindings persistence in `destinationStore`

**Files:**
- Modify: `packages/server/destinationStore.js`
- Modify: `packages/server/destinationStore.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/destinationStore.test.js` (inside the existing top-level scope; reuse the existing `newStore()` helper if present, otherwise this self-contained block):
```javascript
import { describe, it, expect, vi } from 'vitest';
import { createDestinationStore } from './destinationStore.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dest-store-'));
  const store = createDestinationStore({
    getUserDataDir: () => dir,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
  });
  return { store, dir };
}

describe('destinationStore bindings', () => {
  it('returns [] when no bindings file exists', () => {
    const { store } = tmpStore();
    expect(store.loadBindings()).toEqual([]);
  });

  it('upserts a binding by (sourceKey, destinationId)', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: false }); // update
    store.setBinding({ sourceKey: 'grid', destinationId: 'kick', active: true });
    const list = store.loadBindings();
    expect(list).toHaveLength(2);
    expect(list.find((b) => b.destinationId === 'yt').active).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/destinationStore.test.js`
Expected: FAIL — `store.loadBindings is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `packages/server/destinationStore.js`, add a constant near `FILE_NAME`:
```javascript
const BINDINGS_FILE = 'bindings.json';
```
Inside `createDestinationStore`, add these functions before the `return`:
```javascript
  const bindingsPath = () => path.join(getUserDataDir(), BINDINGS_FILE);

  function loadBindings() {
    const file = bindingsPath();
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function saveBindings(list) {
    fs.writeFileSync(bindingsPath(), JSON.stringify(list, null, 2), 'utf8');
  }

  function setBinding(binding) {
    const list = loadBindings();
    const i = list.findIndex(
      (b) => b.sourceKey === binding.sourceKey && b.destinationId === binding.destinationId,
    );
    if (i >= 0) list[i] = binding;
    else list.push(binding);
    saveBindings(list);
  }
```
Add them to the returned object:
```javascript
  return {
    loadDestinations,
    saveDestinations,
    addDestination,
    removeDestination,
    updateDestination,
    loadBindings,
    saveBindings,
    setBinding,
  };
```
And add to the singleton passthroughs at the bottom of the file:
```javascript
  loadBindings: (...args) => getDefaultStore().loadBindings(...args),
  saveBindings: (...args) => getDefaultStore().saveBindings(...args),
  setBinding: (...args) => getDefaultStore().setBinding(...args),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/destinationStore.test.js`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/server/destinationStore.js packages/server/destinationStore.test.js
git commit -m "feat(server): persist destination bindings (bindings.json)"
```

---

## Task 8: `bindings:list|set` IPC handlers

**Files:**
- Modify: `packages/server/destinationHandlers.js`
- Modify: `packages/server/destinationHandlers.test.js`

- [ ] **Step 1: Write the failing test**

Append to `packages/server/destinationHandlers.test.js` (mirror the existing `makeIpc()` helper style — if the file already defines one, reuse it; otherwise use this):
```javascript
import { describe, it, expect, vi } from 'vitest';
import { registerDestinationHandlers } from './destinationHandlers.js';

function makeIpc() {
  const handlers = {};
  return {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
    invoke: (ch, ...args) => handlers[ch]({}, ...args),
    handlers,
  };
}

describe('bindings handlers', () => {
  it('wires bindings:list and bindings:set to the store', async () => {
    const deps = {
      loadDestinations: vi.fn(), addDestination: vi.fn(),
      removeDestination: vi.fn(), updateDestination: vi.fn(),
      loadBindings: vi.fn(() => [{ sourceKey: 'grid', destinationId: 'yt', active: true }]),
      setBinding: vi.fn(),
    };
    const { ipcMain, invoke } = makeIpc();
    registerDestinationHandlers(ipcMain, deps);

    expect(await invoke('bindings:list')).toEqual([
      { sourceKey: 'grid', destinationId: 'yt', active: true },
    ]);
    await invoke('bindings:set', { sourceKey: 'grid', destinationId: 'kick', active: true });
    expect(deps.setBinding).toHaveBeenCalledWith({
      sourceKey: 'grid', destinationId: 'kick', active: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/destinationHandlers.test.js`
Expected: FAIL — `bindings:list` handler not registered (handler is undefined).

- [ ] **Step 3: Write minimal implementation**

In `packages/server/destinationHandlers.js`, inside `registerDestinationHandlers`, after the existing `destinations:update` handler add:
```javascript
  ipcMain.handle('bindings:list', () => deps.loadBindings());

  ipcMain.handle('bindings:set', (_event, binding) => {
    deps.setBinding(binding);
    return true;
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/destinationHandlers.test.js`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add packages/server/destinationHandlers.js packages/server/destinationHandlers.test.js
git commit -m "feat(server): bindings:list|set IPC handlers"
```

---

## Task 9: Client stream-key slugify helper (DRY + harden)

**Files:**
- Create: `packages/client/src/utils/streamKey.ts`
- Create: `packages/client/src/utils/streamKey.test.ts`
- Modify: `packages/client/src/components/VideoFeed.tsx:71` and `:157`

- [ ] **Step 1: Write the failing test**

`packages/client/src/utils/streamKey.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { slugifyStreamKey, feedKey } from './streamKey';

describe('slugifyStreamKey', () => {
  it('collapses spaces, commas, and punctuation into single dashes', () => {
    expect(slugifyStreamKey('Mobile rotic - camera 2, facing back'))
      .toBe('mobile-rotic-camera-2-facing-back');
  });
  it('trims leading/trailing dashes and lowercases', () => {
    expect(slugifyStreamKey('  --Front Cam--  ')).toBe('front-cam');
  });
  it('falls back to "feed" for empty/punctuation-only input', () => {
    expect(slugifyStreamKey('!!!')).toBe('feed');
  });
});

describe('feedKey', () => {
  it('prefixes feed- onto the slug', () => {
    expect(feedKey('Mobile rotic - camera 2, facing back'))
      .toBe('feed-mobile-rotic-camera-2-facing-back');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/client/src/utils/streamKey.test.ts`
Expected: FAIL — cannot resolve `./streamKey`.

- [ ] **Step 3: Write minimal implementation**

`packages/client/src/utils/streamKey.ts`:
```typescript
/**
 * Turn a human camera label into a safe RTMP stream-key segment.
 * RTMP paths and relay keys are derived from this, so it must produce only
 * [a-z0-9-] with no leading/trailing or doubled dashes.
 */
export function slugifyStreamKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip accents
      .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> one dash
      .replace(/^-+|-+$/g, '') // trim dashes
    || 'feed'
  );
}

/** The per-feed stream key, e.g. feed-mobile-rotic-camera-2-facing-back. */
export function feedKey(label: string): string {
  return `feed-${slugifyStreamKey(label)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/client/src/utils/streamKey.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Use the helper at both VideoFeed sites (DRY)**

In `packages/client/src/components/VideoFeed.tsx`:
- Add the import near the top: `import { feedKey } from '../utils/streamKey';`
- Replace line 71:
  - From: `const streamKey = \`feed-${label.replace(/\s+/g, '-').toLowerCase()}\`;`
  - To: `const streamKey = feedKey(label);`
- Replace the display URL on line ~157 (the `rtmp://{rtmpHost}/live/feed-...` text) so the displayed key matches:
  - From: `feed-{label.replace(/\s+/g, '-').toLowerCase()}`
  - To: `{feedKey(label)}`

- [ ] **Step 6: Verify client builds + the VideoFeed tests still pass**

Run: `npx vitest run packages/client/src/components/VideoFeed.test.tsx` (if present) then `npm run build -w client`
Expected: PASS / build succeeds.

- [ ] **Step 7: Commit**

```bash
git add packages/client/src/utils/streamKey.ts packages/client/src/utils/streamKey.test.ts packages/client/src/components/VideoFeed.tsx
git commit -m "feat(client): hardened slugifyStreamKey + feedKey; DRY VideoFeed key derivation"
```

---

## Task 10: Wire it all into main.js (+ preload + electron-builder)

**Files:**
- Modify: `packages/server/main.js` (requires near other requires; `spawnRelay` + construction near pipe-manager at ~485-495; NMS hooks at 288/297; quit cleanup at 449)
- Modify: `packages/server/preload.js:19-42`
- Modify: `packages/server/package.json:42-53`

This task is integration — verified by the full server suite + a live smoke test (no new unit test file).

- [ ] **Step 1: Add requires**

In `packages/server/main.js`, near the existing `const { createPipeManager } = require('./pipe-manager');` (and the other requires), add:
```javascript
const { buildRelayArgs } = require('./relay-args');
const { createRelayManager } = require('./relay-manager');
const { createReconnectionSupervisor } = require('./reconnection-supervisor');
const { createBroadcastOrchestrator } = require('./broadcast-orchestrator');
const destinationStore = require('./destinationStore');
```

- [ ] **Step 2: Add the `spawnRelay` glue + construct the three managers**

In `packages/server/main.js`, immediately after the `pipeManager` construction block (after line ~495), add:
```javascript
/**
 * Thin fluent-ffmpeg glue for a copy relay: pull from local NMS, copy to the
 * platform. Kept out of relay-manager.js so that module stays process-free and
 * unit-testable; this glue is covered by the live smoke test.
 */
function spawnRelay(args, { onStart, onStderr, onError }) {
  return ffmpeg(args.inputUrl)
    .inputOptions(args.inputOptions)
    .outputOptions(args.outputOptions)
    .output(args.outputUrl)
    .on('start', onStart)
    .on('stderr', onStderr)
    .on('error', onError)
    .run();
}

// Relay fan-out (Multi-Stream Pro): one copy-relay per destination, scheduled
// through a single supervisor so reconnects after a network drop are staggered.
let reconnectionSupervisor; // declared first for the relay-manager callbacks
const relayManager = createRelayManager({
  spawnRelay,
  buildRelayArgs,
  broadcastIPC,
  rtmpPort: RTMP_PORT,
  onLive: (sourceKey, destinationId) => reconnectionSupervisor.notifyLive(sourceKey, destinationId),
  onTransientFailure: (item) => reconnectionSupervisor.enqueue(item),
});
reconnectionSupervisor = createReconnectionSupervisor({
  startRelay: (item) => relayManager.start(item.sourceKey, item.destination),
});
const broadcastOrchestrator = createBroadcastOrchestrator({
  supervisor: reconnectionSupervisor,
  relayManager,
  listBindings: () => destinationStore.loadBindings(),
  listDestinations: () => destinationStore.loadDestinations(),
});
```

- [ ] **Step 3: Hook the orchestrator into the NMS publish/unpublish events**

In the `nms.on('postPublish', ...)` handler (after `rtmpPublishers.set(...)` on line ~288), add:
```javascript
    broadcastOrchestrator.onSourcePublished(streamKey);
```
In the `nms.on('donePublish', ...)` handler (after `rtmpPublishers.delete(streamKey)` on line ~297), add:
```javascript
    broadcastOrchestrator.onSourceUnpublished(streamKey);
```

- [ ] **Step 4: Stop relays on quit**

In the `app.on('before-quit', ...)` handler (line ~449), add `relayManager.stopAll();` next to `pipeManager.stopAll();`:
```javascript
  app.on('before-quit', () => {
    pipeManager.stopAll();
    relayManager.stopAll();
    clearInterval(statusInterval);
    if (server) server.close();
    if (nms) nms.stop();
  });
```

- [ ] **Step 5: Allowlist the new IPC channels in preload**

In `packages/server/preload.js`:
- Add to `ON_CHANNELS` (lines 38-42): `'relay-status'`, `'relay-stats'`.
- Add to `INVOKE_CHANNELS` (lines 31-35): `'destinations:list'`, `'destinations:add'`, `'destinations:remove'`, `'destinations:update'`, `'bindings:list'`, `'bindings:set'`.
  (The `destinations:*` channels were registered in Phase 1 but never allowlisted — adding them completes the contract so the UI phase is pure renderer work.)

- [ ] **Step 6: Bundle the new modules in electron-builder**

In `packages/server/package.json` `build.files` (lines 42-53), add these entries to the array:
```json
    "ffmpeg-progress.js",
    "relay-args.js",
    "relay-manager.js",
    "reconnection-supervisor.js",
    "broadcast-orchestrator.js",
```

- [ ] **Step 7: Run the full server suite + lint to verify no regression**

Run: `npm run test -w server`
Expected: PASS — all suites green (existing + the new relay/supervisor/orchestrator/bindings tests).

- [ ] **Step 8: Commit**

```bash
git add packages/server/main.js packages/server/preload.js packages/server/package.json
git commit -m "feat(server): wire relay-manager + supervisor + orchestrator into main; allowlist relay/destination IPC"
```

---

## Task 11: Live smoke test (manual) + spec verification

- [ ] **Step 1:** `npm run dev`. Add two destinations (e.g. a local second NMS app or a real YouTube/Kick test key) via the (temporary) `destinations:add`/`bindings:set` IPC — there is no UI yet, so drive these from the renderer devtools console through the exposed bridge, or seed `destinations.json` + `bindings.json` in the userData dir.
- [ ] **Step 2:** Start the grid broadcast. Confirm the source publishes to NMS, then both relays appear (`relay-status` → connecting → live) and `relay-stats` flow with `droppedFrames`/`speed`.
- [ ] **Step 3:** Kill one destination's network (e.g. block its host in the firewall, or stop the second NMS). Confirm the *other* relay stays `live` and the killed one goes `reconnecting`, retrying on the staggered/backed-off schedule — not bursting.
- [ ] **Step 4:** Restore the network; confirm the killed relay returns to `live` and the backoff resets.
- [ ] **Step 5:** Stop the source; confirm both relays go `stopped` (not reconnecting). Quit the app; confirm no orphan `ffmpeg.exe` (Task Manager).
- [ ] **Step 6:** Update `MEMORY.md` session-state with results.

---

## Self-Review (completed by plan author)

**Spec coverage:** §3 architecture → Tasks 3,4,10. §4 contract types → Task 2 + emitted by Tasks 4 (relay-status/stats), 5. §5 model/persistence/slugify → Tasks 2,7,9. §6 lifecycle → Task 4. §6.1 reconnection → Task 5 (mechanism note reconciles "head-is-canary" → global failure-streak backoff). §6 orchestrator/NMS trigger → Tasks 6,10. §7 IPC → Tasks 8,10. §8 error classification → Task 4. §10 testing → every task is TDD + Task 11 live smoke. §11 files → all covered.

**Placeholder scan:** none — every code step has complete code; commands have expected output.

**Type consistency:** `relay:{sourceKey}:{destId}` key, `start(sourceKey, destination)`, `stopForSource`, `enqueue({sourceKey, destination})`, `notifyLive(sourceKey, destinationId)`, `onSourcePublished/onSourceUnpublished`, `loadBindings/setBinding` — used identically across tasks and the main.js wiring. `RelayStats` fields emitted in Task 4 match the Task 2 type.
