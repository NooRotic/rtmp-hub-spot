# Multi-Stream UI — Hook Extraction Implementation Plan (Plan 2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move state/effects/IPC out of the ~1,117-line `App.tsx` god component into six focused, unit-tested hooks, **behind the current UI** (nothing changes visually), so Plan 3's dark-NT re-skin renders from a clean data layer.

**Architecture:** Six hooks under `packages/client/src/hooks/`. Each takes the Electron `ipc` bridge as an injected parameter (DI → unit-testable with a fake `ipc`), guards `null` ipc (browser/no-Electron → no-op), and owns one concern. Four hooks **extract** existing App.tsx logic (App is rewired to consume them, UI identical); two (`useRelays`, `useDestinations`) are **new** restream-layer data hooks with no UI consumer yet (Plan 3 renders them). A new `useElectronBridge` module becomes the single source of `isElectron` + `ipc`, killing the 4-way duplication (audit #9).

**Tech Stack:** React 18 (client-local), TypeScript, Vitest + jsdom, the in-house `test/testUtils` render harness (no `@testing-library/react` — it's React 19 in root `node_modules` and triggers a dual-instance error).

**Source of truth:** `docs/superpowers/specs/2026-06-04-multistream-ui-redesign-design.md` §5 (component architecture) + §6 (state & data flow). Restream types: `packages/shared/index.ts`.

**Deliberate scope decisions:**
- **`AdminDataProvider` / `useAdminData()` is DEFERRED to Plan 3.** It exists to avoid prop-drilling through the tabbed workspace tree, which doesn't exist yet. In Plan 2 the flat `App.tsx` calls hooks directly — introducing a context now is indirection with no payoff (YAGNI). Plan 3 wraps `AdminWorkspace` in the provider and moves the hook calls into it.
- **DI (hooks take `ipc`)** rather than calling `useElectronBridge()` internally. App reads `ipc` once and passes it down. This makes every hook testable with a fake `ipc` and matches the backend's injected-dependency style.
- **No behavior change.** The four extraction hooks reproduce the current effects/handlers verbatim; the only intentional behavior *addition* is `useBroadcastSettings` persisting to `localStorage` (closes known issue #5). The full client suite (currently 41 green) is the regression guard after each App rewire.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/test/testUtils.tsx` | Modify | Add a `renderHook` helper (react-dom/client + act) so hooks are testable without `@testing-library/react`. |
| `packages/client/src/hooks/useElectronBridge.ts` | Create | Single source of `isElectron` (const), `getIpc()` (module-level resolver), `useElectronBridge()` (hook), and the `IpcBridge` type. |
| `packages/client/src/hooks/useElectronBridge.test.tsx` | Create | Covers the non-Electron contract. |
| `packages/client/src/hooks/useFfmpegPipeline.ts` | Create | L2 source telemetry: `ffmpeg-status`/`ffmpeg-stats` → `{ status, stats }`. |
| `packages/client/src/hooks/useFfmpegPipeline.test.tsx` | Create | Event → state reducer. |
| `packages/client/src/hooks/useRecordings.ts` | Create | Recording lifecycle: start/stop/open-folder, 1s tick, server auto-stop sync. |
| `packages/client/src/hooks/useRecordings.test.tsx` | Create | CRUD + auto-stop. |
| `packages/client/src/hooks/useBroadcastSettings.ts` | Create | bitrate/preset/hwAccel (+`localStorage`, issue #5) + GPU detect. |
| `packages/client/src/hooks/useBroadcastSettings.test.tsx` | Create | Persistence + GPU auto-set. |
| `packages/client/src/hooks/useRelays.ts` | Create | NEW L3: `relay-status`/`relay-stats` → `Map<"src::destId", RelayEntry>`. |
| `packages/client/src/hooks/useRelays.test.tsx` | Create | Event → Map reducer. |
| `packages/client/src/hooks/useDestinations.ts` | Create | NEW: destinations + bindings CRUD via `destinations:*`/`bindings:*`, optimistic + re-fetch. |
| `packages/client/src/hooks/useDestinations.test.tsx` | Create | CRUD + optimistic + cascade. |
| `packages/client/src/App.tsx` | Modify | Consume the bridge + the 3 extraction hooks; remove the inline state/effects/handlers they replace. |
| `packages/client/src/hooks/useWebRTC.ts` | Modify | Import shared `isElectron` instead of its own (audit #9). |
| `packages/client/src/components/VideoFeed.tsx` | Modify | Import shared `isElectron`/`getIpc` (audit #9). |
| `packages/client/src/components/GridView.tsx` | Modify | Import shared `isElectron`/`getIpc` (audit #9). |

**Unchanged on purpose:** `GridView`/`VideoFeed` keep owning canvas compositing + the MediaRecorder→FFmpeg pipe; Task 8 only swaps where their `isElectron`/`ipc` *value* comes from (a const→import swap), guarded by the existing pipe tests. The single hardcoded `'main-hub'` room is untouched.

---

### Task 1: `renderHook` test helper

**Files:**
- Modify: `packages/client/src/test/testUtils.tsx` (append `renderHook`)
- Test: (verified indirectly by Task 2's hook test; this task adds infra + a self-test)

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/test/testUtils.renderHook.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { useState, useEffect } from 'react';
import { renderHook } from './testUtils';

describe('renderHook helper', () => {
  it('returns the latest hook value and reflects effect-driven updates', () => {
    const { result, unmount } = renderHook(() => {
      const [n, setN] = useState(0);
      useEffect(() => { setN(42); }, []);
      return n;
    });
    expect(result.current).toBe(42); // effect flushed inside act()
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- testUtils.renderHook`
Expected: FAIL — `renderHook` is not exported from `./testUtils`.

- [ ] **Step 3: Implement `renderHook`**

Append to `packages/client/src/test/testUtils.tsx` (after the existing `cleanup` export, before the DOM query helpers):

```tsx
// ─── renderHook ────────────────────────────────────────────────────────────────

interface RenderHookResult<T> {
  result: { current: T };
  rerender: () => void;
  unmount: () => void;
}

/**
 * Minimal renderHook (react-dom/client + act). Renders a probe component that
 * calls `hook()` and captures its return into `result.current` on every render.
 * Effects run inside act(), so synchronous effect updates are visible immediately;
 * for async effects, wrap the trigger in `await act(async () => {})` in the test.
 */
export function renderHook<T>(hook: () => T): RenderHookResult<T> {
  const result = { current: undefined as unknown as T };
  const Probe = () => { result.current = hook(); return null; };
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => { root.render(<Probe />); });
  return {
    result,
    rerender: () => act(() => { root.render(<Probe />); }),
    unmount: () => { act(() => root.unmount()); el.remove(); },
  };
}
```

(The file already imports `createRoot` and `act` at the top — reuse them.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- testUtils.renderHook`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/test/testUtils.tsx packages/client/src/test/testUtils.renderHook.test.tsx
git commit -m "test(client): add renderHook helper to testUtils for hook unit tests"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: `useElectronBridge` + migrate `App.tsx`

**Files:**
- Create: `packages/client/src/hooks/useElectronBridge.ts`
- Create: `packages/client/src/hooks/useElectronBridge.test.tsx`
- Modify: `packages/client/src/App.tsx:95-107` (replace the two `useMemo` blocks)

**Context:** `App.tsx` currently computes `isElectron` (lines 95-99) and `ipc` (lines 101-107) via `useMemo`. `useWebRTC.ts`, `VideoFeed.tsx`, `GridView.tsx` each redeclare their own `isElectron` (audit #9). This task creates the single source and migrates **App only**; the other three are migrated in Task 8 (they touch the delicate pipe).

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/hooks/useElectronBridge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderHook } from '../test/testUtils';
import { isElectron, getIpc, useElectronBridge } from './useElectronBridge';

describe('useElectronBridge (non-Electron / jsdom)', () => {
  it('isElectron is false under jsdom', () => {
    expect(isElectron).toBe(false);
  });
  it('getIpc() returns null when not in Electron', () => {
    expect(getIpc()).toBeNull();
  });
  it('the hook returns { isElectron: false, ipc: null }', () => {
    const { result, unmount } = renderHook(() => useElectronBridge());
    expect(result.current).toEqual({ isElectron: false, ipc: null });
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useElectronBridge`
Expected: FAIL — module `./useElectronBridge` does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/client/src/hooks/useElectronBridge.ts`:

```ts
import { useMemo } from 'react';

/** A listener as delivered by the preload bridge: the IpcRendererEvent is stripped to null. */
export type IpcListener = (event: unknown, ...args: any[]) => void;

/** The four-method ipcRenderer surface the preload contextBridge exposes. */
export interface IpcBridge {
  send(channel: string, ...args: any[]): void;
  invoke(channel: string, ...args: any[]): Promise<any>;
  on(channel: string, listener: IpcListener): void;
  removeListener(channel: string, listener: IpcListener): void;
}

/**
 * Single source of truth for Electron detection (kills the App / useWebRTC /
 * VideoFeed / GridView duplication — audit #9). Module-level so non-component code
 * (module-scope consts in the pipe components) can read it too.
 */
export const isElectron: boolean =
  typeof window !== 'undefined' &&
  (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1 ||
    !!(window as any).process?.versions?.electron);

/**
 * Resolve the ipcRenderer bridge: the contextBridge path (window.electron) first,
 * then the legacy nodeIntegration require() fallback. null outside Electron.
 */
export function getIpc(): IpcBridge | null {
  if (!isElectron) return null;
  return (
    (window as any).electron?.ipcRenderer ||
    ((window as any).require ? (window as any).require('electron').ipcRenderer : null)
  );
}

/** Hook form for components: stable { isElectron, ipc }. */
export function useElectronBridge(): { isElectron: boolean; ipc: IpcBridge | null } {
  const ipc = useMemo(() => getIpc(), []);
  return { isElectron, ipc };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useElectronBridge`
Expected: PASS.

- [ ] **Step 5: Migrate `App.tsx` to the bridge**

In `packages/client/src/App.tsx`, add the import near the other hook imports at the top of the file (next to `import { useWebRTC } ...`):

```ts
import { useElectronBridge, type IpcBridge } from './hooks/useElectronBridge';
```

Then replace the two `useMemo` blocks (current lines 95-107):

```ts
  const isElectron = useMemo(() => {
    return typeof window !== 'undefined' && 
           (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1 || 
            (window as any).process?.versions?.electron);
  }, []);

  const ipc = useMemo(() => {
    if (!isElectron) return null;
    // Electron might not have window.electron if contextIsolation isn't set up that way
    // Try to get it from window or window.require if nodeIntegration is true
    return (window as any).electron?.ipcRenderer || 
           ((window as any).require ? (window as any).require('electron').ipcRenderer : null);
  }, [isElectron]);
```

with:

```ts
  const { isElectron, ipc } = useElectronBridge();
```

Leave the `isAdminMode` `useMemo` (lines 110-114) unchanged — it still reads `isElectron`. If `useMemo` is now unused elsewhere in the file, leave the import (it is used by `isAdminMode`, `useResizableSidebar` callers, etc. — do not remove it unless tsc flags it as unused).

- [ ] **Step 6: Run the full client suite to confirm the UI is unchanged**

Run: `npm run test -w client`
Expected: PASS — all suites green (the prior 41 + the new bridge tests; **0 failures**).

- [ ] **Step 7: Build to confirm no type breakage**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/hooks/useElectronBridge.ts packages/client/src/hooks/useElectronBridge.test.tsx packages/client/src/App.tsx
git commit -m "refactor(client): extract useElectronBridge single source of isElectron+ipc; migrate App (audit #9)"
```
End the commit body with the `Co-Authored-By` trailer (as in Task 1).

---

### Task 3: `useFfmpegPipeline` (extract L2 source telemetry)

**Files:**
- Create: `packages/client/src/hooks/useFfmpegPipeline.ts`
- Create: `packages/client/src/hooks/useFfmpegPipeline.test.tsx`
- Modify: `packages/client/src/App.tsx` (remove `ffmpegStatus`/`ffmpegStats` state lines 158-166 + Effect lines 268-283; add hook call)

**Context:** App lines 158-166 hold `ffmpegStatus`/`ffmpegStats`; lines 268-283 subscribe to `ffmpeg-status`/`ffmpeg-stats`. The hook reproduces this exactly. The preload delivers events as `listener(null, data)`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/hooks/useFfmpegPipeline.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { useFfmpegPipeline } from './useFfmpegPipeline';
import type { IpcBridge } from './useElectronBridge';

function makeFakeIpc() {
  const listeners: Record<string, Function[]> = {};
  const ipc = {
    send: vi.fn(),
    invoke: vi.fn(),
    on: vi.fn((ch: string, l: Function) => { (listeners[ch] ??= []).push(l); }),
    removeListener: vi.fn((ch: string, l: Function) => {
      listeners[ch] = (listeners[ch] ?? []).filter((x) => x !== l);
    }),
  } as unknown as IpcBridge;
  const emit = (ch: string, ...args: any[]) => (listeners[ch] ?? []).forEach((l) => l(null, ...args));
  return { ipc, emit, listeners };
}

describe('useFfmpegPipeline', () => {
  let fake: ReturnType<typeof makeFakeIpc>;
  beforeEach(() => { fake = makeFakeIpc(); });

  it('starts idle and ignores everything when ipc is null', () => {
    const { result, unmount } = renderHook(() => useFfmpegPipeline(null));
    expect(result.current.status).toEqual({ state: 'idle', streamKey: null });
    expect(result.current.stats).toBeNull();
    unmount();
  });

  it('updates status on ffmpeg-status and stats on ffmpeg-stats', () => {
    const { result, unmount } = renderHook(() => useFfmpegPipeline(fake.ipc));
    act(() => fake.emit('ffmpeg-status', { state: 'running', streamKey: 'grid' }));
    expect(result.current.status).toEqual({ state: 'running', streamKey: 'grid' });
    act(() => fake.emit('ffmpeg-stats', { frame: 90, fps: 30, bitrate: '2500k', speed: 1, time: '00:00:03', size: '1MB', streamKey: 'grid' }));
    expect(result.current.stats?.fps).toBe(30);
    unmount();
  });

  it('clears stats when status is not running', () => {
    const { result, unmount } = renderHook(() => useFfmpegPipeline(fake.ipc));
    act(() => fake.emit('ffmpeg-stats', { frame: 1, fps: 30, bitrate: 'x', speed: 1, time: 't', size: 's', streamKey: 'grid' }));
    act(() => fake.emit('ffmpeg-status', { state: 'stopped', streamKey: 'grid' }));
    expect(result.current.stats).toBeNull();
    unmount();
  });

  it('removes its listeners on unmount', () => {
    const { unmount } = renderHook(() => useFfmpegPipeline(fake.ipc));
    unmount();
    expect(fake.ipc.removeListener).toHaveBeenCalledWith('ffmpeg-status', expect.any(Function));
    expect(fake.ipc.removeListener).toHaveBeenCalledWith('ffmpeg-stats', expect.any(Function));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useFfmpegPipeline`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/hooks/useFfmpegPipeline.ts`:

```ts
import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';

export interface FfmpegStatus {
  state: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
  streamKey: string | null;
  message?: string;
}

export interface FfmpegStats {
  frame: number;
  fps: number;
  bitrate: string;
  speed: number;
  time: string;
  size: string;
  streamKey: string;
}

/** L2 source telemetry: subscribes to ffmpeg-status / ffmpeg-stats from the main process. */
export function useFfmpegPipeline(ipc: IpcBridge | null): { status: FfmpegStatus; stats: FfmpegStats | null } {
  const [status, setStatus] = useState<FfmpegStatus>({ state: 'idle', streamKey: null });
  const [stats, setStats] = useState<FfmpegStats | null>(null);

  useEffect(() => {
    if (!ipc) return;
    const handleStatus = (_: unknown, data: FfmpegStatus) => {
      setStatus(data);
      if (data.state !== 'running') setStats(null);
    };
    const handleStats = (_: unknown, data: FfmpegStats) => setStats(data);
    ipc.on('ffmpeg-status', handleStatus);
    ipc.on('ffmpeg-stats', handleStats);
    return () => {
      ipc.removeListener('ffmpeg-status', handleStatus);
      ipc.removeListener('ffmpeg-stats', handleStats);
    };
  }, [ipc]);

  return { status, stats };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useFfmpegPipeline`
Expected: PASS.

- [ ] **Step 5: Rewire `App.tsx`**

Add the import at the top (with the other hook imports):

```ts
import { useFfmpegPipeline } from './hooks/useFfmpegPipeline';
```

Delete the `ffmpegStatus`/`ffmpegStats` state declarations (current lines 157-166, including the `// FFmpeg pipeline health` comment):

```ts
  // FFmpeg pipeline health
  const [ffmpegStatus, setFfmpegStatus] = useState<{
    state: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
    streamKey: string | null;
    message?: string;
  }>({ state: 'idle', streamKey: null });
  const [ffmpegStats, setFfmpegStats] = useState<{
    frame: number; fps: number; bitrate: string;
    speed: number; time: string; size: string; streamKey: string;
  } | null>(null);
```

Delete the subscription effect (current lines 267-283):

```ts
  // Listen for FFmpeg pipeline state and stats from the Electron main process
  useEffect(() => {
    if (!ipc) return;
    const handleStatus = (_: any, data: { state: 'idle' | 'starting' | 'running' | 'error' | 'stopped'; streamKey: string | null; message?: string }) => {
      setFfmpegStatus(data);
      if (data.state !== 'running') setFfmpegStats(null);
    };
    const handleStats = (_: any, data: typeof ffmpegStats) => {
      setFfmpegStats(data);
    };
    ipc.on('ffmpeg-status', handleStatus);
    ipc.on('ffmpeg-stats', handleStats);
    return () => {
      ipc.removeListener('ffmpeg-status', handleStatus);
      ipc.removeListener('ffmpeg-stats', handleStats);
    };
  }, [ipc]);
```

Add the hook call where the state used to be (right after the `const { isElectron, ipc } = useElectronBridge();` line, so `ipc` is in scope). Alias the returns to the existing JSX names so no JSX changes are needed:

```ts
  const { status: ffmpegStatus, stats: ffmpegStats } = useFfmpegPipeline(ipc);
```

- [ ] **Step 6: Run the full client suite**

Run: `npm run test -w client`
Expected: PASS — 0 failures (UI unchanged).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/hooks/useFfmpegPipeline.ts packages/client/src/hooks/useFfmpegPipeline.test.tsx packages/client/src/App.tsx
git commit -m "refactor(client): extract useFfmpegPipeline; App consumes L2 telemetry hook"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: `useRecordings` (extract recording lifecycle)

**Files:**
- Create: `packages/client/src/hooks/useRecordings.ts`
- Create: `packages/client/src/hooks/useRecordings.test.tsx`
- Modify: `packages/client/src/App.tsx` (remove `activeRecordings`/`recNow` state lines 153-155, Effects lines 285-290 + 316-320, handlers lines 292-314; add hook call)

**Context:** App lines 153-155 (`activeRecordings`, `recNow`); the 1s tick (285-290); the start/stop/open handlers (292-314); the server auto-stop sync (316-320, driven by `recordingStopped` from `useWebRTC`). The hook takes both `ipc` and `recordingStopped`, so it must be called **after** the `useWebRTC` destructure.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/hooks/useRecordings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { useRecordings } from './useRecordings';
import type { IpcBridge } from './useElectronBridge';

function makeFakeIpc() {
  const ipc = { send: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() } as unknown as IpcBridge;
  return ipc;
}

describe('useRecordings', () => {
  let ipc: IpcBridge;
  beforeEach(() => { ipc = makeFakeIpc(); });

  it('startRecording invokes start-recording and adds an active recording on success', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: true, path: 'C:/rec/grid.mp4' });
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(ipc.invoke).toHaveBeenCalledWith('start-recording', { streamKey: 'grid' });
    expect(result.current.activeRecordings.map((r) => r.streamKey)).toEqual(['grid']);
    unmount();
  });

  it('startRecording does not add when the result is unsuccessful', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: false, error: 'boom' });
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });

  it('stopRecording sends stop-recording and removes the entry', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: true, path: 'p' });
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    await act(async () => { await result.current.startRecording('grid'); });
    act(() => result.current.stopRecording('grid'));
    expect(ipc.send).toHaveBeenCalledWith('stop-recording', { streamKey: 'grid' });
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });

  it('openRecordingsDir sends open-recordings-dir', () => {
    const { result, unmount } = renderHook(() => useRecordings(ipc, null));
    act(() => result.current.openRecordingsDir());
    expect(ipc.send).toHaveBeenCalledWith('open-recordings-dir');
    unmount();
  });

  it('removes an active recording when the server signals recordingStopped for it', async () => {
    (ipc.invoke as any).mockResolvedValue({ success: true, path: 'p' });
    let recordingStopped: { streamKey: string; reason: string } | null = null;
    const { result, rerender, unmount } = renderHook(() => useRecordings(ipc, recordingStopped));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(result.current.activeRecordings).toHaveLength(1);
    recordingStopped = { streamKey: 'grid', reason: 'publisher-disconnect' };
    act(() => rerender());
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });

  it('is a no-op when ipc is null', async () => {
    const { result, unmount } = renderHook(() => useRecordings(null, null));
    await act(async () => { await result.current.startRecording('grid'); });
    expect(result.current.activeRecordings).toHaveLength(0);
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useRecordings`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/hooks/useRecordings.ts`:

```ts
import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';

export interface ActiveRecording {
  streamKey: string;
  path: string;
  startTime: number;
}

/**
 * Recording lifecycle: start/stop/open-folder via IPC, a 1s tick for elapsed-time
 * display, and sync-removal when the server auto-stops a recording (recordingStopped
 * comes from useWebRTC's 'recording-stopped' socket event).
 */
export function useRecordings(
  ipc: IpcBridge | null,
  recordingStopped: { streamKey: string; reason: string } | null,
): {
  activeRecordings: ActiveRecording[];
  recNow: number;
  startRecording: (streamKey: string) => Promise<void>;
  stopRecording: (streamKey: string) => void;
  openRecordingsDir: () => void;
} {
  const [activeRecordings, setActiveRecordings] = useState<ActiveRecording[]>([]);
  const [recNow, setRecNow] = useState<number>(() => Date.now());

  // Tick every second while recordings are active (for elapsed-time display).
  useEffect(() => {
    if (activeRecordings.length === 0) return;
    const t = setInterval(() => setRecNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeRecordings.length]);

  // Sync when the server auto-stops a recording (publisher disconnect, etc.).
  useEffect(() => {
    if (!recordingStopped) return;
    setActiveRecordings((prev) => prev.filter((r) => r.streamKey !== recordingStopped.streamKey));
  }, [recordingStopped]);

  const startRecording = async (streamKey: string) => {
    if (!ipc) return;
    try {
      const result = await ipc.invoke('start-recording', { streamKey });
      if (result.success) {
        setActiveRecordings((prev) => [...prev, { streamKey, path: result.path, startTime: Date.now() }]);
      } else {
        console.error('[REC] Start failed:', result.error);
      }
    } catch (e) {
      console.error('[REC] IPC error:', e);
    }
  };

  const stopRecording = (streamKey: string) => {
    if (!ipc) return;
    ipc.send('stop-recording', { streamKey });
    setActiveRecordings((prev) => prev.filter((r) => r.streamKey !== streamKey));
  };

  const openRecordingsDir = () => {
    if (!ipc) return;
    ipc.send('open-recordings-dir');
  };

  return { activeRecordings, recNow, startRecording, stopRecording, openRecordingsDir };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useRecordings`
Expected: PASS.

- [ ] **Step 5: Rewire `App.tsx`**

Add the import:

```ts
import { useRecordings } from './hooks/useRecordings';
```

Delete the `activeRecordings`/`recNow` state (current lines 153-155):

```ts
  // Recording
  const [activeRecordings, setActiveRecordings] = useState<{ streamKey: string; path: string; startTime: number }[]>([]);
  const [recNow, setRecNow] = useState(Date.now());
```

Delete the 1s tick effect (current lines 285-290):

```ts
  // Tick every second while recordings are active (for elapsed time display)
  useEffect(() => {
    if (activeRecordings.length === 0) return;
    const t = setInterval(() => setRecNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeRecordings.length]);
```

Delete the three handlers (current lines 292-314):

```ts
  // Recording helpers
  const startRecording = async (streamKey: string) => {
    if (!ipc) return;
    try {
      const result = await ipc.invoke('start-recording', { streamKey });
      if (result.success) {
        setActiveRecordings(prev => [...prev, { streamKey, path: result.path, startTime: Date.now() }]);
      } else {
        console.error('[REC] Start failed:', result.error);
      }
    } catch (e) { console.error('[REC] IPC error:', e); }
  };

  const stopRecording = (streamKey: string) => {
    if (!ipc) return;
    ipc.send('stop-recording', { streamKey });
    setActiveRecordings(prev => prev.filter(r => r.streamKey !== streamKey));
  };

  const openRecordingsDir = () => {
    if (!ipc) return;
    ipc.send('open-recordings-dir');
  };
```

Delete the auto-stop sync effect (current lines 316-320):

```ts
  // Sync recording state when the server auto-stops a recording (publisher disconnect, etc.)
  useEffect(() => {
    if (!recordingStopped) return;
    setActiveRecordings(prev => prev.filter(r => r.streamKey !== recordingStopped.streamKey));
  }, [recordingStopped]);
```

Add the hook call **immediately after the `useWebRTC(...)` destructure block** (after current line 194), because it needs `recordingStopped`:

```ts
  const { activeRecordings, recNow, startRecording, stopRecording, openRecordingsDir } = useRecordings(ipc, recordingStopped);
```

- [ ] **Step 6: Run the full client suite**

Run: `npm run test -w client`
Expected: PASS — 0 failures.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/hooks/useRecordings.ts packages/client/src/hooks/useRecordings.test.tsx packages/client/src/App.tsx
git commit -m "refactor(client): extract useRecordings; App consumes recording lifecycle hook"
```
(+ `Co-Authored-By` trailer.)

---

### Task 5: `useBroadcastSettings` (extract + persist, issue #5)

**Files:**
- Create: `packages/client/src/hooks/useBroadcastSettings.ts`
- Create: `packages/client/src/hooks/useBroadcastSettings.test.tsx`
- Modify: `packages/client/src/App.tsx` (remove `broadcastBitrate`/`broadcastPreset`/`hwAccel`/`detectedEncoder` state lines 147-151, the GPU-detect Effect lines 252-265; add hook call)

**Context:** App lines 147-151 hold the four settings; lines 252-265 detect the GPU encoder and auto-set `hwAccel` when it's still `'none'`. Today none of the three settings persist (known issue #5). The hook adds `localStorage` persistence and reproduces the GPU auto-set.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/hooks/useBroadcastSettings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { useBroadcastSettings } from './useBroadcastSettings';
import type { IpcBridge } from './useElectronBridge';

const makeFakeIpc = () =>
  ({ send: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn() } as unknown as IpcBridge);

describe('useBroadcastSettings', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults when nothing is persisted', () => {
    const { result, unmount } = renderHook(() => useBroadcastSettings(null));
    expect(result.current.bitrate).toBe('2500k');
    expect(result.current.preset).toBe('ultrafast');
    expect(result.current.hwAccel).toBe('none');
    unmount();
  });

  it('reads persisted values on init', () => {
    localStorage.setItem('hub-broadcast-bitrate', '6000k');
    localStorage.setItem('hub-broadcast-preset', 'veryfast');
    localStorage.setItem('hub-hwaccel', 'amf');
    const { result, unmount } = renderHook(() => useBroadcastSettings(null));
    expect(result.current.bitrate).toBe('6000k');
    expect(result.current.preset).toBe('veryfast');
    expect(result.current.hwAccel).toBe('amf');
    unmount();
  });

  it('persists a changed setting to localStorage', () => {
    const { result, unmount } = renderHook(() => useBroadcastSettings(null));
    act(() => result.current.setBitrate('8000k'));
    expect(localStorage.getItem('hub-broadcast-bitrate')).toBe('8000k');
    unmount();
  });

  it('GPU detect sets detectedEncoder and auto-selects best when hwAccel is still none', async () => {
    const ipc = makeFakeIpc();
    (ipc.invoke as any).mockResolvedValue({ best: 'amf', bestLabel: 'AMD AMF', available: ['amf', 'libx264'] });
    const { result, unmount } = renderHook(() => useBroadcastSettings(ipc));
    await act(async () => {});
    expect(ipc.invoke).toHaveBeenCalledWith('detect-gpu-encoder');
    expect(result.current.detectedEncoder?.best).toBe('amf');
    expect(result.current.hwAccel).toBe('amf');
    unmount();
  });

  it('GPU detect does NOT override a persisted/explicit hwAccel', async () => {
    localStorage.setItem('hub-hwaccel', 'nvenc');
    const ipc = makeFakeIpc();
    (ipc.invoke as any).mockResolvedValue({ best: 'amf', bestLabel: 'AMD AMF', available: ['amf'] });
    const { result, unmount } = renderHook(() => useBroadcastSettings(ipc));
    await act(async () => {});
    expect(result.current.hwAccel).toBe('nvenc'); // respected, not overwritten
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useBroadcastSettings`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/hooks/useBroadcastSettings.ts`:

```ts
import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';

export interface DetectedEncoder {
  best: string;
  bestLabel: string;
  available: string[];
}

const LS = {
  bitrate: 'hub-broadcast-bitrate',
  preset: 'hub-broadcast-preset',
  hwAccel: 'hub-hwaccel',
} as const;

/**
 * Broadcast quality settings (bitrate / preset / hwAccel), persisted to localStorage
 * (closes known issue #5), plus one-shot GPU encoder detection that auto-selects the
 * best encoder only when the user hasn't already chosen one ('none').
 */
export function useBroadcastSettings(ipc: IpcBridge | null): {
  bitrate: string;
  setBitrate: (v: string) => void;
  preset: string;
  setPreset: (v: string) => void;
  hwAccel: string;
  setHwAccel: (v: string) => void;
  detectedEncoder: DetectedEncoder | null;
} {
  const [bitrate, setBitrate] = useState<string>(() => localStorage.getItem(LS.bitrate) || '2500k');
  const [preset, setPreset] = useState<string>(() => localStorage.getItem(LS.preset) || 'ultrafast');
  const [hwAccel, setHwAccel] = useState<string>(() => localStorage.getItem(LS.hwAccel) || 'none');
  const [detectedEncoder, setDetectedEncoder] = useState<DetectedEncoder | null>(null);

  useEffect(() => { localStorage.setItem(LS.bitrate, bitrate); }, [bitrate]);
  useEffect(() => { localStorage.setItem(LS.preset, preset); }, [preset]);
  useEffect(() => { localStorage.setItem(LS.hwAccel, hwAccel); }, [hwAccel]);

  // GPU encoder auto-detection (Electron only — ipc is null in the browser). Runs once.
  useEffect(() => {
    if (!ipc) return;
    ipc
      .invoke('detect-gpu-encoder')
      .then((result: DetectedEncoder) => {
        setDetectedEncoder(result);
        setHwAccel((prev) => (prev === 'none' ? result.best : prev));
      })
      .catch((err: unknown) => console.error('[App] GPU detection failed:', err));
  }, [ipc]);

  return { bitrate, setBitrate, preset, setPreset, hwAccel, setHwAccel, detectedEncoder };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useBroadcastSettings`
Expected: PASS.

- [ ] **Step 5: Rewire `App.tsx`**

Add the import:

```ts
import { useBroadcastSettings } from './hooks/useBroadcastSettings';
```

Delete the four settings-state declarations (current lines 146-151):

```ts
  // Broadcast Quality Settings
  const [broadcastBitrate, setBroadcastBitrate] = useState<string>('2500k');
  const [broadcastPreset, setBroadcastPreset] = useState<string>('ultrafast');
  const [hwAccel, setHwAccel] = useState<string>('none');
  const [detectedEncoder, setDetectedEncoder] = useState<{ best: string; bestLabel: string; available: string[] } | null>(null);
```

Delete the GPU-detect effect (current lines 252-265):

```ts
  // GPU Encoder Auto-Detection (Electron only, runs once on startup)
  useEffect(() => {
    if (!isElectron || !ipc) return;
    ipc.invoke('detect-gpu-encoder')
      .then((result: { best: string; bestLabel: string; available: string[] }) => {
        console.log('[App] GPU encoder detection result:', result);
        setDetectedEncoder(result);
        // Only auto-set if user hasn't already picked something (we start at 'none')
        setHwAccel(prev => prev === 'none' ? result.best : prev);
      })
      .catch((err: any) => {
        console.error('[App] GPU detection failed:', err);
      });
  }, [isElectron, ipc]);
```

Add the hook call after the bridge hook (alias to the existing JSX names so JSX is untouched):

```ts
  const {
    bitrate: broadcastBitrate, setBitrate: setBroadcastBitrate,
    preset: broadcastPreset, setPreset: setBroadcastPreset,
    hwAccel, setHwAccel,
    detectedEncoder,
  } = useBroadcastSettings(ipc);
```

- [ ] **Step 6: Run the full client suite**

Run: `npm run test -w client`
Expected: PASS — 0 failures.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 8: Commit**

```bash
git add packages/client/src/hooks/useBroadcastSettings.ts packages/client/src/hooks/useBroadcastSettings.test.tsx packages/client/src/App.tsx
git commit -m "refactor(client): extract useBroadcastSettings with localStorage persistence (issue #5)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 6: `useRelays` (NEW — L3 relay telemetry)

**Files:**
- Create: `packages/client/src/hooks/useRelays.ts`
- Create: `packages/client/src/hooks/useRelays.test.tsx`

**Context:** Brand-new data layer with **no UI consumer yet** (Plan 3 renders it). Subscribes to the `relay-status`/`relay-stats` IPC events (already allowlisted in `preload.js` ON_CHANNELS) and reduces them into a `Map` keyed by `"sourceKey::destinationId"`. Mirrors the backend's relay-manager Map semantics: a `'stopped'` status deletes the entry; stats for an unknown relay are ignored (status `connecting` always arrives first). Types come from `packages/shared/index.ts` via a type-only import.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/hooks/useRelays.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { useRelays } from './useRelays';
import type { IpcBridge } from './useElectronBridge';

function makeFakeIpc() {
  const listeners: Record<string, Function[]> = {};
  const ipc = {
    send: vi.fn(), invoke: vi.fn(),
    on: vi.fn((ch: string, l: Function) => { (listeners[ch] ??= []).push(l); }),
    removeListener: vi.fn((ch: string, l: Function) => {
      listeners[ch] = (listeners[ch] ?? []).filter((x) => x !== l);
    }),
  } as unknown as IpcBridge;
  const emit = (ch: string, ...args: any[]) => (listeners[ch] ?? []).forEach((l) => l(null, ...args));
  return { ipc, emit };
}

describe('useRelays', () => {
  let fake: ReturnType<typeof makeFakeIpc>;
  beforeEach(() => { fake = makeFakeIpc(); });

  it('adds an entry on relay-status and keys it by "src::dest"', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'connecting' }));
    expect(result.current.relays.get('grid::yt')?.state).toBe('connecting');
    unmount();
  });

  it('merges relay-stats into the existing entry', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }));
    act(() => fake.emit('relay-stats', { sourceKey: 'grid', destinationId: 'yt', fps: 30, bitrate: '2500k', speed: 1, frame: 90, size: '1MB', time: 't', uptimeSec: 3 }));
    const e = result.current.relays.get('grid::yt');
    expect(e?.state).toBe('live');
    expect(e?.stats?.fps).toBe(30);
    unmount();
  });

  it('ignores stats for an unknown relay', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-stats', { sourceKey: 'grid', destinationId: 'ghost', fps: 1, bitrate: 'x', speed: 1, frame: 1, size: 's', time: 't', uptimeSec: 1 }));
    expect(result.current.relays.has('grid::ghost')).toBe(false);
    unmount();
  });

  it('removes an entry when its status becomes stopped', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'stopped' }));
    expect(result.current.relays.has('grid::yt')).toBe(false);
    unmount();
  });

  it('keeps separate entries per (source, destination)', () => {
    const { result, unmount } = renderHook(() => useRelays(fake.ipc));
    act(() => fake.emit('relay-status', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }));
    act(() => fake.emit('relay-status', { sourceKey: 'feed-cam', destinationId: 'yt', state: 'connecting' }));
    expect(result.current.relays.size).toBe(2);
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useRelays`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/hooks/useRelays.ts`:

```ts
import { useState, useEffect } from 'react';
import type { IpcBridge } from './useElectronBridge';
import type { RelayStatus, RelayStats, RelayState } from '../../../shared';

export interface RelayEntry {
  sourceKey: string;
  destinationId: string;
  state: RelayState;
  message?: string;
  stats?: Omit<RelayStats, 'sourceKey' | 'destinationId'>;
}

const keyOf = (sourceKey: string, destinationId: string) => `${sourceKey}::${destinationId}`;

/**
 * L3 relay telemetry: reduces relay-status / relay-stats into a Map keyed by
 * "sourceKey::destinationId". A 'stopped' status removes the entry (matching the
 * backend relay-manager, which deletes stopped relays); stats for an entry that
 * doesn't exist yet are ignored (status always arrives before stats).
 */
export function useRelays(ipc: IpcBridge | null): { relays: Map<string, RelayEntry> } {
  const [relays, setRelays] = useState<Map<string, RelayEntry>>(new Map());

  useEffect(() => {
    if (!ipc) return;

    const onStatus = (_: unknown, d: RelayStatus) => {
      setRelays((prev) => {
        const k = keyOf(d.sourceKey, d.destinationId);
        const next = new Map(prev);
        if (d.state === 'stopped') {
          next.delete(k);
        } else {
          const existing = next.get(k);
          next.set(k, {
            ...existing,
            sourceKey: d.sourceKey,
            destinationId: d.destinationId,
            state: d.state,
            message: d.message,
          });
        }
        return next;
      });
    };

    const onStats = (_: unknown, s: RelayStats) => {
      setRelays((prev) => {
        const k = keyOf(s.sourceKey, s.destinationId);
        const existing = prev.get(k);
        if (!existing) return prev; // stats for an unknown relay — ignore
        const { sourceKey, destinationId, ...stats } = s;
        const next = new Map(prev);
        next.set(k, { ...existing, stats });
        return next;
      });
    };

    ipc.on('relay-status', onStatus);
    ipc.on('relay-stats', onStats);
    return () => {
      ipc.removeListener('relay-status', onStatus);
      ipc.removeListener('relay-stats', onStats);
    };
  }, [ipc]);

  return { relays };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useRelays`
Expected: PASS.

- [ ] **Step 5: Build (verifies the cross-package `import type` resolves)**

Run: `npm run build`
Expected: completes without error. (If tsc cannot resolve `'../../../shared'`, STOP and report — do not fall back silently; the path is `packages/client/src/hooks/` → `../../../shared` = `packages/shared/index.ts`.)

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useRelays.ts packages/client/src/hooks/useRelays.test.tsx
git commit -m "feat(client): useRelays hook — L3 relay-status/stats reducer (no UI yet)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 7: `useDestinations` (NEW — destinations + bindings CRUD)

**Files:**
- Create: `packages/client/src/hooks/useDestinations.ts`
- Create: `packages/client/src/hooks/useDestinations.test.tsx`

**Context:** Brand-new data layer with **no UI consumer yet** (Plan 3 renders it). Fronts the `destinations:*` and `bindings:*` invoke channels (already allowlisted in `preload.js` INVOKE_CHANNELS and routed through the orchestrator by Plan 1's G1–G3). Loads on mount, mutates optimistically, then re-fetches to reconcile. `removeDestination` also optimistically drops that destination's bindings (mirroring the backend G3 cascade). Types from `packages/shared/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/hooks/useDestinations.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '../test/testUtils';
import { useDestinations } from './useDestinations';
import type { IpcBridge } from './useElectronBridge';
import type { RtmpDestination, DestinationBinding } from '../../../shared';

const YT: RtmpDestination = { id: 'yt', name: 'YouTube', platform: 'youtube', url: 'rtmp://x', streamKey: 'k', enabled: true };

function makeFakeIpc(initial: { destinations?: RtmpDestination[]; bindings?: DestinationBinding[] } = {}) {
  const store = { destinations: initial.destinations ?? [], bindings: initial.bindings ?? [] };
  const invoke = vi.fn(async (channel: string, arg?: any) => {
    switch (channel) {
      case 'destinations:list': return store.destinations;
      case 'bindings:list': return store.bindings;
      case 'destinations:add': store.destinations = [...store.destinations, arg]; return true;
      case 'destinations:update': store.destinations = store.destinations.map((d) => (d.id === arg.id ? arg : d)); return true;
      case 'destinations:remove':
        store.destinations = store.destinations.filter((d) => d.id !== arg);
        store.bindings = store.bindings.filter((b) => b.destinationId !== arg);
        return true;
      case 'bindings:set': {
        const i = store.bindings.findIndex((b) => b.sourceKey === arg.sourceKey && b.destinationId === arg.destinationId);
        if (i >= 0) store.bindings[i] = arg; else store.bindings = [...store.bindings, arg];
        return true;
      }
      case 'bindings:remove':
        store.bindings = store.bindings.filter((b) => !(b.sourceKey === arg.sourceKey && b.destinationId === arg.destinationId));
        return true;
      default: return undefined;
    }
  });
  const ipc = { send: vi.fn(), invoke, on: vi.fn(), removeListener: vi.fn() } as unknown as IpcBridge;
  return { ipc, store };
}

describe('useDestinations', () => {
  it('loads destinations and bindings on mount', async () => {
    const { ipc } = makeFakeIpc({ destinations: [YT], bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }] });
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    expect(result.current.destinations).toEqual([YT]);
    expect(result.current.bindings).toHaveLength(1);
    unmount();
  });

  it('addDestination optimistically adds then reconciles via re-fetch', async () => {
    const { ipc } = makeFakeIpc();
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    await act(async () => { await result.current.addDestination(YT); });
    expect(ipc.invoke).toHaveBeenCalledWith('destinations:add', YT);
    expect(result.current.destinations.map((d) => d.id)).toEqual(['yt']);
    unmount();
  });

  it('removeDestination cascades its bindings out of state', async () => {
    const { ipc } = makeFakeIpc({ destinations: [YT], bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true }] });
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    await act(async () => { await result.current.removeDestination('yt'); });
    expect(ipc.invoke).toHaveBeenCalledWith('destinations:remove', 'yt');
    expect(result.current.destinations).toHaveLength(0);
    expect(result.current.bindings).toHaveLength(0);
    unmount();
  });

  it('setBinding upserts and removeBinding deletes', async () => {
    const { ipc } = makeFakeIpc({ destinations: [YT] });
    const { result, unmount } = renderHook(() => useDestinations(ipc));
    await act(async () => {});
    await act(async () => { await result.current.setBinding({ sourceKey: 'grid', destinationId: 'yt', active: true }); });
    expect(result.current.bindings).toHaveLength(1);
    await act(async () => { await result.current.removeBinding('grid', 'yt'); });
    expect(ipc.invoke).toHaveBeenCalledWith('bindings:remove', { sourceKey: 'grid', destinationId: 'yt' });
    expect(result.current.bindings).toHaveLength(0);
    unmount();
  });

  it('is inert when ipc is null', async () => {
    const { result, unmount } = renderHook(() => useDestinations(null));
    await act(async () => {});
    expect(result.current.destinations).toEqual([]);
    expect(result.current.bindings).toEqual([]);
    unmount();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- useDestinations`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `packages/client/src/hooks/useDestinations.ts`:

```ts
import { useState, useEffect, useCallback } from 'react';
import type { IpcBridge } from './useElectronBridge';
import type { RtmpDestination, DestinationBinding } from '../../../shared';

/**
 * Destination library + source↔destination bindings, fronted by the destinations:*
 * / bindings:* IPC channels (routed through the orchestrator by the G1–G3 backend).
 * Loads on mount; mutations are optimistic, then reconciled by a re-fetch.
 */
export function useDestinations(ipc: IpcBridge | null): {
  destinations: RtmpDestination[];
  bindings: DestinationBinding[];
  refresh: () => Promise<void>;
  addDestination: (dest: RtmpDestination) => Promise<void>;
  updateDestination: (dest: RtmpDestination) => Promise<void>;
  removeDestination: (id: string) => Promise<void>;
  setBinding: (binding: DestinationBinding) => Promise<void>;
  removeBinding: (sourceKey: string, destinationId: string) => Promise<void>;
} {
  const [destinations, setDestinations] = useState<RtmpDestination[]>([]);
  const [bindings, setBindings] = useState<DestinationBinding[]>([]);

  const refresh = useCallback(async () => {
    if (!ipc) return;
    const [d, b] = await Promise.all([ipc.invoke('destinations:list'), ipc.invoke('bindings:list')]);
    setDestinations(d ?? []);
    setBindings(b ?? []);
  }, [ipc]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addDestination = useCallback(async (dest: RtmpDestination) => {
    if (!ipc) return;
    setDestinations((prev) => [...prev, dest]); // optimistic
    await ipc.invoke('destinations:add', dest);
    await refresh();
  }, [ipc, refresh]);

  const updateDestination = useCallback(async (dest: RtmpDestination) => {
    if (!ipc) return;
    setDestinations((prev) => prev.map((x) => (x.id === dest.id ? dest : x))); // optimistic
    await ipc.invoke('destinations:update', dest);
    await refresh();
  }, [ipc, refresh]);

  const removeDestination = useCallback(async (id: string) => {
    if (!ipc) return;
    setDestinations((prev) => prev.filter((x) => x.id !== id)); // optimistic
    setBindings((prev) => prev.filter((b) => b.destinationId !== id)); // mirror backend G3 cascade
    await ipc.invoke('destinations:remove', id);
    await refresh();
  }, [ipc, refresh]);

  const setBinding = useCallback(async (binding: DestinationBinding) => {
    if (!ipc) return;
    setBindings((prev) => {
      const i = prev.findIndex((b) => b.sourceKey === binding.sourceKey && b.destinationId === binding.destinationId);
      if (i >= 0) { const next = [...prev]; next[i] = binding; return next; }
      return [...prev, binding];
    }); // optimistic upsert
    await ipc.invoke('bindings:set', binding);
    await refresh();
  }, [ipc, refresh]);

  const removeBinding = useCallback(async (sourceKey: string, destinationId: string) => {
    if (!ipc) return;
    setBindings((prev) => prev.filter((b) => !(b.sourceKey === sourceKey && b.destinationId === destinationId))); // optimistic
    await ipc.invoke('bindings:remove', { sourceKey, destinationId });
    await refresh();
  }, [ipc, refresh]);

  return { destinations, bindings, refresh, addDestination, updateDestination, removeDestination, setBinding, removeBinding };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- useDestinations`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useDestinations.ts packages/client/src/hooks/useDestinations.test.tsx
git commit -m "feat(client): useDestinations hook — destinations/bindings CRUD (no UI yet)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 8: Finish audit #9 — de-duplicate `isElectron` in the pipe components

**Files:**
- Modify: `packages/client/src/hooks/useWebRTC.ts:5-7` (replace local `isElectron` with shared import)
- Modify: `packages/client/src/components/VideoFeed.tsx:5,8` (replace local `isElectron`/`ipc` with shared)
- Modify: `packages/client/src/components/GridView.tsx:3,6` (replace local `isElectron`/`ipc` with shared)

**Context:** These three still redeclare their own `isElectron` (and VideoFeed/GridView their own module-level `ipc`). They are in the delicate MediaRecorder→FFmpeg pipe, so this is a **value-source swap only** (const → import), no logic change. The existing pipe tests (`GridView.pipe.test`, `VideoFeed.pipe.test`) plus the full suite are the guard. **This task changes no behavior; if any test regresses, STOP and report — do not “fix” by altering pipe logic.**

- [ ] **Step 1: Migrate `useWebRTC.ts`**

`useWebRTC.ts` lines 5-7 currently export its own `isElectron`:

```ts
export const isElectron = typeof window !== 'undefined' &&
  (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1 ||
   (window as any).process?.versions?.electron);
```

Replace those lines with a re-export from the shared bridge (keeps any importer of `useWebRTC`'s `isElectron` working):

```ts
import { isElectron } from './useElectronBridge';
export { isElectron };
```

(If `useWebRTC.ts` already imports things from `./useElectronBridge`, merge into the existing import. Keep all other uses of `isElectron` inside the file unchanged — they now reference the imported value.)

- [ ] **Step 2: Migrate `VideoFeed.tsx`**

`VideoFeed.tsx` lines ~5 and ~8 declare module-level `isElectron` and `ipc`:

```ts
const isElectron = /* UA check */;
// ...
const ipc = isElectron ? ((window as any).electron?.ipcRenderer || ((window as any).require ? (window as any).require('electron').ipcRenderer : null)) : null;
```

Replace both declarations with imports from the bridge (add to the file's import block, delete the two local `const` lines):

```ts
import { isElectron, getIpc } from '../hooks/useElectronBridge';
const ipc = getIpc();
```

(Keep `ipc` as a module-level const so the rest of the file is unchanged — `getIpc()` returns the same value the old inline expression did.)

- [ ] **Step 3: Migrate `GridView.tsx`**

Same swap as VideoFeed: delete the local module-level `isElectron` (line ~3) and `ipc` (line ~6) declarations; add:

```ts
import { isElectron, getIpc } from '../hooks/useElectronBridge';
const ipc = getIpc();
```

- [ ] **Step 4: Run the full client suite (the pipe-test guard)**

Run: `npm run test -w client`
Expected: PASS — **0 failures**, including `GridView.pipe.test` and `VideoFeed.pipe.test`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: completes without error.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/hooks/useWebRTC.ts packages/client/src/components/VideoFeed.tsx packages/client/src/components/GridView.tsx
git commit -m "refactor(client): finish audit #9 — useWebRTC/VideoFeed/GridView use shared isElectron+getIpc"
```
(+ `Co-Authored-By` trailer.)

---

## Self-Review

**Spec coverage (spec §5 component architecture + §6 data flow):**
- `useElectronBridge` (single isElectron+ipc, kills audit #9 dup) → Tasks 2 + 8. ✅
- `useRelays` (L3 relay-status/stats → Map) → Task 6. ✅
- `useDestinations` (destinations + bindings CRUD + removeBinding/cascade) → Task 7. ✅
- `useFfmpegPipeline` (L2 ffmpeg-status/stats out of App) → Task 3. ✅
- `useRecordings` (recording state + auto-stop sync) → Task 4. ✅
- `useBroadcastSettings` (bitrate/preset/hwAccel + GPU + localStorage, issue #5) → Task 5. ✅
- `useWebRTC` / `useMediaDevices` kept → unchanged (useWebRTC only loses its dup isElectron in Task 8). ✅
- Event→hook→state table (§6) → matched: server-status stays in useWebRTC; ffmpeg-* → useFfmpegPipeline; relay-* → useRelays; destinations/bindings → useDestinations. ✅

**Intentionally deferred (documented, not gaps):** `AdminDataProvider`/`useAdminData()` and all `admin/`, `live/`, `destinations/`, `recordings/`, `settings/` components → Plan 3 (the re-skin). `ClientPortal` extraction, `RtmpPlayerTile` move to its own file → Plan 3. The `WatermarkConfig` shared-type reservation + locked Pro toggle → Plan 3 (per R2). `useMediaDevices` already exists.

**Placeholder scan:** none — every code step shows full file content or exact old→new blocks; Task 6/7 flag the cross-package `import type` path explicitly with a STOP-and-report if it doesn't resolve.

**Type/name consistency:** `IpcBridge`/`IpcListener` defined in Task 2, imported by Tasks 3–7. `useElectronBridge`/`isElectron`/`getIpc` (Task 2) reused in Task 8. Hook return aliases in App rewires (`status→ffmpegStatus`, `stats→ffmpegStats`, `bitrate→broadcastBitrate`, etc.) preserve every name the existing JSX reads, so no JSX edits are required. The `RelayEntry`/`RelayState`/`RtmpDestination`/`DestinationBinding` types come from `packages/shared/index.ts` (verified shapes). Each App-rewire task runs the full client suite to prove the UI is unchanged.
