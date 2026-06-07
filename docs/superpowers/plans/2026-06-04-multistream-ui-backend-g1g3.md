# Multi-Stream UI — Backend G1–G3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three server-side relay-lifecycle gaps (G1 live-add, G2 unbind-stops-relay, G3 delete-cascade) so the upcoming restream UI's add/remove/delete actions actually start and stop relays — with no change to the current UI.

**Architecture:** All three gaps are wired through the existing dependency-injected backend seams. The `broadcast-orchestrator` (already the documented home for cross-module relay logic) gains three entry points (`onBindingAdded`, `onBindingRemoved`, `onDestinationRemoved`) plus an injected `isSourceLive` predicate; the `relay-manager` gains `stopForDestination`; the `destinationStore` gains `removeBinding` + `removeBindingsForDestination`; the IPC handlers route `bindings:set` / new `bindings:remove` / `destinations:remove` through those. `main.js` does the Electron glue (predicate backed by the `rtmpPublishers` Map it already tracks) and `preload.js` allowlists the new channel.

**Tech Stack:** Node.js (CommonJS server modules), Vitest (unit tests, Electron-free via DI), fluent-ffmpeg, Node-Media-Server v4, Electron IPC.

**Source of truth:** `docs/superpowers/specs/2026-06-04-multistream-ui-redesign-design.md` §7 (G1–G3) and §10.

**Deliberate deviation from spec §7:** The spec suggests extending the handler signature to `(ipcMain, { store, orchestrator, relayManager, isSourceLive })`. Instead, `relayManager` and `isSourceLive` are injected into the **orchestrator** (its JSDoc already declares it the cross-module relay-logic home), and the handler takes only `{ store, orchestrator }`. This keeps the IPC layer a thin router and avoids a second place that knows about relays. Same behavior, cleaner seams.

---

## File Structure

| File | Change | Responsibility after change |
|---|---|---|
| `packages/server/relay-manager.js` | Modify | Add `stopForDestination(destinationId)` — stop every relay whose destination matches, across all sources. |
| `packages/server/relay-manager.test.js` | Modify | Cover `stopForDestination`. |
| `packages/server/destinationStore.js` | Modify | Add `removeBinding(sourceKey, destinationId)` and `removeBindingsForDestination(destinationId)`; export both (instance + singleton passthrough). |
| `packages/server/destinationStore.test.js` | Modify | Cover the two new binding removers. |
| `packages/server/broadcast-orchestrator.js` | Modify | Add `onBindingAdded`, `onBindingRemoved`, `onDestinationRemoved`; accept injected `isSourceLive`. |
| `packages/server/broadcast-orchestrator.test.js` | Modify | Cover the three new entry points + liveness gating. |
| `packages/server/destinationHandlers.js` | Modify | New signature `(ipcMain, { store, orchestrator })`; route `bindings:set` (G1/G2), new `bindings:remove` (G2), `destinations:remove` cascade (G3). |
| `packages/server/destinationHandlers.test.js` | Modify | Update to new signature; cover new routing. |
| `packages/server/main.js` | Modify | Add `isSourceLive` predicate; inject into orchestrator; call `registerDestinationHandlers` with new deps. |
| `packages/server/preload.js` | Modify | Allowlist `bindings:remove` (invoke). |

No new files. The app keeps running identically — these are backend reactions to IPC calls the current UI does not yet make.

---

### Task 1: `relay-manager` — `stopForDestination`

**Files:**
- Modify: `packages/server/relay-manager.js:114-125` (add function, extend the returned object)
- Test: `packages/server/relay-manager.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe('relay-manager', …)` block in `packages/server/relay-manager.test.js` (before its closing `});`):

```js
  it('stopForDestination stops every relay for that destination across sources', () => {
    const { manager, spawned, broadcasts } = makeManager();
    const A = { id: 'd1', url: 'rtmp://x/live2', streamKey: 'k1' };
    const B = { id: 'd2', url: 'rtmp://y/live2', streamKey: 'k2' };
    manager.start('grid', A);
    manager.start('feed-cam', A); // same destination, different source
    manager.start('grid', B);     // different destination — must survive
    expect(manager.size()).toBe(3);

    manager.stopForDestination('d1');

    expect(manager.has('grid', 'd1')).toBe(false);
    expect(manager.has('feed-cam', 'd1')).toBe(false);
    expect(manager.has('grid', 'd2')).toBe(true);
    expect(manager.size()).toBe(1);
    // each stopped relay broadcasts a 'stopped' status
    const stopped = broadcasts.filter(
      (b) => b.channel === 'relay-status' && b.data.state === 'stopped',
    );
    expect(stopped.map((b) => `${b.data.sourceKey}:${b.data.destinationId}`).sort()).toEqual([
      'feed-cam:d1',
      'grid:d1',
    ]);
    // the survivor's process was never killed
    expect(spawned.find((s) => s.args.outputUrl.includes('k2')).proc.kill).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/relay-manager.test.js -t "stopForDestination"`
