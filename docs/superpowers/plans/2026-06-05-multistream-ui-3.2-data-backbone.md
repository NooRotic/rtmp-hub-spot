# Multi-Stream UI — Plan 3.2: Admin Data Backbone + Server Status Strip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the `AdminDataProvider` / `useAdminData()` data backbone (the single context the re-skinned admin tree will consume) and ship the first visible dark-NT element — a `ServerStatusBar` that replaces the legacy status strip — while leaving the rest of the admin UI untouched.

**Architecture:** `AdminDataProvider` is a **pass-through context**: `App` keeps calling all its hooks (no hook calls move, so no double-subscription risk), assembles a single `AdminData` object (the G1 "restream/telemetry/settings" slice + L1 connection/server status), and passes it as the provider `value`. `useAdminData()` reads it. A pure `serverRollup` helper derives the "N sources → M destinations" counts. `ServerStatusBar` is the first consumer — a dark-NT strip built from the Plan 3.1 primitives. This proves the provider→primitive integration end-to-end on a small, low-risk surface before Plan 3.3 extracts the full tabbed workspace.

**Tech Stack:** React 18 + TypeScript, Vitest + jsdom, the in-house `test/testUtils` harness, the Plan 3.1 `ui/` primitives + `ui/dark-nt.css`.

**Source of truth:** `docs/superpowers/specs/2026-06-04-multistream-ui-redesign-design.md` §4 (server status strip + rollup) + §6 (AdminDataProvider / useAdminData). Hook shapes: Plan 2 hooks in `packages/client/src/hooks/`.

**This is Plan 3.2 of 5.** Depends on Plan 2 hooks + Plan 3.1 primitives (`StatusDot`, `dark-nt.css`, `deriveSources`, `SourceRow`, `RelayEntry`), all already on this branch. The big `AdminWorkspace` tab extraction is Plan 3.3.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/admin/serverRollup.ts` | Create | Pure `serverRollup(sources, relays) → { liveSources, activeDestinations }`. |
| `packages/client/src/admin/serverRollup.test.ts` | Create | Counts. |
| `packages/client/src/admin/AdminDataProvider.tsx` | Create | `AdminData` type, `AdminDataProvider` (pass-through context), `useAdminData()` hook. |
| `packages/client/src/admin/AdminDataProvider.test.tsx` | Create | Provides value; throws outside provider. |
| `packages/client/src/admin/ServerStatusBar.tsx` | Create | Dark-NT L1 strip: signaling LED, local IP, clients, publishers, rollup. Consumes `useAdminData`. |
| `packages/client/src/admin/ServerStatusBar.test.tsx` | Create | Renders the data + rollup. |
| `packages/client/src/ui/dark-nt.css` | Modify | Add `.ntd-statusbar` + `.ntd-statusbar__item` layout classes. |
| `packages/client/src/App.tsx` | Modify | Wire `useRelays`/`useDestinations`, assemble `AdminData`, wrap render in `<AdminDataProvider>`, replace the old `.status-bar` block with `<ServerStatusBar/>`. |

**Unchanged on purpose:** every admin sidebar/main-area section other than the status strip; `GridView`/`VideoFeed` (the pipe); the client/lobby branches. Visible change in this plan = the status strip only.

---

### Task 1: `serverRollup` pure helper

**Files:**
- Create: `packages/client/src/admin/serverRollup.ts`
- Create: `packages/client/src/admin/serverRollup.test.ts`

**Context:** Spec §4 — the strip shows a rollup "● N sources live → M destinations". `liveSources` = sources currently publishing; `activeDestinations` = current relay entries (the relay Map only holds non-stopped relays, since a `stopped` status deletes the entry — see `useRelays`). Pure function, reused by `ServerStatusBar`.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/admin/serverRollup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serverRollup } from './serverRollup';
import type { SourceRow } from './sources';
import type { RelayEntry } from '../hooks/useRelays';

const rel = (sourceKey: string, destinationId: string, state: RelayEntry['state']): [string, RelayEntry] => [
  `${sourceKey}::${destinationId}`,
  { sourceKey, destinationId, state },
];

describe('serverRollup', () => {
  it('counts live sources and active relay destinations', () => {
    const sources: SourceRow[] = [
      { sourceKey: 'grid', isLive: true },
      { sourceKey: 'feed-cam', isLive: false },
    ];
    const relays = new Map<string, RelayEntry>([rel('grid', 'yt', 'live'), rel('grid', 'kick', 'connecting')]);
    expect(serverRollup(sources, relays)).toEqual({ liveSources: 1, activeDestinations: 2 });
  });

  it('returns zeros for empty inputs', () => {
    expect(serverRollup([], new Map())).toEqual({ liveSources: 0, activeDestinations: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- serverRollup`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/client/src/admin/serverRollup.ts`:

```ts
import type { SourceRow } from './sources';
import type { RelayEntry } from '../hooks/useRelays';

