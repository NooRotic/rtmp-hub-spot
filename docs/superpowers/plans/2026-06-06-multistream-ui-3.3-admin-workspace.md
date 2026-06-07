# Multi-Stream UI — Plan 3.3: AdminWorkspace tab shell + G1 section migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy admin sidebar's restream/telemetry/settings sections with a dark-NT tabbed `AdminWorkspace` (Live · Destinations · Recordings · Settings) that consumes `useAdminData()`, leaving only the grid/clients (G2) controls in the old sidebar. Front-load the provider-perf prep so the new multi-consumer tree doesn't re-render on every App state change.

**Architecture:** `AdminWorkspace` is a dark-NT `NTWindow` with a tab bar + local active-tab state; each tab is a focused component reading the G1 slice it needs from `useAdminData()`. The self-contained G1 sidebar sections (FFmpeg health, Live Publishers w/ preview+REC, RTMP Viewers, Recordings, Broadcast Settings — all confirmed self-contained by the App.tsx render map) move verbatim-in-behavior into `LiveTab`/`RecordingsTab`/`SettingsTab`. `RtmpPlayerTile` is extracted from `App.tsx` to its own file so the tabs can use it without a circular import. The G2 sections (Connected Clients, Grid Controls, Add Feed) stay in the sidebar untouched. Before any of that, two prep tasks make the provider value referentially stable.

**Tech Stack:** React 18 + TypeScript, Vitest + jsdom, the in-house `test/testUtils` harness, the Plan 3.1 `ui/` primitives, the Plan 3.2 `AdminDataProvider`/`useAdminData`.

**Source of truth:** spec §4 (IA / tabs) + §6. Data: the `AdminData` contract from Plan 3.2 (`packages/client/src/admin/AdminDataProvider.tsx`).

**This is Plan 3.3 of 5.** Depends on Plan 3.1 primitives + Plan 3.2 provider (both on this branch). **Deferred to 3.4:** the Destinations tab's real CRUD UI (`SourceCard`/`DestinationRow`/`AddDestinationPicker`), the locked Pro watermark toggle, and `PreviewMonitor` (B-core). **Deferred to 3.5:** `ClientPortal` + the G2 sidebar's own re-skin.

**Visual-work note:** tasks 4–7 build functional dark-NT components with concrete skeletons + behavior tests; the exact spacing/polish is refined in the Task 8 `npm run dev` eyeball, not pre-specified to the pixel.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/hooks/useRecordings.ts` | Modify | Wrap `startRecording`/`stopRecording`/`openRecordingsDir` in `useCallback` (referential stability). |
| `packages/client/src/components/RtmpPlayerTile.tsx` | Create | The mpegts preview tile, extracted from App.tsx (+ `localFlvUrl`). |
| `packages/client/src/App.tsx` | Modify | Re-export `RtmpPlayerTile` from its new home; `useCallback` on `refreshTelemetry`; `useMemo` on `adminData`; render `<AdminWorkspace/>` in the sidebar and delete the 5 migrated G1 sections. |
| `packages/client/src/admin/AdminWorkspace.tsx` | Create | Dark-NT tab shell (tab bar + active-tab state) hosting the 4 tabs. |
| `packages/client/src/admin/AdminWorkspace.test.tsx` | Create | Tab switching. |
| `packages/client/src/admin/tabs/RecordingsTab.tsx` | Create | Active Recordings (G1). |
| `packages/client/src/admin/tabs/SettingsTab.tsx` | Create | Broadcast Settings (G1). |
| `packages/client/src/admin/tabs/LiveTab.tsx` | Create | FFmpeg health + Live Publishers (preview/REC) + RTMP Viewers (G1). |
| `packages/client/src/admin/tabs/*.test.tsx` | Create | Per-tab render + interaction tests. |
| `packages/client/src/ui/dark-nt.css` | Modify | Tab-bar + tab-panel + table classes. |

**Unchanged on purpose:** the G2 sidebar sections (Connected Clients, Grid Controls, Add Feed), the main area (Admin Video Hub, GridView, VideoFeed), `ServerStatusBar`, the client/lobby branches.

---

### Task 1: Stabilize `useRecordings` handlers (perf prep)

**Files:**
- Modify: `packages/client/src/hooks/useRecordings.ts`

**Context:** `adminData` will be memoized (Task 3), but a `useMemo` only helps if its dependencies are referentially stable. `useRecordings` currently returns three fresh function identities every render. Wrap them in `useCallback`. Behavior is identical; the existing `useRecordings.test.tsx` (7 tests) must stay green.

- [ ] **Step 1: Wrap the three handlers in `useCallback`**

In `packages/client/src/hooks/useRecordings.ts`, change the three handler definitions. Add `useCallback` to the React import. Replace:

```ts
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
```

with the same bodies wrapped in `useCallback`, each keyed on `[ipc]`:

```ts
  const startRecording = useCallback(async (streamKey: string) => {
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
  }, [ipc]);

  const stopRecording = useCallback((streamKey: string) => {
    if (!ipc) return;
    ipc.send('stop-recording', { streamKey });
    setActiveRecordings((prev) => prev.filter((r) => r.streamKey !== streamKey));
  }, [ipc]);

  const openRecordingsDir = useCallback(() => {
    if (!ipc) return;
    ipc.send('open-recordings-dir');
  }, [ipc]);
```

- [ ] **Step 2: Run the existing useRecordings tests**

Run: `npm run test -w client -- useRecordings`
Expected: PASS — all 7 tests still green (behavior unchanged).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useRecordings.ts
git commit -m "perf(client): useCallback-stabilize useRecordings handlers (provider memo prep)"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: Extract `RtmpPlayerTile` to its own file

**Files:**
- Create: `packages/client/src/components/RtmpPlayerTile.tsx`
- Modify: `packages/client/src/App.tsx` (move it out, re-export for back-compat)
- Test: reuse the existing `packages/client/src/App.rtmp-preview.test.tsx` (it imports `RtmpPlayerTile` from `./App`).

**Context:** `RtmpPlayerTile` + `localFlvUrl` currently live in `App.tsx` (exported). `LiveTab` (Task 7) needs it; importing from `App.tsx` into a component that `App` renders is a circular import. Move it to `components/RtmpPlayerTile.tsx`. Keep a re-export from `App.tsx` so the existing `App.rtmp-preview.test.tsx` (which imports `{ RtmpPlayerTile } from './App'`) keeps working.

- [ ] **Step 1: Create the component file**

Create `packages/client/src/components/RtmpPlayerTile.tsx` with the EXACT current `localFlvUrl` + `RtmpPlayerTile` content (copy from App.tsx verbatim — read App.tsx to get the current text; it is the `const localFlvUrl = ...` line and the `export const RtmpPlayerTile = ...` component, including the `import mpegts from 'mpegts.js'` and `useRef`/`useEffect` it needs):

```tsx
import { useRef, useEffect } from 'react';
import mpegts from 'mpegts.js';

// The admin renderer is always co-located with NMS, which binds 0.0.0.0:8000 by
// default — so it plays its OWN local NMS back over LOOPBACK. Using serverStatus.local
// (the LAN IP) here was wrong: it's CSP-blocked (connect-src only allows loopback
// http) and pointless. The LAN address is for SHARING routes to other devices — a
// separate concern. 127.0.0.1 (not "localhost") matches NMS's IPv4 0.0.0.0 bind exactly.
export const localFlvUrl = (streamKey: string) => `http://127.0.0.1:8000/live/${streamKey}.flv`;

/**
 * Inline RTMP preview player using mpegts.js for a single publisher stream.
 * Self-contained: attaches/destroys its own mpegts instance. Always plays the
 * local NMS over loopback (see localFlvUrl).
 */