Expected: FAIL with `manager.stopForDestination is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `packages/server/relay-manager.js`, add `stopForDestination` right after the existing `stopForSource` function (after line 112):

```js
  function stopForDestination(destinationId) {
    for (const entry of [...relays.values()]) {
      if (entry.destination.id === destinationId) stop(entry.sourceKey, destinationId);
    }
  }
```

Then add it to the returned object (the `return { … }` block at line 118):

```js
  return {
    start,
    stop,
    stopForSource,
    stopForDestination,
    stopAll,
    has: (s, d) => relays.has(keyOf(s, d)),
    size: () => relays.size,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/relay-manager.test.js`
Expected: PASS (all relay-manager tests green, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/server/relay-manager.js packages/server/relay-manager.test.js
git commit -m "feat(server): relayManager.stopForDestination for delete-cascade (G3)"
```

---

### Task 2: `destinationStore` — `removeBinding` + `removeBindingsForDestination`

**Files:**
- Modify: `packages/server/destinationStore.js` (add two functions; export on instance + singleton)
- Test: `packages/server/destinationStore.test.js`

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe('destinationStore bindings', …)` block in `packages/server/destinationStore.test.js` (before its closing `});`). It reuses the `tmpStore()` helper already defined in that block:

```js
  it('removeBinding drops only the matching (sourceKey, destinationId)', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.setBinding({ sourceKey: 'grid', destinationId: 'kick', active: true });
    store.setBinding({ sourceKey: 'feed-cam', destinationId: 'yt', active: true });

    store.removeBinding('grid', 'yt');

    const ids = store.loadBindings().map((b) => `${b.sourceKey}:${b.destinationId}`).sort();
    expect(ids).toEqual(['feed-cam:yt', 'grid:kick']);
  });

  it('removeBinding is a no-op when nothing matches', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.removeBinding('grid', 'ghost');
    expect(store.loadBindings()).toHaveLength(1);
  });

  it('removeBindingsForDestination drops every binding for that destination across sources', () => {
    const { store } = tmpStore();
    store.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true });
    store.setBinding({ sourceKey: 'feed-cam', destinationId: 'yt', active: false });
    store.setBinding({ sourceKey: 'grid', destinationId: 'kick', active: true });

    store.removeBindingsForDestination('yt');

    const list = store.loadBindings();
    expect(list).toEqual([{ sourceKey: 'grid', destinationId: 'kick', active: true }]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/destinationStore.test.js -t "removeBinding"`
Expected: FAIL with `store.removeBinding is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `packages/server/destinationStore.js`, add both functions right after `setBinding` (after line 86, before the `return { … }`):

```js
  function removeBinding(sourceKey, destinationId) {
    saveBindings(
      loadBindings().filter(
        (b) => !(b.sourceKey === sourceKey && b.destinationId === destinationId),
      ),
    );
  }

  function removeBindingsForDestination(destinationId) {
    saveBindings(loadBindings().filter((b) => b.destinationId !== destinationId));
  }
```

Add both to the instance `return` object (the block at line 88):

```js
  return {
    loadDestinations,
    saveDestinations,
    addDestination,
    removeDestination,
    updateDestination,
    loadBindings,
    saveBindings,
    setBinding,
    removeBinding,
    removeBindingsForDestination,
  };
```

Add both to the singleton passthrough `module.exports` (the block at line 115):

```js
  loadBindings: (...args) => getDefaultStore().loadBindings(...args),
  saveBindings: (...args) => getDefaultStore().saveBindings(...args),
  setBinding: (...args) => getDefaultStore().setBinding(...args),
  removeBinding: (...args) => getDefaultStore().removeBinding(...args),
  removeBindingsForDestination: (...args) => getDefaultStore().removeBindingsForDestination(...args),
};
```

(Keep the existing `createDestinationStore`, `loadDestinations`, … entries above these — only add the two new lines and ensure the closing `};` stays.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/destinationStore.test.js`
Expected: PASS (all destinationStore tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/server/destinationStore.js packages/server/destinationStore.test.js
git commit -m "feat(server): store removeBinding + removeBindingsForDestination (G2/G3)"
```

---

### Task 3: `broadcast-orchestrator` — bind lifecycle + liveness gate

**Files:**
- Modify: `packages/server/broadcast-orchestrator.js` (accept `isSourceLive`; add three entry points)
- Test: `packages/server/broadcast-orchestrator.test.js`

**What each entry point does:**
- `onBindingAdded(sourceKey, destination)` — G1: enqueue a relay **only if** the destination is enabled **and** the source is currently publishing (`isSourceLive`). Pre-wiring an offline source must NOT start a relay.
- `onBindingRemoved(sourceKey, destinationId)` — G2: cancel any pending reconnect for that pair and stop the running relay.
- `onDestinationRemoved(destinationId)` — G3: stop every relay for that destination across all sources.

- [ ] **Step 1: Write the failing test**

In `packages/server/broadcast-orchestrator.test.js`, replace the existing `make(…)` helper (lines 4-15) with this version that also injects `isSourceLive`, `relayManager.stop`, `relayManager.stopForDestination`, and a spied `supervisor.cancel` capturing args:

```js
function make({ bindings = [], destinations = [], liveSources = [] } = {}) {
  const enq = [];
  const supervisor = { enqueue: (i) => enq.push(i), cancel: vi.fn() };
  const relayManager = { stopForSource: vi.fn(), stop: vi.fn(), stopForDestination: vi.fn() };
  const orch = createBroadcastOrchestrator({
    supervisor,
    relayManager,
    listBindings: () => bindings,
    listDestinations: () => destinations,
    isSourceLive: (key) => liveSources.includes(key),
  });
  return { orch, enq, supervisor, relayManager };
}
```

Then append these tests inside the `describe('broadcast-orchestrator', …)` block (before its closing `});`):

```js
  it('onBindingAdded enqueues when the source is live and the destination enabled', () => {
    const { orch, enq } = make({ liveSources: ['grid'] });
    orch.onBindingAdded('grid', YT);
    expect(enq).toEqual([{ sourceKey: 'grid', destination: YT }]);
  });

  it('onBindingAdded does NOT enqueue when the source is offline (pre-wiring)', () => {
    const { orch, enq } = make({ liveSources: [] });
    orch.onBindingAdded('grid', YT);
    expect(enq).toHaveLength(0);
  });

  it('onBindingAdded does NOT enqueue a disabled destination even if the source is live', () => {
    const { orch, enq } = make({ liveSources: ['grid'] });
    orch.onBindingAdded('grid', { ...YT, enabled: false });
    expect(enq).toHaveLength(0);
  });

  it('onBindingRemoved cancels the pending reconnect and stops the running relay', () => {
    const { orch, supervisor, relayManager } = make();
    orch.onBindingRemoved('grid', 'yt');
    expect(supervisor.cancel).toHaveBeenCalledWith('grid', 'yt');
    expect(relayManager.stop).toHaveBeenCalledWith('grid', 'yt');
  });

  it('onDestinationRemoved stops every relay for that destination', () => {
    const { orch, relayManager } = make();
    orch.onDestinationRemoved('yt');
    expect(relayManager.stopForDestination).toHaveBeenCalledWith('yt');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/broadcast-orchestrator.test.js -t "onBinding"`
Expected: FAIL with `orch.onBindingAdded is not a function`.

- [ ] **Step 3: Write minimal implementation**

Rewrite `packages/server/broadcast-orchestrator.js` to accept `isSourceLive` and expose the three entry points. Full file:

```js
'use strict';

/**
 * Couples source liveness (NMS postPublish/donePublish) AND destination-binding
 * mutations to relay fan-out. When a source goes live, every ACTIVE binding whose
 * destination is enabled is enqueued for a (staggered) relay start; when a source
 * stops, pending reconnects are cancelled and running relays stopped. Binding/
 * destination CRUD reacts live: adding a binding to an already-live source starts
 * its relay; removing a binding or deleting a destination stops the relay(s).
 * Keeps all cross-module relay logic out of main.js and fully unit-testable.
 *
 * @param {object} deps
 * @param {{enqueue:Function, cancel:Function}} deps.supervisor
 * @param {{stopForSource:Function, stop:Function, stopForDestination:Function}} deps.relayManager
 * @param {() => Array} deps.listBindings
 * @param {() => Array} deps.listDestinations
 * @param {(sourceKey:string) => boolean} [deps.isSourceLive] - is this streamKey publishing now?
 */
function createBroadcastOrchestrator({
  supervisor,
  relayManager,
  listBindings,
  listDestinations,
  isSourceLive = () => false,
}) {
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

  // G1: a binding added (or re-activated) starts its relay immediately, but only
  // if the source is already publishing and the destination is enabled. A binding
  // to an offline source is just pre-wiring — it starts when the source goes live.
  function onBindingAdded(sourceKey, destination) {
    if (destination && destination.enabled && isSourceLive(sourceKey)) {
      supervisor.enqueue({ sourceKey, destination });
    }
  }

  // G2: a binding removed/deactivated cancels any pending reconnect and stops the
  // one running relay for that exact pair.
  function onBindingRemoved(sourceKey, destinationId) {
    supervisor.cancel(sourceKey, destinationId);
    relayManager.stop(sourceKey, destinationId);
  }

  // G3: a destination deleted stops its relays across every source.
  function onDestinationRemoved(destinationId) {
    relayManager.stopForDestination(destinationId);
  }

  return {
    onSourcePublished,
    onSourceUnpublished,
    onBindingAdded,
    onBindingRemoved,
    onDestinationRemoved,
    destinationsForSource,
  };
}

module.exports = { createBroadcastOrchestrator };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/broadcast-orchestrator.test.js`
Expected: PASS (existing 4 tests + 5 new tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/server/broadcast-orchestrator.js packages/server/broadcast-orchestrator.test.js
git commit -m "feat(server): orchestrator onBindingAdded/Removed/onDestinationRemoved + liveness gate (G1/G2/G3)"
```

---

### Task 4: `destinationHandlers` — route live-add / unbind / delete-cascade

**Files:**
- Modify: `packages/server/destinationHandlers.js` (new signature + routing)
- Test: `packages/server/destinationHandlers.test.js`

**New signature:** `registerDestinationHandlers(ipcMain, { store, orchestrator })`. This is a breaking change — the old `(ipcMain, store)` form and its default are removed, so the existing tests are updated in the same task (Step 1).

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `packages/server/destinationHandlers.test.js` with:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerDestinationHandlers } from './destinationHandlers.js';

// Minimal fake ipcMain that records the handler registered per channel.
const makeIpc = () => {
  const handlers = {};
  return {
    handle: (channel, fn) => { handlers[channel] = fn; },
    invoke: (channel, ...args) => handlers[channel]({}, ...args),
    handlers,
  };
};

const YT = { id: 'yt', name: 'YouTube', url: 'rtmp://x', streamKey: 'k', enabled: true };

function setup({ destinations = [YT], bindings = [] } = {}) {
  const ipc = makeIpc();
  const store = {
    loadDestinations: vi.fn(() => destinations),
    addDestination: vi.fn(),
    removeDestination: vi.fn(),
    updateDestination: vi.fn(),
    loadBindings: vi.fn(() => bindings),
    setBinding: vi.fn(),
    removeBinding: vi.fn(),
    removeBindingsForDestination: vi.fn(),
  };
  const orchestrator = {
    onBindingAdded: vi.fn(),
    onBindingRemoved: vi.fn(),
    onDestinationRemoved: vi.fn(),
  };
  registerDestinationHandlers(ipc, { store, orchestrator });
  return { ipc, store, orchestrator };
}

describe('registerDestinationHandlers', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('registers all destination + bindings channels', () => {
    expect(Object.keys(ctx.ipc.handlers).sort()).toEqual([
      'bindings:list',
      'bindings:remove',
      'bindings:set',
      'destinations:add',
      'destinations:list',
      'destinations:remove',
      'destinations:update',
    ]);
  });

  it('list returns the stored destinations', () => {
    expect(ctx.ipc.invoke('destinations:list')).toEqual([YT]);
    expect(ctx.store.loadDestinations).toHaveBeenCalled();
  });

  it('add / update forward to the store and acknowledge', () => {
    const d = { id: '2', name: 'X' };
    expect(ctx.ipc.invoke('destinations:add', d)).toBe(true);
    expect(ctx.store.addDestination).toHaveBeenCalledWith(d);
    expect(ctx.ipc.invoke('destinations:update', d)).toBe(true);
    expect(ctx.store.updateDestination).toHaveBeenCalledWith(d);
  });

  it('bindings:list returns stored bindings', () => {
    const c = setup({ bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }] });
    expect(c.ipc.invoke('bindings:list')).toEqual([
      { sourceKey: 'grid', destinationId: 'yt', active: true },
    ]);
  });
});

describe('bindings:set routing (G1/G2)', () => {
  it('an ACTIVE binding persists then calls onBindingAdded with the resolved destination', () => {
    const { ipc, store, orchestrator } = setup({ destinations: [YT] });
    const binding = { sourceKey: 'grid', destinationId: 'yt', active: true };
    expect(ipc.invoke('bindings:set', binding)).toBe(true);
    expect(store.setBinding).toHaveBeenCalledWith(binding);
    expect(orchestrator.onBindingAdded).toHaveBeenCalledWith('grid', YT);
    expect(orchestrator.onBindingRemoved).not.toHaveBeenCalled();
  });

  it('an INACTIVE binding persists then calls onBindingRemoved (stops the relay)', () => {
    const { ipc, store, orchestrator } = setup({ destinations: [YT] });
    const binding = { sourceKey: 'grid', destinationId: 'yt', active: false };
    expect(ipc.invoke('bindings:set', binding)).toBe(true);
    expect(store.setBinding).toHaveBeenCalledWith(binding);
    expect(orchestrator.onBindingRemoved).toHaveBeenCalledWith('grid', 'yt');
    expect(orchestrator.onBindingAdded).not.toHaveBeenCalled();
  });
});

describe('bindings:remove routing (G2)', () => {
  it('removes the binding then stops the relay', () => {
    const { ipc, store, orchestrator } = setup();
    expect(ipc.invoke('bindings:remove', { sourceKey: 'grid', destinationId: 'yt' })).toBe(true);
    expect(store.removeBinding).toHaveBeenCalledWith('grid', 'yt');
    expect(orchestrator.onBindingRemoved).toHaveBeenCalledWith('grid', 'yt');
  });
});

describe('destinations:remove cascade (G3)', () => {
  it('removes the destination, cascades its bindings, and stops its relays', () => {
    const { ipc, store, orchestrator } = setup();
    expect(ipc.invoke('destinations:remove', 'yt')).toBe(true);
    expect(store.removeDestination).toHaveBeenCalledWith('yt');
    expect(store.removeBindingsForDestination).toHaveBeenCalledWith('yt');
    expect(orchestrator.onDestinationRemoved).toHaveBeenCalledWith('yt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/destinationHandlers.test.js`
Expected: FAIL — `bindings:remove` not registered / `orchestrator.onBindingAdded` never called (old handler ignores orchestrator).

- [ ] **Step 3: Write minimal implementation**

Replace the entire contents of `packages/server/destinationHandlers.js` with:

```js
'use strict';

const defaultStore = require('./destinationStore');

/**
 * Registers the RTMP destination + binding CRUD IPC handlers. Collaborators are
 * injectable so the wiring is unit-testable without the Electron runtime.
 *
 * Binding/destination mutations route through the orchestrator so relays react
 * live: activating a binding on a live source starts its relay (G1); deactivating
 * or removing a binding stops it (G2); deleting a destination cascades its
 * bindings and stops its relays across all sources (G3).
 *
 * @param {import('electron').IpcMain} ipcMain
 * @param {object} deps
 * @param {typeof defaultStore} [deps.store]
 * @param {{onBindingAdded:Function, onBindingRemoved:Function, onDestinationRemoved:Function}} deps.orchestrator
 */
function registerDestinationHandlers(ipcMain, { store = defaultStore, orchestrator } = {}) {
  ipcMain.handle('destinations:list', () => store.loadDestinations());

  ipcMain.handle('destinations:add', (_event, dest) => {
    store.addDestination(dest);
    return true;
  });

  ipcMain.handle('destinations:update', (_event, dest) => {
    store.updateDestination(dest);
    return true;
  });

  // G3 — delete cascade: drop the destination, its bindings, and stop its relays.
  ipcMain.handle('destinations:remove', (_event, id) => {
    store.removeDestination(id);
    store.removeBindingsForDestination(id);
    orchestrator.onDestinationRemoved(id);
    return true;
  });

  ipcMain.handle('bindings:list', () => store.loadBindings());

  // G1/G2 — upsert the binding, then start (active) or stop (inactive) its relay.
  ipcMain.handle('bindings:set', (_event, binding) => {
    store.setBinding(binding);
    if (binding.active) {
      const dest = store.loadDestinations().find((d) => d.id === binding.destinationId);
      if (dest) orchestrator.onBindingAdded(binding.sourceKey, dest);
    } else {
      orchestrator.onBindingRemoved(binding.sourceKey, binding.destinationId);
    }
    return true;
  });

  // G2 — explicit unbind: drop the binding and stop its relay.
  ipcMain.handle('bindings:remove', (_event, { sourceKey, destinationId }) => {
    store.removeBinding(sourceKey, destinationId);
    orchestrator.onBindingRemoved(sourceKey, destinationId);
    return true;
  });
}

module.exports = { registerDestinationHandlers };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/destinationHandlers.test.js`
Expected: PASS (all handler tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/server/destinationHandlers.js packages/server/destinationHandlers.test.js
git commit -m "feat(server): route bindings:set/remove + destinations:remove through orchestrator (G1/G2/G3)"
```

---

### Task 5: `main.js` + `preload.js` glue — wire the new deps live

**Files:**
- Modify: `packages/server/main.js` (add `isSourceLive`; inject into orchestrator; new `registerDestinationHandlers` call)
- Modify: `packages/server/preload.js` (allowlist `bindings:remove`)

This task is Electron glue (not unit-tested in isolation, matching the existing `main.js` convention); correctness is verified by the full server suite staying green plus the manual smoke note at the end.

- [ ] **Step 1: Add the `isSourceLive` predicate and inject it into the orchestrator**

In `packages/server/main.js`, the orchestrator is created at lines 515-520. Replace that block with one that also passes `isSourceLive`, backed by the `rtmpPublishers` Map already declared at line 229:

```js
// A source is "live" iff NMS currently has a publisher on its streamKey. Reuse
// the same map server-status is derived from — single source of truth (spec R3).
const isSourceLive = (streamKey) => rtmpPublishers.has(streamKey);

const broadcastOrchestrator = createBroadcastOrchestrator({
  supervisor: reconnectionSupervisor,
  relayManager,
  listBindings: () => destinationStore.loadBindings(),
  listDestinations: () => destinationStore.loadDestinations(),
  isSourceLive,
});
```

- [ ] **Step 2: Update the `registerDestinationHandlers` call to the new signature**

In `packages/server/main.js`, find the registration (lines 712-713):

```js
const { registerDestinationHandlers } = require('./destinationHandlers');
registerDestinationHandlers(ipcMain);
```

Replace the call with the injected deps (the orchestrator + store are already in scope from the wiring block above):

```js
const { registerDestinationHandlers } = require('./destinationHandlers');
registerDestinationHandlers(ipcMain, {
  store: destinationStore,
  orchestrator: broadcastOrchestrator,
});
```

> Note: confirm `destinationStore` is the in-scope store reference (it is used at the `listBindings`/`listDestinations` lines above). If `main.js` imported the store under a different local name, use that name here.

- [ ] **Step 3: Allowlist the `bindings:remove` channel in preload**

In `packages/server/preload.js`, find the invoke-channel allowlist that already lists `bindings:set` / `bindings:list` (search for `'bindings:set'`). Add `'bindings:remove'` to the same list, e.g.:

```js
  'bindings:list',
  'bindings:set',
  'bindings:remove',
```

(Match the surrounding array's exact quoting/indentation. If the allowlist is a `Set` or uses `startsWith('bindings:')` prefixing, no change is needed there — verify which pattern preload uses and only add the literal if it enumerates channels explicitly.)

- [ ] **Step 4: Run the FULL server suite to verify no regressions**

Run: `npm run test -w server`
Expected: PASS — all suites green (the prior baseline was 78 passing; this plan adds tests in Tasks 1–4, so expect 78 + new tests, with **0 failures**).

- [ ] **Step 5: Lint/format check (match repo tooling)**

Run: `npm run build`
Expected: completes without error (no type/build breakage from the server changes).

- [ ] **Step 6: Commit**

```bash
git add packages/server/main.js packages/server/preload.js
git commit -m "wire(server): isSourceLive + orchestrator-injected destination handlers; allowlist bindings:remove"
```

---

### Task 6: Manual smoke verification (devtools IPC, no UI yet)

**Goal:** prove G1–G3 end-to-end against real NMS before the UI exists, reusing the devtools-bridge method from the passed backend smoke (session-state 2026-06-03).

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Wait for the Electron window + NMS to come up.

- [ ] **Step 2: Seed a destination and verify G1 (live add)**

In the renderer devtools console:

```js
await window.electron.ipcRenderer.invoke('destinations:add', {
  id: 'smoke-a', name: 'Sink A', platform: 'custom',
  url: 'rtmp://localhost:1935/live', streamKey: 'out-a', enabled: true, priority: 1,
});
```

Start the grid broadcast from the current UI so `grid` is publishing. THEN bind it **while live**:

```js
await window.electron.ipcRenderer.invoke('bindings:set', {
  sourceKey: 'grid', destinationId: 'smoke-a', active: true,
});
```

Expected (main-process log): `relay:grid:smoke-a` → `connecting` → `live`; VLC on `rtmp://localhost:1935/live/out-a` shows the grid. **This is G1** — the relay started from the bind call, not from a republish.

- [ ] **Step 3: Verify G2 (unbind stops the relay)**

```js
await window.electron.ipcRenderer.invoke('bindings:remove', {
  sourceKey: 'grid', destinationId: 'smoke-a',
});
```

Expected: `relay-status … state: 'stopped'` for `grid:smoke-a`; the out-a VLC window stops receiving. The grid source itself keeps publishing.

- [ ] **Step 4: Verify G3 (delete cascades)**

Re-bind (repeat Step 2's `bindings:set`) so a relay is live again, then delete the destination:

```js
await window.electron.ipcRenderer.invoke('destinations:remove', 'smoke-a');
```

Expected: the relay stops (`stopped`), `bindings:list` no longer contains any `smoke-a` binding, and `destinations:list` no longer contains `smoke-a`. **This is G3** — one delete removed destination + binding + relay together.

- [ ] **Step 5: Record the result**

If all three behaved as expected, note it in the session-state memory (G1–G3 live-verified). If anything diverged, STOP and debug before declaring the plan done — do not paper over a divergence.

---

## Self-Review

**Spec coverage (spec §7 G1–G3, §10):**
- **G1 live-add** → orchestrator `onBindingAdded` + `isSourceLive` gate (Task 3) + `bindings:set` active routing (Task 4) + `main.js` predicate (Task 5). ✅
- **G2 unbind-stops-relay** → `removeBinding` (Task 2) + orchestrator `onBindingRemoved` reusing existing `relayManager.stop` (Task 3) + `bindings:set` inactive / new `bindings:remove` routing (Task 4) + preload allowlist (Task 5). ✅
- **G3 delete-cascade** → `relayManager.stopForDestination` (Task 1) + `removeBindingsForDestination` (Task 2) + orchestrator `onDestinationRemoved` (Task 3) + `destinations:remove` cascade routing (Task 4). ✅
- **§10 / R3 single source of truth** → `isSourceLive` reads the same `rtmpPublishers` Map as `server-status` (Task 5). ✅

**Out of scope here (correctly deferred to Plans 2 & 3):** all client hooks/UI, the dark-NT re-skin, `WatermarkConfig` shared-type reservation + locked Pro toggle (these ride Plan 3's Settings tab per the R2 resolution). The `'main-hub'` room and the `GridView` MediaRecorder→FFmpeg pipe are untouched.

**Placeholder scan:** none — every code step shows full content; Task 5 Step 3 flags a verify-the-pattern check for preload's allowlist shape (explicit list vs prefix) rather than guessing.

**Type/name consistency:** `stopForDestination` (Task 1 ↔ Task 3 ↔ orchestrator JSDoc), `removeBinding`/`removeBindingsForDestination` (Task 2 ↔ Task 4 tests), `onBindingAdded`/`onBindingRemoved`/`onDestinationRemoved` (Task 3 ↔ Task 4), and the handler signature `(ipcMain, { store, orchestrator })` (Task 4 ↔ Task 5) all match across tasks.
