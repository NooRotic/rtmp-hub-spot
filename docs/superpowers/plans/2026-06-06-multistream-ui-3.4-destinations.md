# Multi-Stream UI — Plan 3.4: Destinations tab (CRUD + binding + relay status) + locked Pro toggle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Destinations tab a working restream surface — add/edit/remove/enable RTMP destinations, bind them to sources, and watch each relay's live status — replacing the devtools-IPC seeding. Plus ship the locked Pro watermark toggle (visible, disabled, upsell).

**Architecture:** Pure helpers (`platforms` ingest reference, `maskKey`) + an exported `relayKey` from `useRelays` (so the UI looks up relay state with the same key the hook stores). `DestinationForm` (add/edit) and `DestinationsTab` (library list + per-source binding rows with relay `StatusTag`) consume `useAdminData()` and call `destinationActions.*` (which route through the G1–G3 backend, so binding a destination to a *live* source starts its relay immediately). The locked Pro watermark toggle goes in `SettingsTab` against the reserved `WatermarkConfig`.

**Tech Stack:** React 18 + TS, Vitest + jsdom, in-house `test/testUtils`, the 3.1 primitives, the 3.2 provider, the shared restream types.

**Source of truth:** spec §4 (Destinations tab), §8 (destinations & bindings UX + platform ingest reference), §9 (locked Pro watermark). Types: `packages/shared/index.ts` (`Platform`, `RtmpDestination`, `DestinationBinding`, `WatermarkConfig`). Data: `useAdminData()` (`destinations`, `bindings`, `relays`, `sources`, `destinationActions`).

**This is Plan 3.4 of 5.** Deferred to 3.5: moving the operate/monitor view to Live-tab `SourceCard`s + `PreviewMonitor`, `ClientPortal`, and the G2-sidebar re-skin (incl. tidying the non-slugified "Active RTMP Links" label).

**Visual-work note:** the form/tab build functional dark-NT components with concrete skeletons + behavior tests; spacing/polish refined in the Task 6 eyeball.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/admin/platforms.ts` | Create | `PLATFORM_INFO` (label / ingest URL / hint per `Platform`) + `platformInfo()` lookup. |
| `packages/client/src/admin/platforms.test.ts` | Create | Lookups + ingest references. |
| `packages/client/src/admin/maskKey.ts` | Create | `maskKey(streamKey)` → masked display string. |
| `packages/client/src/admin/maskKey.test.ts` | Create | Masking. |
| `packages/client/src/hooks/useRelays.ts` | Modify | Export `relayKey(sourceKey, destinationId)` (replaces the private `keyOf`); internal uses unchanged. |
| `packages/client/src/admin/tabs/DestinationForm.tsx` | Create | Add/edit form (platform→ingest prefill, name, masked key, enabled, priority). |
| `packages/client/src/admin/tabs/DestinationForm.test.tsx` | Create | Prefill + submit add/edit. |
| `packages/client/src/admin/tabs/DestinationsTab.tsx` | Create | Library list (badge/name/masked key/enabled/edit/remove) + per-source binding rows w/ relay StatusTag + the form. |
| `packages/client/src/admin/tabs/DestinationsTab.test.tsx` | Create | List, add, remove, enable, bind, relay status. |
| `packages/client/src/admin/AdminWorkspace.tsx` | Modify | Render `<DestinationsTab/>` instead of the "coming in 3.4" placeholder. |
| `packages/client/src/admin/tabs/SettingsTab.tsx` | Modify | Add the locked Pro watermark toggle section. |
| `packages/client/src/admin/tabs/SettingsTab.test.tsx` | Modify | Assert the Pro toggle is disabled + shows the upsell. |
| `packages/client/src/ui/dark-nt.css` | Modify | Destination row / badge / form classes. |

---

### Task 1: `platforms` ingest reference + `maskKey`

**Files:**
- Create: `packages/client/src/admin/platforms.ts` + `platforms.test.ts`
- Create: `packages/client/src/admin/maskKey.ts` + `maskKey.test.ts`

**Context:** Spec §8 platform ingest reference — selecting a platform auto-prefills its ingest URL and shows a hint. `maskKey` keeps stream keys obscured in the library list.

- [ ] **Step 1: Write the failing tests**

Create `packages/client/src/admin/platforms.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PLATFORM_INFO, platformInfo, PLATFORMS } from './platforms';