export const RtmpPlayerTile = ({ streamKey }: { streamKey: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!videoRef.current || !mpegts.getFeatureList().mseLivePlayback) return;
    const player = mpegts.createPlayer({ type: 'flv', isLive: true, url: localFlvUrl(streamKey) });
    player.attachMediaElement(videoRef.current);
    player.load();
    void (player.play() as unknown as Promise<void>)?.catch(() => {});
    return () => { try { player.destroy(); } catch (_) {} };
  }, [streamKey]);
  return <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', maxHeight: '120px', background: '#000', display: 'block', marginTop: '4px' }} />;
};
```

(Confirm the copied text matches App.tsx's current version exactly — if App.tsx's `RtmpPlayerTile` differs, copy ITS version.)

- [ ] **Step 2: Update `App.tsx` to re-export from the new file**

In `App.tsx`: delete the `const localFlvUrl = ...` line and the `export const RtmpPlayerTile = ...` block. Where they were (top of file), add a re-export so existing importers keep working:

```ts
export { RtmpPlayerTile, localFlvUrl } from './components/RtmpPlayerTile';
```

If `App.tsx`'s own JSX uses `localFlvUrl` elsewhere (the synthetic-feed effect did — search for `localFlvUrl(`), it now gets it from the re-export/import; ensure `localFlvUrl` is imported into App's scope if used internally: add `import { localFlvUrl } from './components/RtmpPlayerTile';` near the top (a re-export alone does NOT bring the name into local scope). Confirm by searching App.tsx for `localFlvUrl(` usages and `RtmpPlayerTile` usages; both must resolve. If `mpegts` is now unused in App.tsx, remove its import.

- [ ] **Step 3: Run the affected tests**

Run: `npm run test -w client -- App.rtmp-preview`
Expected: PASS (the test imports `RtmpPlayerTile` from `./App` — the re-export keeps it valid).

- [ ] **Step 4: Full suite + build**

Run: `npm run test -w client`
Expected: 0 failures.
Run: `npm run build`
Expected: clean (no unused-import errors; `mpegts`/`localFlvUrl` resolve correctly).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/components/RtmpPlayerTile.tsx packages/client/src/App.tsx
git commit -m "refactor(client): extract RtmpPlayerTile to its own file (re-exported from App)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 3: `useCallback` refreshTelemetry + `useMemo` adminData (perf prep)

**Files:**
- Modify: `packages/client/src/App.tsx`

**Context:** With `useRecordings` handlers (Task 1) and the `useDestinations` actions (already `useCallback`) and the `useBroadcastSettings` setters (useState setters, stable) now stable, the only remaining unstable input to `adminData` is App's `refreshTelemetry`. Stabilize it, then wrap `adminData` in `useMemo` so the provider value only changes when its data actually changes — preventing the 3.3 tab tree from re-rendering on unrelated App state changes (e.g. `previewOpen` toggles re-render only the consumers that read previewOpen... note previewOpen IS an adminData input, so it stays a dep; that's correct).

- [ ] **Step 1: Stabilize `refreshTelemetry`**

In `App.tsx`, find `const refreshTelemetry = () => { ... }` (it calls `ipc.send('telemetry-refresh')` when `ipc`). Wrap in `useCallback` keyed on `[ipc]`:

```ts
  const refreshTelemetry = useCallback(() => {
    if (ipc) {
      ipc.send('telemetry-refresh');
    }
  }, [ipc]);
```

(Confirm the existing body before replacing; preserve it.)

- [ ] **Step 2: Memoize `adminData`**

Wrap the existing `const adminData: AdminData = { ... };` object in `useMemo`, keyed on every value it reads:

```ts
  const adminData: AdminData = useMemo(() => ({
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
  }), [
    socketStatus, isConnected, serverStatus, bindings, relays, destinations,
    ffmpegStatus, ffmpegStats, activeRecordings, recNow,
    startRecording, stopRecording, openRecordingsDir,
    broadcastBitrate, setBroadcastBitrate, broadcastPreset, setBroadcastPreset, hwAccel, setHwAccel, detectedEncoder,
    addDestination, updateDestination, removeDestination, setBinding, removeBinding, refreshDestinations,
    previewOpen, setPreviewOpen, refreshTelemetry,
  ]);
```

(`deriveSources` is recomputed inside the memo when `serverStatus`/`bindings` change — correct. The `useState` setters and the now-`useCallback` handlers are stable, so the memo only recomputes when real data changes.)

- [ ] **Step 3: Full suite + build**

Run: `npm run test -w client`
Expected: 0 failures.
Run: `npm run build`
Expected: clean (no exhaustive-deps lint error — if the build runs eslint and flags a missing/extra dep, align the dep array to exactly the referenced values).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/App.tsx
git commit -m "perf(client): useCallback refreshTelemetry + useMemo adminData (stable provider value)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: `AdminWorkspace` shell (dark-NT tabs)

**Files:**
- Create: `packages/client/src/admin/AdminWorkspace.tsx`
- Create: `packages/client/src/admin/AdminWorkspace.test.tsx`
- Modify: `packages/client/src/ui/dark-nt.css` (tab classes)

**Context:** A dark-NT `NTWindow` titled "Workspace" with a tab bar (Live · Destinations · Recordings · Settings) and `useState` active tab (default 'live'). Renders the active tab's component. Destinations is a placeholder this plan ("Destination management — 3.4"); the other three are real (Tasks 5–7). Built before the tabs so they have a host; the test uses simple inline stand-ins until the real tabs land — but since the real tab components are created in the SAME plan, import them directly and assert each tab's distinctive content appears when selected.

- [ ] **Step 1: Add tab CSS**

Append to `packages/client/src/ui/dark-nt.css`:

```css
/* Tabbed workspace. */
.ntd-tabs { display: flex; gap: 2px; padding: 4px 4px 0; background: var(--ntd-face); }
.ntd-tab {
  background: var(--ntd-face-2);
  color: var(--ntd-text-dim);
  border-top: 2px solid var(--ntd-hi);
  border-left: 2px solid var(--ntd-hi);
  border-right: 2px solid var(--ntd-sh);
  border-bottom: none;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.ntd-tab--active { background: var(--ntd-face); color: var(--ntd-text); font-weight: bold; position: relative; top: 1px; }
.ntd-tabpanel { padding: 8px; background: var(--ntd-face); overflow-y: auto; }
```

- [ ] **Step 2: Write the failing test**

Create `packages/client/src/admin/AdminWorkspace.test.tsx`:

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { AdminDataProvider, type AdminData } from './AdminDataProvider';
import { AdminWorkspace } from './AdminWorkspace';
import type { RelayEntry } from '../hooks/useRelays';

const data = (over: Partial<AdminData> = {}): AdminData => ({
  socketStatus: 'connected', isConnected: true,
  serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 0, rtmpSessions: [], rtmpPublishers: [] },
  sources: [], relays: new Map<string, RelayEntry>(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
  ...over,
});

const renderWs = (over?: Partial<AdminData>) =>
  render(<AdminDataProvider value={data(over)}><AdminWorkspace /></AdminDataProvider>);

afterEach(cleanup);

describe('AdminWorkspace', () => {
  it('shows the Live tab by default and switches tabs on click', () => {
    const { container } = renderWs();
    // Live tab active by default
    const tabs = [...container.querySelectorAll('.ntd-tab')].map((t) => t.textContent);
    expect(tabs).toEqual(['Live', 'Destinations', 'Recordings', 'Settings']);
    expect(container.querySelector('.ntd-tab--active')?.textContent).toBe('Live');
    // Switch to Settings
    fireEvent.click(screen.getByText('Settings'));
    expect(container.querySelector('.ntd-tab--active')?.textContent).toBe('Settings');
    // Settings tab shows a Broadcast-settings marker (the Target Bitrate label)
    expect(container.textContent).toMatch(/bitrate/i);
  });

  it('Destinations tab is a 3.4 placeholder', () => {
    const { container } = renderWs();
    fireEvent.click(screen.getByText('Destinations'));
    expect(container.textContent).toMatch(/3\.4|coming|destination management/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -w client -- AdminWorkspace`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement** — Create `packages/client/src/admin/AdminWorkspace.tsx`:

```tsx
import { useState } from 'react';
import { NTWindow } from '../ui/NTWindow';
import { LiveTab } from './tabs/LiveTab';
import { RecordingsTab } from './tabs/RecordingsTab';
import { SettingsTab } from './tabs/SettingsTab';

type TabKey = 'live' | 'destinations' | 'recordings' | 'settings';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'destinations', label: 'Destinations' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'settings', label: 'Settings' },
];

/** Dark-NT tabbed admin workspace (spec §4). Each tab reads its slice of useAdminData. */
export function AdminWorkspace() {
  const [active, setActive] = useState<TabKey>('live');
  return (
    <NTWindow title="Workspace" className="ntd">
      <div className="ntd-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`ntd-tab${active === t.key ? ' ntd-tab--active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ntd-tabpanel">
        {active === 'live' && <LiveTab />}
        {active === 'recordings' && <RecordingsTab />}
        {active === 'settings' && <SettingsTab />}
        {active === 'destinations' && (
          <div style={{ color: 'var(--ntd-text-dim)', padding: '12px' }}>
            Destination management — coming in 3.4.
          </div>
        )}
      </div>
    </NTWindow>
  );
}
```

(Tasks 5–7 create `RecordingsTab`/`SettingsTab`/`LiveTab`. Implement those FIRST if doing strict TDD per-file, or stub them as `export function X(){return null}` to get AdminWorkspace compiling, then fill in. Recommended order: do Task 5/6/7 then return to make AdminWorkspace's test pass. The plan lists AdminWorkspace first for narrative; the implementer may create minimal tab stubs to compile, then the tab tasks replace them.)

- [ ] **Step 5: (after Tasks 5–7) Run test to verify it passes**

Run: `npm run test -w client -- AdminWorkspace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/admin/AdminWorkspace.tsx packages/client/src/admin/AdminWorkspace.test.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(admin): AdminWorkspace dark-NT tab shell (Live/Destinations/Recordings/Settings)"
```
(+ `Co-Authored-By` trailer.)

> Implementer note: to avoid an import cycle, create the three tab files (Tasks 5–7) before or alongside this task. If you commit Task 4 after 5–7, fold them into a sensible commit order; the spec/quality review runs once all four (shell + 3 tabs) compile and their tests pass.

---

### Task 5: `RecordingsTab`

**Files:**
- Create: `packages/client/src/admin/tabs/RecordingsTab.tsx`
- Create: `packages/client/src/admin/tabs/RecordingsTab.test.tsx`

**Context:** Dark-NT version of the Active Recordings sidebar section (App.tsx ~771–814), reading `useAdminData().recordings` (`active`, `now`, `start`, `stop`, `openDir`). Same behavior: a Folder button (openDir), empty state, and per-recording rows with elapsed `mm:ss` (from `now - startTime`), filename, and a Stop button.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/admin/tabs/RecordingsTab.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { RecordingsTab } from './RecordingsTab';

const base: AdminData = {
  socketStatus: 'connected', isConnected: true,
  serverStatus: null, sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};
const withRecordings = (over: Partial<AdminData['recordings']>): AdminData => ({ ...base, recordings: { ...base.recordings, ...over } });

afterEach(cleanup);

describe('RecordingsTab', () => {
  it('shows the empty state when no recordings', () => {
    render(<AdminDataProvider value={base}><RecordingsTab /></AdminDataProvider>);
    expect(screen.getByText(/no active recordings/i)).toBeTruthy();
  });

  it('lists an active recording with elapsed time and stops it on click', () => {
    const stop = vi.fn();
    const data = withRecordings({ active: [{ streamKey: 'grid', path: 'C:/rec/grid.mp4', startTime: 1000 }], now: 1000 + 65_000, stop });
    render(<AdminDataProvider value={data}><RecordingsTab /></AdminDataProvider>);
    expect(screen.getByText('grid')).toBeTruthy();
    expect(screen.getByText(/01:05/)).toBeTruthy();      // 65s → 01:05
    expect(screen.getByText(/grid\.mp4/)).toBeTruthy();
    fireEvent.click(screen.getByText(/stop/i));
    expect(stop).toHaveBeenCalledWith('grid');
  });

  it('opens the recordings folder', () => {
    const openDir = vi.fn();
    render(<AdminDataProvider value={withRecordings({ openDir })}><RecordingsTab /></AdminDataProvider>);
    fireEvent.click(screen.getByText(/folder/i));
    expect(openDir).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- RecordingsTab`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — Create `packages/client/src/admin/tabs/RecordingsTab.tsx`:

```tsx
import { useAdminData } from '../AdminDataProvider';
import { NTButton } from '../../ui/NTButton';

/** Dark-NT Active Recordings panel (spec §4 Recordings tab). Behavior mirrors the
 *  legacy sidebar section; styling refined live. */
export function RecordingsTab() {
  const { recordings } = useAdminData();
  const { active, now, stop, openDir } = recordings;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>{active.length > 0 ? `Recording (${active.length})` : 'Recordings'}</strong>
        <NTButton onClick={openDir}>Folder</NTButton>
      </div>
      {active.length === 0 ? (
        <div style={{ color: 'var(--ntd-text-dim)' }}>No active recordings. Use REC on a Live source.</div>
      ) : (
        active.map((rec) => {
          const elapsed = Math.floor((now - rec.startTime) / 1000);
          const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
          const ss = String(elapsed % 60).padStart(2, '0');
          const filename = rec.path.split(/[/\\]/).pop() || rec.path;
          return (
            <div key={rec.streamKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 5, padding: '4px 6px', background: 'var(--ntd-face-2)', border: '1px solid var(--ntd-error)' }}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <code style={{ color: 'var(--ntd-error)', fontWeight: 'bold' }}>{rec.streamKey}</code>
                <code style={{ background: 'var(--ntd-error)', color: '#fff', padding: '0 4px' }}>{mm}:{ss}</code>
                <span title={rec.path} style={{ color: 'var(--ntd-text-dim)', fontSize: 11 }}>{filename}</span>
              </span>
              <NTButton onClick={() => stop(rec.streamKey)}>Stop</NTButton>
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- RecordingsTab`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/tabs/RecordingsTab.tsx packages/client/src/admin/tabs/RecordingsTab.test.tsx
git commit -m "feat(admin): RecordingsTab (dark-NT, from useAdminData.recordings)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 6: `SettingsTab`

**Files:**
- Create: `packages/client/src/admin/tabs/SettingsTab.tsx`
- Create: `packages/client/src/admin/tabs/SettingsTab.test.tsx`

**Context:** Dark-NT version of Broadcast Settings (App.tsx ~816–911), reading `useAdminData().settings`. GPU badge + three `<select>`s (bitrate / preset / hwAccel). Preserve the option values exactly: bitrate `1500k/2500k/5000k`; preset `ultrafast/superfast/veryfast/faster/fast/medium`; hwAccel `none/amd/nvidia/intel` (with the auto-detected/not-found markers).

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/admin/tabs/SettingsTab.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { SettingsTab } from './SettingsTab';

const base: AdminData = {
  socketStatus: 'connected', isConnected: true,
  serverStatus: null, sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};
const withSettings = (over: Partial<AdminData['settings']>): AdminData => ({ ...base, settings: { ...base.settings, ...over } });

afterEach(cleanup);

describe('SettingsTab', () => {
  it('reflects the current bitrate and calls setBitrate on change', () => {
    const setBitrate = vi.fn();
    const { container } = render(<AdminDataProvider value={withSettings({ bitrate: '2500k', setBitrate })}><SettingsTab /></AdminDataProvider>);
    const bitrate = container.querySelector('select[data-field="bitrate"]') as HTMLSelectElement;
    expect(bitrate.value).toBe('2500k');
    fireEvent.change(bitrate, { target: { value: '5000k' } });
    expect(setBitrate).toHaveBeenCalledWith('5000k');
  });

  it('calls setHwAccel on encoder change', () => {
    const setHwAccel = vi.fn();
    const { container } = render(<AdminDataProvider value={withSettings({ setHwAccel })}><SettingsTab /></AdminDataProvider>);
    const accel = container.querySelector('select[data-field="hwAccel"]') as HTMLSelectElement;
    fireEvent.change(accel, { target: { value: 'amd' } });
    expect(setHwAccel).toHaveBeenCalledWith('amd');
  });

  it('shows a HW-accel badge when an encoder is detected', () => {
    render(<AdminDataProvider value={withSettings({ detectedEncoder: { best: 'amd', bestLabel: 'AMD AMF', available: ['amd'] } })}><SettingsTab /></AdminDataProvider>);
    expect(screen.getByText(/AMD AMF/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- SettingsTab`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — Create `packages/client/src/admin/tabs/SettingsTab.tsx`:

```tsx
import { useAdminData } from '../AdminDataProvider';

const BITRATES = [
  { value: '1500k', label: '1500k (Optimized)' },
  { value: '2500k', label: '2500k (Standard)' },
  { value: '5000k', label: '5000k (High Quality)' },
];
const PRESETS = [
  { value: 'ultrafast', label: 'Ultrafast (Low CPU)' },
  { value: 'superfast', label: 'Superfast' },
  { value: 'veryfast', label: 'Veryfast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium (Better Quality)' },
];
const ENCODERS = [
  { value: 'none', label: 'Software (x264)' },
  { value: 'amd', label: 'AMD AMF' },
  { value: 'nvidia', label: 'NVIDIA NVENC' },
  { value: 'intel', label: 'Intel QSV' },
];
const sel: React.CSSProperties = { width: '100%' };

/** Dark-NT Broadcast Settings (spec §4 Settings tab). Behavior mirrors the legacy
 *  section; styling refined live. Option values are preserved exactly. */
export function SettingsTab() {
  const { settings } = useAdminData();
  const { bitrate, setBitrate, preset, setPreset, hwAccel, setHwAccel, detectedEncoder } = settings;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ padding: 6, background: 'var(--ntd-face-2)', border: '1px solid var(--ntd-sh)' }}>
        <strong>GPU Detection: </strong>
        {detectedEncoder ? (
          <span>{detectedEncoder.best !== 'none' ? '● HW ACCEL' : '○ SOFTWARE'} — best: <strong>{detectedEncoder.bestLabel}</strong></span>
        ) : (
          <span style={{ color: 'var(--ntd-text-dim)' }}>SCANNING…</span>
        )}
      </div>

      <label>Target Bitrate
        <select className="ntd-field" data-field="bitrate" style={sel} value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
          {BITRATES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <label>FFmpeg Preset
        <select className="ntd-field" data-field="preset" style={sel} value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <label>Encoder Accel
        <select className="ntd-field" data-field="hwAccel" style={sel} value={hwAccel} onChange={(e) => setHwAccel(e.target.value)}>
          {ENCODERS.map((o) => {
            const detected = detectedEncoder?.best === o.value;
            const available = o.value === 'none' || !detectedEncoder || detectedEncoder.available.includes(o.value);
            return (
              <option key={o.value} value={o.value}>
                {o.label}{detected ? ' ★ Auto-detected' : ''}{o.value !== 'none' && !available && detectedEncoder ? ' (not found)' : ''}
              </option>
            );
          })}
        </select>
        {detectedEncoder && hwAccel !== detectedEncoder.best && (
          <div style={{ color: 'var(--ntd-warn)', fontSize: 11 }}>⚠ Override active. Auto-detected: {detectedEncoder.bestLabel}</div>
        )}
      </label>
    </div>
  );
}
```

(The `className="ntd-field"` on a `<select>` reuses the dark inset styling; the `data-field` attrs give the tests a stable selector. Note `<select>` styling under `.ntd-field` is fine for the test; exact appearance is eyeball-refined.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- SettingsTab`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/tabs/SettingsTab.tsx packages/client/src/admin/tabs/SettingsTab.test.tsx
git commit -m "feat(admin): SettingsTab (dark-NT broadcast settings, from useAdminData.settings)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 7: `LiveTab` (FFmpeg health + Live Publishers + RTMP Viewers)

**Files:**
- Create: `packages/client/src/admin/tabs/LiveTab.tsx`
- Create: `packages/client/src/admin/tabs/LiveTab.test.tsx`

**Context:** The default tab. Three G1 panels stacked: (1) **FFmpeg pipeline health** — `ffmpeg.status` (a StatusTag) + `ffmpeg.stats` when running; (2) **Live Publishers** — `serverStatus.rtmpPublishers` list, each with a Preview toggle (`previewOpen`/`setPreviewOpen` + `<RtmpPlayerTile streamKey>`) and a REC button (`recordings.start`/`recordings.stop` depending on whether that key is in `recordings.active`); (3) **RTMP Viewers** — `serverStatus.rtmpSessions` table + a Refresh button (`refreshTelemetry`). Uses `RtmpPlayerTile` from `../../components/RtmpPlayerTile` (Task 2 extraction), `StatusTag` from 3.1.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/admin/tabs/LiveTab.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { LiveTab } from './LiveTab';

// RtmpPlayerTile uses mpegts.js; mock it so the preview toggle renders inertly.
vi.mock('../../components/RtmpPlayerTile', () => ({
  RtmpPlayerTile: ({ streamKey }: { streamKey: string }) => <div data-testid="preview">{streamKey}</div>,
  localFlvUrl: (k: string) => `http://127.0.0.1:8000/live/${k}.flv`,
}));

const base: AdminData = {
  socketStatus: 'connected', isConnected: true,
  serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 1, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
  sources: [], relays: new Map(), destinations: [], bindings: [],
  ffmpeg: { status: { state: 'running', streamKey: 'grid' }, stats: { frame: 90, fps: 30, bitrate: '2500k', speed: 1, time: '00:00:03', size: '1MB', streamKey: 'grid' } },
  recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
  settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
  destinationActions: { add: async () => {}, update: async () => {}, remove: async () => {}, setBinding: async () => {}, removeBinding: async () => {}, refresh: async () => {} },
  previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
};
const render_ = (over: Partial<AdminData> = {}) =>
  render(<AdminDataProvider value={{ ...base, ...over }}><LiveTab /></AdminDataProvider>);

afterEach(cleanup);

describe('LiveTab', () => {
  it('shows the ffmpeg pipeline status', () => {
    const { container } = render_();
    expect(container.textContent).toMatch(/running/i);
  });

  it('lists publishers and starts a recording when none active for that key', () => {
    const start = vi.fn();
    render_({ recordings: { ...base.recordings, start } });
    expect(screen.getByText('grid')).toBeTruthy();
    fireEvent.click(screen.getByText(/rec/i));
    expect(start).toHaveBeenCalledWith('grid');
  });

  it('refresh button fires refreshTelemetry', () => {
    const refreshTelemetry = vi.fn();
    render_({ refreshTelemetry });
    fireEvent.click(screen.getByText(/refresh/i));
    expect(refreshTelemetry).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w client -- LiveTab`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement** — Create `packages/client/src/admin/tabs/LiveTab.tsx`:

```tsx
import { useAdminData } from '../AdminDataProvider';
import { StatusTag } from '../../ui/StatusTag';
import { NTButton } from '../../ui/NTButton';
import { RtmpPlayerTile } from '../../components/RtmpPlayerTile';

/** Dark-NT Live operating view (spec §4): FFmpeg health + Live Publishers + RTMP Viewers.
 *  Behavior mirrors the legacy sidebar sections; styling refined live. */
export function LiveTab() {
  const { ffmpeg, serverStatus, recordings, previewOpen, setPreviewOpen, refreshTelemetry } = useAdminData();
  const publishers = serverStatus?.rtmpPublishers ?? [];
  const sessions = serverStatus?.rtmpSessions ?? [];
  const isRecording = (key: string) => recordings.active.some((r) => r.streamKey === key);
  const togglePreview = (key: string) =>
    setPreviewOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* FFmpeg pipeline health */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <strong>FFmpeg Pipeline</strong>
          <StatusTag state={ffmpeg.status.state} label={ffmpeg.status.state.toUpperCase()} />
        </div>
        {ffmpeg.status.state === 'running' && ffmpeg.stats ? (
          <code style={{ color: 'var(--ntd-text-dim)' }}>
            {ffmpeg.stats.fps}fps · {ffmpeg.stats.bitrate} · {ffmpeg.stats.speed}x · {ffmpeg.stats.time}
          </code>
        ) : (
          <span style={{ color: 'var(--ntd-text-dim)' }}>{ffmpeg.status.message ?? 'No active broadcast.'}</span>
        )}
      </section>

      {/* Live Publishers */}
      <section>
        <strong>Live Publishers</strong>
        {publishers.length === 0 ? (
          <div style={{ color: 'var(--ntd-text-dim)' }}>No publishers.</div>
        ) : (
          publishers.map((p) => (
            <div key={p.streamKey} style={{ borderTop: '1px solid var(--ntd-sh)', paddingTop: 4, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <code style={{ fontWeight: 'bold' }}>{p.streamKey}</code>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <NTButton onClick={() => togglePreview(p.streamKey)}>{previewOpen.has(p.streamKey) ? 'Hide' : 'Preview'}</NTButton>
                  {isRecording(p.streamKey)
                    ? <NTButton onClick={() => recordings.stop(p.streamKey)}>Stop Rec</NTButton>
                    : <NTButton onClick={() => recordings.start(p.streamKey)}>Rec</NTButton>}
                </span>
              </div>
              {previewOpen.has(p.streamKey) && <RtmpPlayerTile streamKey={p.streamKey} />}
            </div>
          ))
        )}
      </section>

      {/* RTMP Viewers */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong>RTMP Viewers</strong>
          <NTButton onClick={refreshTelemetry}>Refresh</NTButton>
        </div>
        {sessions.length === 0 ? (
          <div style={{ color: 'var(--ntd-text-dim)' }}>No viewers.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 11 }}>
            <thead><tr><th style={{ textAlign: 'left' }}>IP</th><th style={{ textAlign: 'left' }}>Path</th><th style={{ textAlign: 'left' }}>Uptime</th></tr></thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.id ?? i}><td>{s.ip ?? 'Unknown'}</td><td>{s.path ?? 'Unknown'}</td><td>{s.uptime ?? 0}s</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w client -- LiveTab`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/tabs/LiveTab.tsx packages/client/src/admin/tabs/LiveTab.test.tsx
git commit -m "feat(admin): LiveTab (ffmpeg health + publishers preview/REC + viewers)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 8: Mount `AdminWorkspace` in App; delete the migrated sidebar sections

**Files:**
- Modify: `packages/client/src/App.tsx`

**Context:** Render `<AdminWorkspace/>` in the sidebar and DELETE the five now-migrated G1 sections: FFmpeg Pipeline Health (`<h3>…FFmpeg Pipeline</h3>` block), Live Publishers, RTMP Viewers, the "Rendering Options" help box, Active Recordings, and Broadcast Settings. KEEP the G2 sections: System Status, Connected Clients & Feeds, Grid Controls, Add RTMP Feed, Active RTMP Links, and the `<ChatBox>`.

- [ ] **Step 1: Add the import**

Near App's admin imports add:
```ts
import { AdminWorkspace } from './admin/AdminWorkspace';
```

- [ ] **Step 2: Delete the migrated sections, mount AdminWorkspace**

READ the sidebar JSX (the `<div className="side-panel">…</div>` block). Locate and DELETE these contiguous-ish sections (identify each by its `<h3>` header / comment; the App.tsx render map + grep give the markers):
- `FFmpeg Pipeline` health block (header `FFmpeg Pipeline` through the end of its panel)
- `Live Publishers` block (comment `{/* Live Publishers … */}` + header through its list)
- `RTMP Viewers` block (header `RTMP Viewers` through its table)
- the `Rendering Options:` help box
- `Active Recordings` block (comment `{/* Active Recordings Panel */}` through its panel)
- `Broadcast Settings` block (header `Broadcast Settings` through its panel — ends just before the sidebar's closing `</div>` + `<ChatBox>`)

In their place (a single insertion point, e.g. right after the Grid Controls / Add RTMP Feed / Active RTMP Links G2 sections and before `<ChatBox>`), add:
```tsx
                <AdminWorkspace />
```

KEEP: System Status, Connected Clients & Feeds, Grid Controls, Add RTMP Feed, Active RTMP Links, `<ChatBox>`. Do NOT touch the main area (Admin Video Hub, GridView, VideoFeed) or the client/lobby branches.

After deleting, search App.tsx for any now-UNUSED variables that were ONLY read by the deleted sections — e.g. if `recNow`, `activeRecordings`, `broadcastBitrate`, `ffmpegStatus`, etc. are no longer referenced in JSX, they're still needed because they feed `adminData` (the memo). So they are NOT unused. BUT a handler like the inline preview/clipboard logic that lived only in a deleted section may now be unused — remove only genuinely-unused locals that tsc/build flags. Do NOT remove anything still referenced by `adminData` or the remaining JSX.

- [ ] **Step 3: Full client suite (regression guard)**

Run: `npm run test -w client`
Expected: PASS — 0 failures. (`App.test.tsx` renders `<App/>`; the migrated content now lives in AdminWorkspace tabs but `<App/>` still renders it via the provider, so any assertion on, say, "Broadcast Settings" text may need the tab to be active. If `App.test` asserts text that's now behind an inactive tab, update that assertion minimally to target text still visible by default — the Live tab is default — or remove the now-irrelevant assertion. Report any App.test change.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Manual eyeball**

Run: `npm run dev`, open the admin window. Expected: the sidebar's lower half is now the dark-NT **AdminWorkspace** with Live/Destinations/Recordings/Settings tabs. Live shows FFmpeg health + publishers (Preview/REC) + viewers; Recordings + Settings work; Destinations says "coming in 3.4". The G2 sidebar bits (clients, grid controls, add feed) + the main area are unchanged. Verify: switching tabs works; Preview shows the loopback player; REC toggles; settings selects change the broadcast. THIS is the visual milestone — refine spacing/polish here if needed (small CSS tweaks only).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/App.tsx
git commit -m "wire(client): mount AdminWorkspace in sidebar; remove migrated G1 sections"
```
(+ `Co-Authored-By` trailer; include App.test.tsx if you had to adjust an assertion.)

---

## Self-Review

**Spec coverage (§4 tabs / §6):**
- Tabbed workspace Live · Destinations · Recordings · Settings → AdminWorkspace (Task 4). ✅
- Live: FFmpeg health + Live Publishers (preview/REC) + RTMP Viewers → LiveTab (Task 7). ✅
- Recordings tab → RecordingsTab (Task 5). ✅
- Settings: broadcast quality (bitrate/preset/encoder + GPU) → SettingsTab (Task 6). ✅
- Provider value stability for the multi-consumer tree → Tasks 1 + 3. ✅
- `RtmpPlayerTile (extracted)` (spec §5) → Task 2. ✅

**Deferred (documented, NOT gaps):** Destinations CRUD (`SourceCard`/`DestinationRow`/`AddDestinationPicker`) + locked Pro watermark toggle + `PreviewMonitor` (B-core) → 3.4. The grid-options (watermark/burn-in) currently in the G2 Grid Controls stay there for now; spec §4 puts them in Settings — that consolidation is a 3.4/3.5 cleanup. `ClientPortal` + G2 re-skin → 3.5.

**Placeholder scan:** none — every component has a concrete skeleton + behavior test; Task 8 instructs reading the sidebar to find the exact section boundaries (the render map + grep give the `<h3>` markers) rather than guessing line numbers. Visual polish is explicitly an eyeball-step refinement, not a placeholder.

**Type/name consistency:** all tabs consume `useAdminData()` (`recordings`/`settings`/`ffmpeg`/`serverStatus`/`previewOpen`/`setPreviewOpen`/`refreshTelemetry`) — the exact `AdminData` field names from Plan 3.2. `RtmpPlayerTile` import path (`../../components/RtmpPlayerTile`) matches Task 2's new file. `StatusTag`/`NTButton`/`NTWindow` from 3.1. The `.ntd-tab*`/`.ntd-tabpanel` classes (Task 4 CSS) match AdminWorkspace's markup. Settings option values (`1500k/2500k/5000k`, presets, `none/amd/nvidia/intel`) match the legacy section exactly.