/**
 * The L1 rollup for the server status strip (spec §4): how many sources are live
 * right now, and how many relay legs are currently fanned out. The relay Map only
 * holds non-stopped relays (a 'stopped' status deletes its entry in useRelays), so
 * its size is the count of active/connecting/reconnecting/error destinations.
 */
export function serverRollup(
  sources: SourceRow[],
  relays: Map<string, RelayEntry>,
): { liveSources: number; activeDestinations: number } {
  return {
    liveSources: sources.filter((s) => s.isLive).length,
    activeDestinations: relays.size,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- serverRollup`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/serverRollup.ts packages/client/src/admin/serverRollup.test.ts
git commit -m "feat(admin): serverRollup — live-sources / active-destinations counts"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: `AdminDataProvider` + `useAdminData`

**Files:**
- Create: `packages/client/src/admin/AdminDataProvider.tsx`
- Create: `packages/client/src/admin/AdminDataProvider.test.tsx`

**Context:** Spec §6 — a context exposing `{ serverStatus, sources, relays, destinations, bindings, settings, actions }` (here expanded to the full G1 contract). It is **pass-through**: `App` assembles the `AdminData` and passes it as `value`; the provider does not call hooks (so App's existing hook calls are the single subscription). `useAdminData()` must be called inside the provider — outside, it throws (a clear error beats a silent null deref). The hook/type shapes come from the Plan 2 hooks.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/admin/AdminDataProvider.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '../test/testUtils';
import { AdminDataProvider, useAdminData, type AdminData } from './AdminDataProvider';

afterEach(cleanup);

const stubData = (over: Partial<AdminData> = {}): AdminData => ({
  socketStatus: 'connected',
  isConnected: true,
  serverStatus: { local: '10.0.0.5', public: 'x', clientCount: 2, rtmpCount: 1, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
  sources: [{ sourceKey: 'grid', isLive: true }],
  relays: new Map(),
  destinations: [],
  bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(),
  setPreviewOpen: () => {},
  refreshTelemetry: () => {},
  ...over,
});

function Probe() {
  const d = useAdminData();
  return <span>IP:{d.serverStatus?.local} CLIENTS:{d.serverStatus?.clientCount}</span>;
}

describe('AdminDataProvider', () => {
  it('exposes the provided value via useAdminData', () => {
    render(
      <AdminDataProvider value={stubData()}>
        <Probe />
      </AdminDataProvider>,
    );
    expect(screen.getByText(/IP:10\.0\.0\.5/)).toBeTruthy();
    expect(screen.getByText(/CLIENTS:2/)).toBeTruthy();
  });

  it('throws a clear error when used outside the provider', () => {
    expect(() => render(<Probe />)).toThrow(/useAdminData must be used within an AdminDataProvider/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- AdminDataProvider`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/client/src/admin/AdminDataProvider.tsx`:

```tsx
import { createContext, useContext, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { RtmpDestination, DestinationBinding } from '../../../shared';
import type { SourceRow } from './sources';
import type { RelayEntry } from '../hooks/useRelays';
import type { FfmpegStatus, FfmpegStats } from '../hooks/useFfmpegPipeline';
import type { ActiveRecording } from '../hooks/useRecordings';
import type { DetectedEncoder } from '../hooks/useBroadcastSettings';

/** Minimal server-status shape the admin UI reads (subset of useWebRTC's serverStatus). */
export interface AdminServerStatus {
  local?: string;
  public?: string;
  clientCount?: number;
  rtmpCount?: number;
  rtmpSessions?: { id?: string; ip?: string; path?: string; uptime?: number; bitrate?: number }[];
  rtmpPublishers?: { streamKey: string; ip?: string; path?: string; uptime?: number }[];
}

/**
 * The single G1 (restream / telemetry / settings / connection) data surface the
 * re-skinned admin tree consumes. Assembled by App from its existing hooks and
 * passed to AdminDataProvider as `value` (pass-through context — the provider does
 * not call hooks, so App remains the single subscriber).
 */
export interface AdminData {
  socketStatus: string;
  isConnected: boolean;
  serverStatus: AdminServerStatus | null;
  sources: SourceRow[];
  relays: Map<string, RelayEntry>;
  destinations: RtmpDestination[];
  bindings: DestinationBinding[];
  ffmpeg: { status: FfmpegStatus; stats: FfmpegStats | null };
  recordings: {
    active: ActiveRecording[];
    now: number;
    start: (streamKey: string) => Promise<void>;
    stop: (streamKey: string) => void;
    openDir: () => void;
  };
  settings: {
    bitrate: string;
    setBitrate: (v: string) => void;
    preset: string;
    setPreset: (v: string) => void;
    hwAccel: string;
    setHwAccel: (v: string) => void;
    detectedEncoder: DetectedEncoder | null;
  };
  destinationActions: {
    add: (d: RtmpDestination) => Promise<void>;
    update: (d: RtmpDestination) => Promise<void>;
    remove: (id: string) => Promise<void>;
    setBinding: (b: DestinationBinding) => Promise<void>;
    removeBinding: (sourceKey: string, destinationId: string) => Promise<void>;
    refresh: () => Promise<void>;
  };
  previewOpen: Set<string>;
  setPreviewOpen: Dispatch<SetStateAction<Set<string>>>;
  refreshTelemetry: () => void;
}

const AdminDataContext = createContext<AdminData | null>(null);

export function AdminDataProvider({ value, children }: { value: AdminData; children: ReactNode }) {
  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

/** Read the admin data. Throws if used outside an AdminDataProvider. */
export function useAdminData(): AdminData {
  const ctx = useContext(AdminDataContext);
  if (ctx === null) {
    throw new Error('useAdminData must be used within an AdminDataProvider');
  }
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- AdminDataProvider`
Expected: PASS.

- [ ] **Step 5: Build (verifies all the cross-hook type imports resolve)**

Run: `npm run build`
Expected: clean. (If any imported type name — `FfmpegStatus`, `FfmpegStats`, `ActiveRecording`, `DetectedEncoder`, `RelayEntry`, `SourceRow` — isn't exported by its module, STOP and report; all were exported by the Plan 2 / 3.1 tasks.)

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/admin/AdminDataProvider.tsx packages/client/src/admin/AdminDataProvider.test.tsx
git commit -m "feat(admin): AdminDataProvider + useAdminData (pass-through G1 context)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 3: `ServerStatusBar` (dark-NT L1 strip)

**Files:**
- Create: `packages/client/src/admin/ServerStatusBar.tsx`
- Create: `packages/client/src/admin/ServerStatusBar.test.tsx`
- Modify: `packages/client/src/ui/dark-nt.css` (add `.ntd-statusbar` layout classes)

**Context:** Spec §4 — the always-visible L1 strip. Reuses the Plan 3.1 `StatusDot` for the signaling LED, consumes `useAdminData()`, and shows the `serverRollup` counts. Signaling tone: connected→'live', connecting→'connecting' (warn), else 'error'.

- [ ] **Step 1: Add the strip CSS**

In `packages/client/src/ui/dark-nt.css`, append:

```css
/* Server status strip (L1). */
.ntd-statusbar {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  background: var(--ntd-face-2);
  border-bottom: 2px solid var(--ntd-sh);
  box-shadow: inset 0 1px var(--ntd-hi);
  padding: 4px 10px;
  font-size: 12px;
  color: var(--ntd-text);
}
.ntd-statusbar__item { display: inline-flex; align-items: center; gap: 5px; }
.ntd-statusbar__label { color: var(--ntd-text-dim); }
.ntd-statusbar__rollup { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-weight: bold; }
```

- [ ] **Step 2: Write the failing test**

Create `packages/client/src/admin/ServerStatusBar.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '../test/testUtils';
import { AdminDataProvider, type AdminData } from './AdminDataProvider';
import { ServerStatusBar } from './ServerStatusBar';
import type { RelayEntry } from '../hooks/useRelays';

const data = (over: Partial<AdminData> = {}): AdminData => ({
  socketStatus: 'connected',
  isConnected: true,
  serverStatus: { local: '10.0.0.5', public: 'x', clientCount: 3, rtmpCount: 2, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
  sources: [{ sourceKey: 'grid', isLive: true }, { sourceKey: 'feed', isLive: false }],
  relays: new Map<string, RelayEntry>([['grid::yt', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }]]),
  destinations: [], bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
  ...over,
});

const renderBar = (over?: Partial<AdminData>) =>
  render(<AdminDataProvider value={data(over)}><ServerStatusBar /></AdminDataProvider>);

afterEach(cleanup);

describe('ServerStatusBar', () => {
  it('shows local IP, client + publisher counts', () => {
    const { container } = renderBar();
    expect(container.textContent).toContain('10.0.0.5');
    expect(container.textContent).toContain('3');  // clients
    expect(container.textContent).toContain('2');  // publishers
  });

  it('shows the live-sources → destinations rollup', () => {
    const { container } = renderBar();
    // 1 live source (grid), 1 active relay destination
    expect(container.textContent).toMatch(/1\s*sources?\s*→\s*1\s*destinations?/i);
  });

  it('signaling dot is live when connected, error when disconnected', () => {
    const { container: live } = renderBar();
    expect(live.querySelector('.ntd-dot--live')).toBeTruthy();
    cleanup();
    const { container: down } = renderBar({ isConnected: false, socketStatus: 'disconnected' });
    expect(down.querySelector('.ntd-dot--error')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w client -- ServerStatusBar`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

Create `packages/client/src/admin/ServerStatusBar.tsx`:

```tsx
import { useAdminData } from './AdminDataProvider';
import { serverRollup } from './serverRollup';
import { StatusDot } from '../ui/StatusDot';

/** L1 server status strip (spec §4). Always visible; consumes useAdminData. */
export function ServerStatusBar() {
  const { socketStatus, isConnected, serverStatus, sources, relays } = useAdminData();
  const { liveSources, activeDestinations } = serverRollup(sources, relays);

  const signalState = isConnected ? 'live' : socketStatus === 'connecting' ? 'connecting' : 'error';

  return (
    <div className="ntd ntd-statusbar">
      <span className="ntd-statusbar__item">
        <StatusDot state={signalState} />
        <span className="ntd-statusbar__label">Signaling</span>
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">IP</span> {serverStatus?.local ?? '—'}
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">Clients</span> {serverStatus?.clientCount ?? 0}
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">Publishers</span> {serverStatus?.rtmpCount ?? 0}
      </span>
      <span className="ntd-statusbar__rollup">
        <StatusDot state={liveSources > 0 ? 'live' : 'idle'} />
        {liveSources} sources → {activeDestinations} destinations
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -w client -- ServerStatusBar`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/admin/ServerStatusBar.tsx packages/client/src/admin/ServerStatusBar.test.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(admin): dark-NT ServerStatusBar (L1 strip + rollup) from useAdminData"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: Wire it into `App.tsx`

**Files:**
- Modify: `packages/client/src/App.tsx`

**Context:** App already calls `useFfmpegPipeline`/`useRecordings`/`useBroadcastSettings` and has `serverStatus`/`socketStatus`/`isConnected`/`recordingStopped`/`ipc` in scope. This task: (a) wire the two unused new hooks `useRelays(ipc)` + `useDestinations(ipc)` (their first consumer — populates relays/destinations/bindings), (b) assemble the `AdminData` object, (c) wrap App's returned tree in `<AdminDataProvider value={adminData}>`, (d) replace the legacy `.status-bar` block (the map located it at App.tsx ~lines 377–398) with `<ServerStatusBar/>`. Everything else stays.

- [ ] **Step 1: Add imports**

Near App's other hook imports add:

```ts
import { useRelays } from './hooks/useRelays';
import { useDestinations } from './hooks/useDestinations';
import { deriveSources } from './admin/sources';
import { AdminDataProvider, type AdminData } from './admin/AdminDataProvider';
import { ServerStatusBar } from './admin/ServerStatusBar';
```

- [ ] **Step 2: Wire the two new hooks**

After the existing `useBroadcastSettings(ipc)` destructure (search for `useBroadcastSettings(ipc)`), add:

```ts
  const { relays } = useRelays(ipc);
  const {
    destinations,
    bindings,
    addDestination,
    updateDestination,
    removeDestination,
    setBinding,
    removeBinding,
    refresh: refreshDestinations,
  } = useDestinations(ipc);
```

- [ ] **Step 3: Assemble `AdminData`**

Place this just before App's `return (` statement (so all the referenced values — `serverStatus`, `socketStatus`, `isConnected`, the hook returns, `previewOpen`/`setPreviewOpen`, `refreshTelemetry` — are in scope). Use the EXACT local names App currently has for the aliased hook returns (`ffmpegStatus`, `ffmpegStats`, `activeRecordings`, `recNow`, `startRecording`, `stopRecording`, `openRecordingsDir`, `broadcastBitrate`, `setBroadcastBitrate`, `broadcastPreset`, `setBroadcastPreset`, `hwAccel`, `setHwAccel`, `detectedEncoder`):

```ts
  const adminData: AdminData = {
    socketStatus,
    isConnected,
    serverStatus: serverStatus ?? null,
    sources: deriveSources(serverStatus ?? null, bindings),
    relays,
    destinations,
    bindings,
    ffmpeg: { status: ffmpegStatus, stats: ffmpegStats },
    recordings: { active: activeRecordings, now: recNow, start: startRecording, stop: stopRecording, openDir: openRecordingsDir },
    settings: {
      bitrate: broadcastBitrate, setBitrate: setBroadcastBitrate,
      preset: broadcastPreset, setPreset: setBroadcastPreset,
      hwAccel, setHwAccel, detectedEncoder,
    },
    destinationActions: {
      add: addDestination, update: updateDestination, remove: removeDestination,
      setBinding, removeBinding, refresh: refreshDestinations,
    },
    previewOpen,
    setPreviewOpen,
    refreshTelemetry,
  };
```

> Note: `serverStatus` from `useWebRTC` is typed richer than `AdminServerStatus`, but `AdminServerStatus`'s fields are a structural subset, so the assignment type-checks. If tsc complains about an exact-type mismatch, cast at the boundary: `serverStatus: (serverStatus ?? null) as AdminData['serverStatus']`.

- [ ] **Step 4: Wrap the return in the provider**

Change App's `return (` so the entire top-level element is wrapped:

```tsx
  return (
    <AdminDataProvider value={adminData}>
      {/* ...the existing top-level element (the outer flex-column div) unchanged... */}
    </AdminDataProvider>
  );
```

Concretely: the existing return is `return ( <div style={{ display:'flex', flexDirection:'column', ... }}> ... </div> );`. Wrap that `<div>...</div>` with `<AdminDataProvider value={adminData}>` … `</AdminDataProvider>`.

- [ ] **Step 5: Replace the legacy status bar with `<ServerStatusBar/>`**

Find the legacy status-strip block (the map located it at ~lines 377–398: a `<div className="status-bar">…</div>` containing the LED `status-item`s reading `socketStatus`/`isConnected`/`serverStatus`). Replace that ENTIRE `<div className="status-bar">…</div>` element with:

```tsx
        <ServerStatusBar />
```

(Read the file to confirm the exact extent of the `.status-bar` div before replacing — replace the whole element, open tag through close tag. Do NOT remove anything outside it.)

- [ ] **Step 6: Run the full client suite (regression guard)**

Run: `npm run test -w client`
Expected: PASS — 0 failures. (`App.test.tsx` renders `<App/>`; it must still pass. If `App.test` mounts App and App now requires the provider for `ServerStatusBar`, that's fine — App renders the provider itself. If App.test mocks `useWebRTC` such that `serverStatus`/`socketStatus` are undefined, the `?? null` / `?? 0` fallbacks keep it safe.)

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 8: Manual eyeball (the first dark-NT element)**

Run: `npm run dev`, open the admin window. Expected: the top status strip is now the dark-NT `ServerStatusBar` (dark face, signaling dot, IP/clients/publishers, and the "N sources → M destinations" rollup on the right). The rest of the admin UI is unchanged (still light). Nothing should be broken. (This is a visual confirmation, not an automated test.)

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/App.tsx
git commit -m "wire(client): AdminDataProvider wraps App; ServerStatusBar replaces legacy status strip"
```
(+ `Co-Authored-By` trailer.)

---

## Self-Review

**Spec coverage (this sub-plan's slice of §4/§6):**
- AdminDataProvider / useAdminData (§6) → Tasks 2 + 4. ✅ (full G1 contract defined; ServerStatusBar is the first consumer; 3.3 components consume the rest.)
- Server status strip: Hub/Signaling LED, Local IP, Clients, Publishers (§4) → ServerStatusBar (Task 3). ✅
- "● N sources live → M destinations" rollup (§4) → serverRollup (Task 1) + ServerStatusBar (Task 3). ✅
- First consumer of `useRelays`/`useDestinations` (Plan 2 hooks) → App wiring (Task 4). ✅

**Deferred to later sub-plans (NOT gaps):** the tabbed `AdminWorkspace` + extraction of the G1 sidebar sections (FFmpeg health, Live Publishers, Recordings, Broadcast Settings) into re-skinned tabs → 3.3. `SourceCard`/`DestinationRow`/`PreviewMonitor` + the Destinations CRUD tab + locked Pro toggle → 3.3/3.4. `ClientPortal` → 3.5. (The provider already exposes everything those will need: `ffmpeg`, `recordings`, `settings`, `destinations`, `bindings`, `relays`, `sources`, `previewOpen`, `destinationActions`, `refreshTelemetry`.)

**Placeholder scan:** none — every step has full content; Task 4 Steps 4–5 instruct reading the file to confirm the exact wrap point + the `.status-bar` element extent before editing (the map gives the ~line range; the implementer confirms the literal boundaries).

**Type/name consistency:** `AdminData` (Task 2) is consumed by `ServerStatusBar` (Task 3) and assembled in App (Task 4) — the field names (`serverStatus`, `sources`, `relays`, `ffmpeg.status/stats`, `recordings.active/now/start/stop/openDir`, `settings.*`, `destinationActions.*`, `previewOpen`) are identical across all three. `serverRollup(sources, relays)` (Task 1) signature matches its callers. `SourceRow`/`RelayEntry`/`FfmpegStatus`/`FfmpegStats`/`ActiveRecording`/`DetectedEncoder` are imported from their Plan 2/3.1 modules (all exported there). `.ntd-statusbar*` classes (Task 3 CSS) match what `ServerStatusBar` renders, and reuse the `.ntd` token scope + `StatusDot` primitive from 3.1.