describe('platforms', () => {
  it('lists all platform keys', () => {
    expect(PLATFORMS).toEqual(['youtube', 'twitch', 'kick', 'tiktok', 'facebook', 'custom']);
  });
  it('YouTube prefills its ingest URL', () => {
    expect(platformInfo('youtube').ingestUrl).toBe('rtmp://a.rtmp.youtube.com/live2');
  });
  it('Facebook requires RTMPS', () => {
    expect(platformInfo('facebook').ingestUrl).toBe('rtmps://live-api-s.facebook.com:443/rtmp');
  });
  it('custom has no prefilled URL', () => {
    expect(platformInfo('custom').ingestUrl).toBe('');
    expect(platformInfo('custom').label).toBe('Custom');
  });
  it('every platform has a label + hint', () => {
    for (const p of PLATFORMS) {
      expect(PLATFORM_INFO[p].label.length).toBeGreaterThan(0);
      expect(typeof PLATFORM_INFO[p].hint).toBe('string');
    }
  });
});
```

Create `packages/client/src/admin/maskKey.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { maskKey } from './maskKey';

describe('maskKey', () => {
  it('masks all but the last 4 chars', () => {
    expect(maskKey('abcd1234wxyz')).toBe('••••••••wxyz');
  });
  it('fully masks short keys', () => {
    expect(maskKey('abc')).toBe('•••');
  });
  it('returns empty for empty', () => {
    expect(maskKey('')).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test -w client -- platforms maskKey`
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement**

Create `packages/client/src/admin/platforms.ts`:

```ts
import type { Platform } from '../../../shared';

export interface PlatformInfo {
  label: string;
  /** Prefilled RTMP/RTMPS ingest URL (empty for dashboard-provided platforms). */
  ingestUrl: string;
  hint: string;
}

/** Platform ingest reference (spec §8). RTMP publish = {ingest}/{app}/{streamKey}. */
export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  youtube: { label: 'YouTube', ingestUrl: 'rtmp://a.rtmp.youtube.com/live2', hint: 'Stream key from YouTube Studio → Go Live.' },
  twitch: { label: 'Twitch', ingestUrl: 'rtmp://live.twitch.tv/app', hint: '⚠ 6000 kbps cap. Use a regional ingest for best results.' },
  kick: { label: 'Kick', ingestUrl: '', hint: 'Copy the RTMP ingest URL + key from your Kick dashboard.' },
  tiktok: { label: 'TikTok', ingestUrl: '', hint: 'Access-gated; URL + key from TikTok Live Studio.' },
  facebook: { label: 'Facebook', ingestUrl: 'rtmps://live-api-s.facebook.com:443/rtmp', hint: 'RTMPS required (FFmpeg handles it).' },
  custom: { label: 'Custom', ingestUrl: '', hint: 'Enter your RTMP/RTMPS ingest URL.' },
};

export const PLATFORMS = Object.keys(PLATFORM_INFO) as Platform[];

export function platformInfo(platform: Platform): PlatformInfo {
  return PLATFORM_INFO[platform];
}
```

> Note: `PLATFORMS` order is the insertion order of `PLATFORM_INFO` (youtube, twitch, kick, tiktok, facebook, custom). The test asserts that exact order — keep the object key order matching.

Create `packages/client/src/admin/maskKey.ts`:

```ts
/** Mask a stream key for display: dots for all but the last 4 chars. */
export function maskKey(streamKey: string): string {
  if (!streamKey) return '';
  if (streamKey.length <= 4) return '•'.repeat(streamKey.length);
  return '•'.repeat(streamKey.length - 4) + streamKey.slice(-4);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test -w client -- platforms maskKey`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/platforms.ts packages/client/src/admin/platforms.test.ts packages/client/src/admin/maskKey.ts packages/client/src/admin/maskKey.test.ts
git commit -m "feat(admin): platform ingest reference + maskKey helpers"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: Export `relayKey` from `useRelays`

**Files:**
- Modify: `packages/client/src/hooks/useRelays.ts`

**Context:** `useRelays` keys its Map by `` `${sourceKey}::${destinationId}` `` via a private `keyOf`. The Destinations tab needs to look up a relay's state for a (source, destination) pair using the SAME key. Export it as `relayKey` (single source of the format) and use it internally.

- [ ] **Step 1: Make `keyOf` an exported `relayKey`**

In `packages/client/src/hooks/useRelays.ts`, replace the private:

```ts
const keyOf = (sourceKey: string, destinationId: string) => `${sourceKey}::${destinationId}`;
```

with an exported function and update the two internal call sites (`onStatus` and `onStats`) to call `relayKey(...)`:

```ts
/** The Map key for a relay leg: "sourceKey::destinationId". Exported so UI lookups match. */
export const relayKey = (sourceKey: string, destinationId: string) => `${sourceKey}::${destinationId}`;
```

(Find the two internal `keyOf(` calls and rename them to `relayKey(`.)

- [ ] **Step 2: Run the existing useRelays tests**

Run: `npm run test -w client -- useRelays`
Expected: PASS — all 7 tests still green (the key format is unchanged; the test that asserts `'grid::yt'` still passes).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/hooks/useRelays.ts
git commit -m "refactor(client): export relayKey from useRelays (shared key format for UI lookups)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 3: `DestinationForm` (add / edit)

**Files:**
- Create: `packages/client/src/admin/tabs/DestinationForm.tsx` + `DestinationForm.test.tsx`

**Context:** Add or edit an `RtmpDestination`. Platform select auto-prefills the ingest URL (from `platforms`) when adding; name, stream key, enabled, priority. On submit, calls `onSubmit(dest)` (the parent wires this to `destinationActions.add`/`update`). Generates an `id` for new destinations.

- [ ] **Step 1: Write the failing test**

Create `packages/client/src/admin/tabs/DestinationForm.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { DestinationForm } from './DestinationForm';
import type { RtmpDestination } from '../../../../shared';

afterEach(cleanup);

describe('DestinationForm', () => {
  it('prefills the ingest URL when a platform is chosen, and submits a new destination', () => {
    const onSubmit = vi.fn();
    const { container } = render(<DestinationForm onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(container.querySelector('select[data-field="platform"]')!, { target: { value: 'youtube' } });
    const url = container.querySelector('input[data-field="url"]') as HTMLInputElement;
    expect(url.value).toBe('rtmp://a.rtmp.youtube.com/live2');
    fireEvent.change(container.querySelector('input[data-field="name"]')!, { target: { value: 'My YT' } });
    fireEvent.change(container.querySelector('input[data-field="streamKey"]')!, { target: { value: 'yt-key-123' } });
    fireEvent.click(screen.getByText(/save|add/i));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const dest = onSubmit.mock.calls[0][0] as RtmpDestination;
    expect(dest).toMatchObject({ name: 'My YT', platform: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'yt-key-123', enabled: true });
    expect(typeof dest.id).toBe('string');
    expect(dest.id.length).toBeGreaterThan(0);
  });

  it('edits an existing destination (preserves its id)', () => {
    const existing: RtmpDestination = { id: 'd1', name: 'Old', platform: 'twitch', url: 'rtmp://live.twitch.tv/app', streamKey: 'k', enabled: true };
    const onSubmit = vi.fn();
    const { container } = render(<DestinationForm value={existing} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(container.querySelector('input[data-field="name"]')!, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByText(/save|update/i));
    const dest = onSubmit.mock.calls[0][0] as RtmpDestination;
    expect(dest.id).toBe('d1');
    expect(dest.name).toBe('New Name');
  });

  it('does not submit without a name', () => {
    const onSubmit = vi.fn();
    const { container } = render(<DestinationForm onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(container.querySelector('input[data-field="streamKey"]')!, { target: { value: 'k' } });
    fireEvent.click(screen.getByText(/save|add/i));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w client -- DestinationForm`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/client/src/admin/tabs/DestinationForm.tsx`:

```tsx
import { useState } from 'react';
import type { Platform, RtmpDestination } from '../../../../shared';
import { PLATFORMS, platformInfo } from '../platforms';
import { NTButton } from '../../ui/NTButton';

function newId(): string {
  const c = (globalThis as any).crypto;
  return c?.randomUUID ? c.randomUUID() : `dest-${Date.now()}-${Math.floor(performance.now())}`;
}

/** Add/edit an RTMP destination. `value` = edit mode (id preserved); absent = add mode. */
export function DestinationForm({
  value,
  onSubmit,
  onCancel,
}: {
  value?: RtmpDestination;
  onSubmit: (dest: RtmpDestination) => void;
  onCancel: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>(value?.platform ?? 'youtube');
  const [name, setName] = useState(value?.name ?? '');
  const [url, setUrl] = useState(value?.url ?? platformInfo(value?.platform ?? 'youtube').ingestUrl);
  const [streamKey, setStreamKey] = useState(value?.streamKey ?? '');
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const [priority, setPriority] = useState<string>(value?.priority != null ? String(value.priority) : '');

  const onPlatform = (p: Platform) => {
    setPlatform(p);
    // Prefill the ingest URL when adding (or when the field still holds the old prefill).
    const info = platformInfo(p);
    if (info.ingestUrl) setUrl(info.ingestUrl);
  };

  const submit = () => {
    if (!name.trim()) return; // name required
    const dest: RtmpDestination = {
      id: value?.id ?? newId(),
      name: name.trim(),
      platform,
      url: url.trim(),
      streamKey: streamKey.trim(),
      enabled,
      ...(priority.trim() ? { priority: Number(priority) } : {}),
    };
    onSubmit(dest);
  };

  return (
    <div className="ntd-destform">
      <label>Platform
        <select className="ntd-field" data-field="platform" value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
          {PLATFORMS.map((p) => <option key={p} value={p}>{platformInfo(p).label}</option>)}
        </select>
      </label>
      <div className="ntd-destform__hint">{platformInfo(platform).hint}</div>
      <label>Name
        <input className="ntd-field" data-field="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main YouTube" />
      </label>
      <label>Ingest URL
        <input className="ntd-field" data-field="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtmp://…" />
      </label>
      <label>Stream Key
        <input className="ntd-field" data-field="streamKey" type="password" value={streamKey} onChange={(e) => setStreamKey(e.target.value)} placeholder="paste key" />
      </label>
      <label>Priority (optional)
        <input className="ntd-field" data-field="priority" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="lower = sooner" />
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" data-field="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <NTButton go onClick={submit}>{value ? 'Update' : 'Add'}</NTButton>
        <NTButton onClick={onCancel}>Cancel</NTButton>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w client -- DestinationForm`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/tabs/DestinationForm.tsx packages/client/src/admin/tabs/DestinationForm.test.tsx
git commit -m "feat(admin): DestinationForm (add/edit w/ platform ingest prefill)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: `DestinationsTab` (library + binding + relay status) + mount

**Files:**
- Create: `packages/client/src/admin/tabs/DestinationsTab.tsx` + `DestinationsTab.test.tsx`
- Modify: `packages/client/src/admin/AdminWorkspace.tsx` (render `<DestinationsTab/>`)
- Modify: `packages/client/src/ui/dark-nt.css` (destination/badge/form classes)

**Context:** The tab body. Top: an "Add destination" button → shows `DestinationForm` (add); submitting calls `destinationActions.add`. The **library**: each destination as a row — platform badge, name, `maskKey(streamKey)`, enabled toggle (→ `destinationActions.update` with toggled enabled), Edit (→ form in edit mode → `update`), Remove (→ `destinationActions.remove`). The **binding** section: for each source in `useAdminData().sources`, list its bindable destinations with a checkbox (checked = bound) → `setBinding({sourceKey,destinationId,active:true})` / `removeBinding(sourceKey,destinationId)`, and a `StatusTag` showing the relay state from `relays.get(relayKey(sourceKey, dest.id))?.state ?? 'idle'`.

- [ ] **Step 1: Add CSS**

Append to `packages/client/src/ui/dark-nt.css`:

```css
/* Destinations tab. */
.ntd-destform { display: flex; flex-direction: column; gap: 8px; padding: 8px; background: var(--ntd-face-2); border: 1px solid var(--ntd-sh); margin-bottom: 10px; }
.ntd-destform__hint { color: var(--ntd-text-dim); font-size: 11px; }
.ntd-destrow { display: flex; align-items: center; gap: 8px; justify-content: space-between; padding: 5px 6px; border-top: 1px solid var(--ntd-sh); }
.ntd-badge { font-size: 10px; font-weight: bold; padding: 1px 6px; background: var(--ntd-navy-b); color: #fff; text-transform: uppercase; }
.ntd-destrow__key { font-family: var(--ntd-font-mono); color: var(--ntd-text-dim); }
.ntd-bindgrid { margin-top: 6px; }
.ntd-bindrow { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
```

- [ ] **Step 2: Write the failing test**

Create `packages/client/src/admin/tabs/DestinationsTab.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { AdminDataProvider, type AdminData } from '../AdminDataProvider';
import { DestinationsTab } from './DestinationsTab';
import type { RtmpDestination, DestinationBinding } from '../../../../shared';
import type { RelayEntry } from '../../hooks/useRelays';

const YT: RtmpDestination = { id: 'yt', name: 'My YouTube', platform: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'secretkey99', enabled: true };

function base(over: Partial<AdminData> = {}): AdminData {
  return {
    socketStatus: 'connected', isConnected: true,
    serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 1, rtmpSessions: [], rtmpPublishers: [{ streamKey: 'grid' }] },
    sources: [{ sourceKey: 'grid', isLive: true }],
    relays: new Map<string, RelayEntry>(),
    destinations: [YT],
    bindings: [],
    ffmpeg: { status: { state: 'idle', streamKey: null }, stats: null },
    recordings: { active: [], now: 0, start: async () => {}, stop: () => {}, openDir: () => {} },
    settings: { bitrate: '2500k', setBitrate: () => {}, preset: 'ultrafast', setPreset: () => {}, hwAccel: 'none', setHwAccel: () => {}, detectedEncoder: null },
    destinationActions: { add: vi.fn(async () => {}), update: vi.fn(async () => {}), remove: vi.fn(async () => {}), setBinding: vi.fn(async () => {}), removeBinding: vi.fn(async () => {}), refresh: async () => {} },
    previewOpen: new Set(), setPreviewOpen: () => {}, refreshTelemetry: () => {},
    ...over,
  };
}
const renderTab = (over?: Partial<AdminData>) => {
  const data = base(over);
  return { data, ...render(<AdminDataProvider value={data}><DestinationsTab /></AdminDataProvider>) };
};

afterEach(cleanup);

describe('DestinationsTab', () => {
  it('lists destinations with a masked key and platform badge', () => {
    const { container } = renderTab();
    expect(screen.getByText('My YouTube')).toBeTruthy();
    expect(container.textContent).toContain('YOUTUBE'); // badge
    expect(container.textContent).toContain('••••••');   // masked key (not the raw secret)
    expect(container.textContent).not.toContain('secretkey99');
  });

  it('removes a destination', () => {
    const { data } = renderTab();
    fireEvent.click(screen.getByText(/remove/i));
    expect(data.destinationActions.remove).toHaveBeenCalledWith('yt');
  });

  it('toggles enabled via update', () => {
    const { data } = renderTab();
    const toggle = document.querySelector('input[data-field="dest-enabled-yt"]') as HTMLInputElement;
    fireEvent.click(toggle);
    expect(data.destinationActions.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'yt', enabled: false }));
  });

  it('binds a destination to a source (active) and shows relay status', () => {
    const { data } = renderTab();
    // bind checkbox for (grid, yt)
    const bind = document.querySelector('input[data-field="bind-grid-yt"]') as HTMLInputElement;
    expect(bind.checked).toBe(false);
    fireEvent.click(bind);
    expect(data.destinationActions.setBinding).toHaveBeenCalledWith({ sourceKey: 'grid', destinationId: 'yt', active: true });
  });

  it('shows the live relay StatusTag for a bound+relaying destination', () => {
    const relays = new Map<string, RelayEntry>([['grid::yt', { sourceKey: 'grid', destinationId: 'yt', state: 'live' }]]);
    const { container } = renderTab({ relays, bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true } as DestinationBinding] });
    // the StatusTag tone for 'live'
    expect(container.querySelector('.ntd-tag--live')).toBeTruthy();
  });

  it('unbinds when an active binding is unchecked', () => {
    const { data } = renderTab({ bindings: [{ sourceKey: 'grid', destinationId: 'yt', active: true } as DestinationBinding] });
    const bind = document.querySelector('input[data-field="bind-grid-yt"]') as HTMLInputElement;
    expect(bind.checked).toBe(true);
    fireEvent.click(bind);
    expect(data.destinationActions.removeBinding).toHaveBeenCalledWith('grid', 'yt');
  });

  it('adds a destination via the form', () => {
    const { data } = renderTab();
    fireEvent.click(screen.getByText(/add destination/i)); // open the form
    const c = document.body;
    fireEvent.change(c.querySelector('input[data-field="name"]')!, { target: { value: 'New Dest' } });
    fireEvent.change(c.querySelector('input[data-field="streamKey"]')!, { target: { value: 'k2' } });
    fireEvent.click(screen.getByText(/^add$/i)); // the form's Add button
    expect(data.destinationActions.add).toHaveBeenCalledTimes(1);
    expect(data.destinationActions.add.mock.calls[0][0]).toMatchObject({ name: 'New Dest' });
  });

  it('empty-state when there are no destinations', () => {
    const { container } = renderTab({ destinations: [] });
    expect(container.textContent).toMatch(/no destinations|add your first/i);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test -w client -- DestinationsTab`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement** — Create `packages/client/src/admin/tabs/DestinationsTab.tsx`:

```tsx
import { useState } from 'react';
import type { RtmpDestination } from '../../../../shared';
import { useAdminData } from '../AdminDataProvider';
import { relayKey } from '../../hooks/useRelays';
import { platformInfo } from '../platforms';
import { maskKey } from '../maskKey';
import { NTButton } from '../../ui/NTButton';
import { StatusTag } from '../../ui/StatusTag';
import { DestinationForm } from './DestinationForm';

/** Destinations tab (spec §4/§8): manage the destination library + bind to sources w/ live relay status. */
export function DestinationsTab() {
  const { destinations, bindings, relays, sources, destinationActions } = useAdminData();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RtmpDestination | null>(null);

  const isBound = (sourceKey: string, destId: string) =>
    bindings.some((b) => b.sourceKey === sourceKey && b.destinationId === destId && b.active);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (d: RtmpDestination) => { setEditing(d); setFormOpen(true); };
  const submit = async (dest: RtmpDestination) => {
    if (editing) await destinationActions.update(dest);
    else await destinationActions.add(dest);
    setFormOpen(false); setEditing(null);
  };
  const toggleBind = (sourceKey: string, destId: string, bound: boolean) => {
    if (bound) destinationActions.removeBinding(sourceKey, destId);
    else destinationActions.setBinding({ sourceKey, destinationId: destId, active: true });
  };

  return (
    <div>
      {formOpen ? (
        <DestinationForm value={editing ?? undefined} onSubmit={submit} onCancel={() => { setFormOpen(false); setEditing(null); }} />
      ) : (
        <NTButton go onClick={openAdd}>＋ Add destination</NTButton>
      )}

      {/* Library */}
      <div style={{ marginTop: 10 }}>
        {destinations.length === 0 ? (
          <div style={{ color: 'var(--ntd-text-dim)' }}>No destinations yet — add your first.</div>
        ) : (
          destinations.map((d) => (
            <div key={d.id} className="ntd-destrow">
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                <span className="ntd-badge">{platformInfo(d.platform).label}</span>
                <strong>{d.name}</strong>
                <code className="ntd-destrow__key">{maskKey(d.streamKey)}</code>
              </span>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
                  <input type="checkbox" data-field={`dest-enabled-${d.id}`} checked={d.enabled} onChange={() => destinationActions.update({ ...d, enabled: !d.enabled })} /> on
                </label>
                <NTButton onClick={() => openEdit(d)}>Edit</NTButton>
                <NTButton onClick={() => destinationActions.remove(d.id)}>Remove</NTButton>
              </span>
            </div>
          ))
        )}
      </div>

      {/* Bindings per source */}
      {destinations.length > 0 && sources.length > 0 && (
        <div className="ntd-bindgrid">
          <h4 style={{ margin: '12px 0 4px' }}>Routing</h4>
          {sources.map((s) => (
            <div key={s.sourceKey} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <StatusTag state={s.isLive ? 'live' : 'idle'} label={s.sourceKey} />
              </div>
              {destinations.map((d) => {
                const bound = isBound(s.sourceKey, d.id);
                const relayState = relays.get(relayKey(s.sourceKey, d.id))?.state ?? 'idle';
                return (
                  <div key={d.id} className="ntd-bindrow">
                    <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                      <input type="checkbox" data-field={`bind-${s.sourceKey}-${d.id}`} checked={bound} disabled={!d.enabled} onChange={() => toggleBind(s.sourceKey, d.id, bound)} />
                      {d.name}
                    </label>
                    {bound && <StatusTag state={relayState} label={relayState.toUpperCase()} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w client -- DestinationsTab`
Expected: PASS (8 tests). NOTE: the "adds a destination via the form" test clicks `/add destination/i` (open) then `/^add$/i` (the form's Add). Ensure the open button reads "＋ Add destination" (matches `/add destination/i`) and the form's submit reads "Add" (matches `/^add$/i`). If `screen.getByText` collides, the `data-field` selectors + the distinct button texts disambiguate; adjust the test's getByText to a more specific matcher only if needed (report if so).

- [ ] **Step 6: Mount in AdminWorkspace**

In `packages/client/src/admin/AdminWorkspace.tsx`, add the import:
```ts
import { DestinationsTab } from './tabs/DestinationsTab';
```
Replace the destinations placeholder block:
```tsx
        {active === 'destinations' && (
          <div style={{ color: 'var(--ntd-text-dim)', padding: '12px' }}>
            Destination management — coming in 3.4.
          </div>
        )}
```
with:
```tsx
        {active === 'destinations' && <DestinationsTab />}
```

- [ ] **Step 7: Update the AdminWorkspace test**

In `packages/client/src/admin/AdminWorkspace.test.tsx`, the "Destinations tab is a 3.4 placeholder" test asserted the placeholder text — that's now gone. Replace that test's assertion to confirm the Destinations tab renders the real content instead:
```tsx
  it('Destinations tab renders the destinations panel', () => {
    const { container } = renderWs();
    fireEvent.click(screen.getByText('Destinations'));
    expect(container.textContent).toMatch(/add destination|no destinations/i);
  });
```
(The default `data()` in that test has empty destinations, so the empty-state "No destinations… add your first" + the "＋ Add destination" button render — the regex matches either.)

- [ ] **Step 8: Full suite + build**

Run: `npm run test -w client`
Expected: 0 failures.
Run: `npm run build`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add packages/client/src/admin/tabs/DestinationsTab.tsx packages/client/src/admin/tabs/DestinationsTab.test.tsx packages/client/src/admin/AdminWorkspace.tsx packages/client/src/admin/AdminWorkspace.test.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(admin): DestinationsTab — library CRUD + per-source binding w/ live relay status"
```
(+ `Co-Authored-By` trailer.)

---

### Task 5: Locked Pro watermark toggle in `SettingsTab`

**Files:**
- Modify: `packages/client/src/admin/tabs/SettingsTab.tsx`
- Modify: `packages/client/src/admin/tabs/SettingsTab.test.tsx`

**Context:** Spec §9 — ship the Pro affordance visible-but-disabled with an upsell. It does nothing yet (render deferred to the Pro transcode milestone, per R2); it advertises the upgrade and reserves the `WatermarkConfig` model (already in shared). A disabled checkbox + a "Pro" tag + upsell copy.

- [ ] **Step 1: Add the failing test**

In `packages/client/src/admin/tabs/SettingsTab.test.tsx`, add inside the existing describe:

```tsx
  it('shows a locked (disabled) Pro watermark toggle with an upsell', () => {
    const { container } = render(<AdminDataProvider value={base}><SettingsTab /></AdminDataProvider>);
    const toggle = container.querySelector('input[data-field="pro-watermark"]') as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.disabled).toBe(true);
    expect(container.textContent).toMatch(/pro/i);
    expect(container.textContent).toMatch(/watermark/i);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w client -- SettingsTab`
Expected: FAIL — no `pro-watermark` field yet.

- [ ] **Step 3: Implement**

In `packages/client/src/admin/tabs/SettingsTab.tsx`, add a Pro section at the end of the returned `<div>` (before its closing tag):

```tsx
      <div style={{ marginTop: 12, padding: 8, background: 'var(--ntd-face-2)', border: '1px solid var(--ntd-sh)', opacity: 0.85 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ntd-badge" style={{ background: 'var(--ntd-warn)', color: '#000' }}>PRO</span>
          <strong>Per-destination watermark</strong>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, color: 'var(--ntd-text-dim)' }}>
          <input type="checkbox" data-field="pro-watermark" disabled checked={false} readOnly /> Add a custom logo/text overlay per destination
        </label>
        <div style={{ color: 'var(--ntd-text-dim)', fontSize: 11, marginTop: 4 }}>
          Requires re-encode (decode → overlay → encode). Available in Pro — upgrade to unlock.
        </div>
      </div>
```

(`.ntd-badge` already exists from Task 4's CSS; if Task 4 hasn't landed yet in your execution order, the badge class is in dark-nt.css — ensure Task 4 ran first, or the inline style still renders the "PRO" text regardless of the class.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w client -- SettingsTab`
Expected: PASS (existing tests + the new Pro toggle test).

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/admin/tabs/SettingsTab.tsx packages/client/src/admin/tabs/SettingsTab.test.tsx
git commit -m "feat(admin): locked Pro per-destination watermark toggle (visible+disabled upsell, R2)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 6: Manual eyeball

- [ ] **Step 1: Run the app**

Run: `npm run dev`, open the admin, click the **Destinations** tab.

Expected:
- "＋ Add destination" → form with platform select (choosing YouTube prefills `rtmp://a.rtmp.youtube.com/live2`), name, masked stream-key (password) input, priority, enabled. Add → the destination appears in the library with a platform badge + masked key.
- Edit/Remove/enable-toggle work on library rows.
- **Routing** section: per live source (e.g. `grid`), checking a destination's box binds it — and if the source is live, the relay starts and the row's StatusTag goes connecting→live (the G1 backend). Unchecking stops it. THIS is the in-UI replacement for the devtools seeding — "add a destination, bind it, watch the relay light up."
- **Settings** tab: the locked "PRO — Per-destination watermark" toggle is visible but disabled with the upsell copy.

Refine spacing/polish here (small CSS tweaks only).

- [ ] **Step 2:** No commit unless a CSS polish tweak was made (then commit it).

---

## Self-Review

**Spec coverage (§4 Destinations tab, §8 destinations/bindings UX, §9 Pro):**
- Destination library CRUD (add/edit/remove/enable) → DestinationForm (Task 3) + DestinationsTab (Task 4). ✅
- Platform → ingest URL auto-prefill + hint (§8) → platforms (Task 1) + DestinationForm. ✅
- Masked stream key (§8) → maskKey (Task 1) + DestinationsTab rows. ✅
- Binding picker + live relay status (§8/§6) → DestinationsTab routing section + StatusTag + relayKey lookup (Tasks 2, 4). ✅
- Locked Pro watermark toggle (§9) → SettingsTab (Task 5). ✅

**Deferred (NOT gaps):** Live-tab `SourceCard`/`PreviewMonitor` (operate view) + `ClientPortal` + G2-sidebar re-skin → 3.5. The `priority` field is captured but reconnection ordering is backend-global (per the backend notes) — fine. Encryption of the stream key is handled server-side (destinationStore safeStorage); the form just sends plaintext over IPC (same as the devtools path).

**Placeholder scan:** none — concrete code + tests throughout; the binding key uses the exported `relayKey` (Task 2) so the format is single-sourced; visual polish is an explicit eyeball step.

**Type/name consistency:** `RtmpDestination`/`DestinationBinding`/`Platform` from shared; `useAdminData().destinationActions` signatures (`add(dest)`, `update(dest)`, `remove(id)`, `setBinding({sourceKey,destinationId,active})`, `removeBinding(sourceKey,destinationId)`) match Plan 2's `useDestinations` + the AdminData contract exactly. `relayKey(sourceKey, destinationId)` (Task 2) matches the `useRelays` Map key. `platformInfo`/`PLATFORMS`/`maskKey` (Task 1) used by Tasks 3–4. `data-field` attrs give tests stable selectors (`dest-enabled-{id}`, `bind-{src}-{dest}`, `pro-watermark`, form fields).
