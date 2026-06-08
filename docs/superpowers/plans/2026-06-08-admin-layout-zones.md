# Zone-based admin layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin scroll-sidebar + AdminWorkspace tabs with a five-zone layout — top bar, stage, persistent Broadcast Console (sources+outputs with health), and two drawers (chat, settings) — by building new container components that consume the existing `useAdminData`, then relocating rendering.

**Architecture:** PRESENTATION-ONLY restructure. The provider/hooks/data layer (`useAdminData`, `useWebRTC`, `useDestinations`, `useRelays`, `useRecordings`, `useFfmpegPipeline`, `useRoomPin`, etc.) is unchanged; new dark-NT container components (`AdminTopBar`, `SettingsDrawer`, `ChatDrawer`, `BroadcastConsole`, `StageTileControls`) read the same data and re-arrange where it renders. `AdminApp` becomes a thin zone arranger. `GridView`/`VideoFeed` pipe internals are NOT touched. Phased so the UI stays usable + the suite stays green between phases.

**Tech Stack:** React 18 + TS, Vitest + jsdom, the `ui/` dark-NT primitives + `dark-nt.css`, the `admin/` provider.

**Source of truth:** `docs/superpowers/specs/2026-06-08-admin-layout-zones-design.md`. Branch `feat/admin-layout-zones`.

**Conventions:** `npm run test -w client` (NOT npx; check the EXIT CODE, not just the "passed" line). Dark-NT primitives: `NTButton`/`StatusTag`/`StatusDot`/`CopyRouteField`/`NTWindow` in `ui/`. New containers consume `useAdminData()` and are tested with `<AdminDataProvider value={stub}>` (mirror the existing tab tests' `base` fixture). Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Reuse `RtmpPlayerTile` for previews.

**Strategy note:** Build the new zones ALONGSIDE the existing layout first (Tasks 1–6 create components + tests without ripping out the old UI), then the final task (7) swaps `AdminApp`'s render to the zones and deletes the old sidebar/AdminWorkspace. This keeps every intermediate commit green + the app usable.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/ui/NTDrawer.tsx` | Create | Generic dark-NT slide-in drawer (open state + title + children + close). |
| `packages/client/src/admin/AdminTopBar.tsx` | Create | The global top bar = ServerStatusBar content + action cluster (＋Feed/⚙/📁/💬badge/🔒) + toggle callbacks. |
| `packages/client/src/admin/drawers/SettingsDrawer.tsx` | Create | ⚙ drawer: broadcast quality + Room PIN + grid options + Pro + System Status. |
| `packages/client/src/admin/drawers/ChatDrawer.tsx` | Create | 💬 drawer wrapping ChatBox; default-open + persisted collapse. |
| `packages/client/src/admin/hooks/useChatUnread.ts` | Create | Unread-count tracking (last-seen vs `chatMessages`) + open/persist state. |
| `packages/client/src/admin/console/BroadcastConsole.tsx` | Create | The persistent dock: SOURCES lane + OUTPUTS lane + FFmpeg chip. |
| `packages/client/src/admin/console/ConsoleSourceRow.tsx` | Create | One source line: health dot + route + 📋copy + viewers + ▸expand (preview/REC). |
| `packages/client/src/admin/console/deriveConsoleSources.ts` | Create | Pure: build source rows from `serverStatus` (publishers ⋈ viewers). |
| `packages/client/src/admin/stage/StageTileControls.tsx` | Create | Per-tile ★spotlight / ✕kick(host-only) / 🔇mute overlay. |
| `packages/client/src/AdminApp.tsx` | Modify | (T7) render the zones; remove old sidebar + AdminWorkspace; drawer/console state. |
| `packages/client/src/ui/dark-nt.css` | Modify | Drawer + top-bar-actions + console + stage-tile classes. |

**Reused as-is (data):** all hooks + `AdminDataProvider`/`useAdminData`. **Reused (UI):** `NTButton`, `StatusTag`, `StatusDot`, `CopyRouteField`, `RtmpPlayerTile`, `ChatBox`, `GridView`, `VideoFeed`, `SettingsTab`'s controls (lifted into the drawer). **Dissolved (T7):** `AdminWorkspace`, the old sidebar JSX in AdminApp.

---

### Task 1: `NTDrawer` primitive + `AdminTopBar`

**Files:**
- Create: `packages/client/src/ui/NTDrawer.tsx` + `NTDrawer.test.tsx`
- Create: `packages/client/src/admin/AdminTopBar.tsx` + `AdminTopBar.test.tsx`
- Modify: `packages/client/src/ui/dark-nt.css`

**Context:** A reusable dark-NT slide-in drawer (used by Settings + Chat), and the top bar that hosts the global status + the action cluster with toggle callbacks. Built standalone (not yet wired into AdminApp).

- [ ] **Step 1: CSS** — Append to `dark-nt.css`:
```css
/* Slide-in drawer. */
.ntd-drawer { position: fixed; top: 0; right: 0; height: 100vh; width: 340px; max-width: 90vw; background: var(--ntd-face); border-left: 2px solid var(--ntd-sh); box-shadow: -4px 0 16px rgba(0,0,0,.5); display: flex; flex-direction: column; z-index: 50; transform: translateX(0); }
.ntd-drawer__head { display: flex; align-items: center; justify-content: space-between; background: var(--ntd-navy-b); color: #fff; padding: 4px 8px; font-weight: bold; }
.ntd-drawer__body { flex: 1; overflow-y: auto; padding: 8px; }
.ntd-topbar__actions { display: flex; gap: 6px; align-items: center; }
.ntd-topbar__btn { position: relative; }
.ntd-topbar__badge { position: absolute; top: -4px; right: -4px; background: var(--ntd-error); color: #fff; font-size: 9px; min-width: 14px; height: 14px; border-radius: 7px; display: flex; align-items: center; justify-content: center; padding: 0 3px; }
```

- [ ] **Step 2: Failing test for NTDrawer** — Create `ui/NTDrawer.test.tsx`:
```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { NTDrawer } from './NTDrawer';

afterEach(cleanup);
describe('NTDrawer', () => {
  it('renders title + children when open and fires onClose', () => {
    const onClose = vi.fn();
    render(<NTDrawer open title="Settings" onClose={onClose}><p>inside</p></NTDrawer>);
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('inside')).toBeTruthy();
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('renders nothing when closed', () => {
    const { container } = render(<NTDrawer open={false} title="X" onClose={() => {}}><p>inside</p></NTDrawer>);
    expect(container.querySelector('.ntd-drawer')).toBeNull();
  });
});
```
Run `npm run test -w client -- NTDrawer` → FAIL.

- [ ] **Step 3: Implement NTDrawer** — `ui/NTDrawer.tsx`:
```tsx
import type { ReactNode } from 'react';

export function NTDrawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="ntd ntd-drawer" role="dialog" aria-label={title}>
      <div className="ntd-drawer__head">
        <span>{title}</span>
        <button className="ntd-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="ntd-drawer__body">{children}</div>
    </div>
  );
}
```
Run `npm run test -w client -- NTDrawer` → PASS.

- [ ] **Step 4: Failing test for AdminTopBar** — Create `admin/AdminTopBar.test.tsx`. Reuse the `AdminData` stub pattern from `admin/ServerStatusBar.test.tsx` (copy its `base`/`renderBar` helper incl. `roomAccess`). Test:
```tsx
  it('shows the Join URL + fires the action toggles', () => {
    const onSettings = vi.fn(), onChat = vi.fn();
    const { container } = renderBar({ onSettings, onChat }); // helper renders <AdminTopBar onSettings onChat onRecordings onAddFeed/>
    expect(container.textContent).toMatch(/join/i);
    fireEvent.click(screen.getByTitle(/settings/i)); expect(onSettings).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/chat/i)); expect(onChat).toHaveBeenCalled();
  });
  it('shows a chat unread badge when unreadCount > 0', () => {
    const { container } = renderBar({ chatUnread: 3 });
    expect(container.querySelector('.ntd-topbar__badge')?.textContent).toBe('3');
  });
```
(Write `renderBar` to render `<AdminDataProvider value={stub}><AdminTopBar onSettings onChat onRecordings onAddFeed chatUnread={n}/></AdminDataProvider>`.)
Run → FAIL.

- [ ] **Step 5: Implement AdminTopBar** — `admin/AdminTopBar.tsx`. Start from the CURRENT `ServerStatusBar.tsx` content (read it — signaling dot, IP, Join URL via `clientJoinUrl`, the rollup, the 🔒 glyph). Add a right action cluster:
```tsx
import { useAdminData } from './AdminDataProvider';
import { clientJoinUrl } from './clientUrl';
import { serverRollup } from './serverRollup';   // confirm existing import in ServerStatusBar
import { NTButton } from '../ui/NTButton';
import { StatusDot } from '../ui/StatusDot';      // confirm props

export function AdminTopBar({ onSettings, onChat, onRecordings, onAddFeed, chatUnread = 0 }:
  { onSettings: () => void; onChat: () => void; onRecordings: () => void; onAddFeed: () => void; chatUnread?: number }) {
  const { /* destructure exactly what ServerStatusBar uses: socketStatus, serverStatus, sources, relays, roomAccess */ } = useAdminData();
  // …reproduce ServerStatusBar's left content (dot, IP, Join URL, rollup, 🔒)…
  return (
    <div className="ntd ntd-statusbar">
      {/* left: existing ServerStatusBar content verbatim */}
      <div className="ntd-topbar__actions">
        <NTButton onClick={onAddFeed} title="Add RTMP feed">＋ Feed</NTButton>
        <NTButton onClick={onRecordings} title="Recordings">📁</NTButton>
        <span className="ntd-topbar__btn">
          <NTButton onClick={onChat} title="Chat">💬</NTButton>
          {chatUnread > 0 && <span className="ntd-topbar__badge">{chatUnread}</span>}
        </span>
        <NTButton onClick={onSettings} title="Settings">⚙</NTButton>
        {/* keep the 🔒/🔓 room-lock glyph from ServerStatusBar in the left content */}
      </div>
    </div>
  );
}
```
READ `ServerStatusBar.tsx` and reproduce its left content EXACTLY (clientJoinUrl, rollup, lock glyph) so nothing regresses. Run `npm run test -w client -- AdminTopBar` → PASS. (Do NOT delete ServerStatusBar yet — T7 swaps it.)

- [ ] **Step 6: Suite + build + commit**
`npm run test -w client` (EXIT 0); `npm run build` (EXIT 0).
```bash
git add packages/client/src/ui/NTDrawer.tsx packages/client/src/ui/NTDrawer.test.tsx packages/client/src/admin/AdminTopBar.tsx packages/client/src/admin/AdminTopBar.test.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(admin): NTDrawer primitive + AdminTopBar (status + action cluster)"
```

---

### Task 2: `SettingsDrawer`

**Files:**
- Create: `packages/client/src/admin/drawers/SettingsDrawer.tsx` + `SettingsDrawer.test.tsx`

**Context:** Gather the low-frequency config into the ⚙ drawer: the existing `SettingsTab` content (broadcast quality + Pro toggle + Room Access), plus grid options (include-admin / auto-layout / watermark / burn-in) and System Status. To avoid prop-drilling grid options now, Phase 2 includes only what `useAdminData` already exposes (settings, roomAccess); grid options + system status are passed as props from AdminApp in T7 (they're local AdminApp state). For now, SettingsDrawer renders the `useAdminData`-backed config and accepts an optional `extra` slot for the grid-options block wired in T7.

- [ ] **Step 1: Failing test** — `admin/drawers/SettingsDrawer.test.tsx` (reuse SettingsTab.test's stub incl. `settings`, `roomAccess`):
```tsx
  it('renders broadcast settings + room access inside the drawer when open', () => {
    const { container } = render(<AdminDataProvider value={base}><SettingsDrawer open onClose={() => {}} /></AdminDataProvider>);
    expect(container.textContent).toMatch(/bitrate/i);
    expect(container.textContent).toMatch(/room access|room pin/i);
  });
  it('renders nothing when closed', () => {
    const { container } = render(<AdminDataProvider value={base}><SettingsDrawer open={false} onClose={() => {}} /></AdminDataProvider>);
    expect(container.querySelector('.ntd-drawer')).toBeNull();
  });
```
Run → FAIL.

- [ ] **Step 2: Implement** — `SettingsDrawer.tsx` wraps the existing `SettingsTab` in an `NTDrawer`:
```tsx
import { NTDrawer } from '../../ui/NTDrawer';
import { SettingsTab } from '../tabs/SettingsTab';
import type { ReactNode } from 'react';

export function SettingsDrawer({ open, onClose, extra }: { open: boolean; onClose: () => void; extra?: ReactNode }) {
  return (
    <NTDrawer open={open} title="Settings" onClose={onClose}>
      <SettingsTab />
      {extra}
    </NTDrawer>
  );
}
```
(`SettingsTab` already renders broadcast quality + Pro + Room Access from `useAdminData`. The `extra` slot is where AdminApp will inject grid options + System Status in T7 — they're AdminApp-local state, not in `useAdminData`.)
Run `npm run test -w client -- SettingsDrawer` → PASS.

- [ ] **Step 3: Suite + build + commit**
```bash
git add packages/client/src/admin/drawers/SettingsDrawer.tsx packages/client/src/admin/drawers/SettingsDrawer.test.tsx
git commit -m "feat(admin): SettingsDrawer (broadcast quality + room access in a drawer)"
```

---

### Task 3: `ChatDrawer` + `useChatUnread` (default-open, persisted collapse, unread badge)

**Files:**
- Create: `packages/client/src/admin/hooks/useChatUnread.ts` + `useChatUnread.test.tsx`
- Create: `packages/client/src/admin/drawers/ChatDrawer.tsx` + `ChatDrawer.test.tsx`

**Context:** A hook owning the chat open/closed state (default open, persisted to `hub-chat-open`) + unread count (messages arrived while closed), and a drawer wrapping `ChatBox`.

- [ ] **Step 1: Failing test for the hook** — `admin/hooks/useChatUnread.test.tsx` (use the repo `renderHook` harness):
```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '../../test/testUtils';
import { useChatUnread } from './useChatUnread';

beforeEach(() => localStorage.clear());
afterEach(cleanup);
describe('useChatUnread', () => {
  it('defaults to open with zero unread', () => {
    const { result } = renderHook(({ n }) => useChatUnread(n), { initialProps: { n: 0 } });
    expect(result.current.open).toBe(true);
    expect(result.current.unread).toBe(0);
  });
  it('counts messages that arrive while closed, clears on open', () => {
    const { result, rerender } = renderHook(({ n }) => useChatUnread(n), { initialProps: { n: 2 } });
    act(() => result.current.setOpen(false));     // close (persists)
    rerender({ n: 5 });                            // 3 new messages while closed
    expect(result.current.unread).toBe(3);
    act(() => result.current.setOpen(true));       // open → clears
    expect(result.current.unread).toBe(0);
  });
  it('persists the closed state to localStorage', () => {
    const { result } = renderHook(({ n }) => useChatUnread(n), { initialProps: { n: 0 } });
    act(() => result.current.setOpen(false));
    expect(localStorage.getItem('hub-chat-open')).toBe('false');
  });
});
```
(Match the repo's `renderHook` rerender API — read `useRoomPin.test`/`useRecordings.test` for the exact `renderHook(...)` + `rerender` signature and adapt; if it doesn't take `initialProps`, drive the message count via a module-level mutable + a wrapper.)
Run → FAIL.

- [ ] **Step 2: Implement** — `useChatUnread.ts`:
```tsx
import { useState, useRef, useEffect, useCallback } from 'react';

/** Chat drawer open/unread state. Default open; persists closed to localStorage; counts
 *  messages that arrive while closed. `count` = current chatMessages.length. */
export function useChatUnread(count: number) {
  const [open, setOpenState] = useState<boolean>(() => localStorage.getItem('hub-chat-open') !== 'false');
  const seenRef = useRef<number>(count);              // messages already "seen"
  const [unread, setUnread] = useState(0);

  // when open, everything is seen; while closed, accumulate the delta
  useEffect(() => {
    if (open) { seenRef.current = count; setUnread(0); }
    else setUnread(Math.max(0, count - seenRef.current));
  }, [count, open]);

  const setOpen = useCallback((v: boolean) => {
    setOpenState(v);
    localStorage.setItem('hub-chat-open', v ? 'true' : 'false');
    if (v) { seenRef.current = count; setUnread(0); }
  }, [count]);

  return { open, setOpen, unread };
}
```
Run `npm run test -w client -- useChatUnread` → PASS. (If the test's count-while-closed assertion needs the seenRef captured at close time, verify the effect ordering gives `unread=3` for 2→close→5; adjust the seen baseline to capture at the moment of close.)

- [ ] **Step 3: ChatDrawer test** — `admin/drawers/ChatDrawer.test.tsx`:
```tsx
  it('renders ChatBox inside a drawer when open', () => {
    render(<ChatDrawer open onClose={() => {}} messages={[]} onSendMessage={() => {}} />);
    expect(document.querySelector('input[placeholder="Type message..."]')).toBeTruthy();
  });
  it('renders nothing when closed', () => {
    const { container } = render(<ChatDrawer open={false} onClose={() => {}} messages={[]} onSendMessage={() => {}} />);
    expect(container.querySelector('.ntd-drawer')).toBeNull();
  });
```
Run → FAIL.

- [ ] **Step 4: Implement ChatDrawer** — `ChatDrawer.tsx`:
```tsx
import { NTDrawer } from '../../ui/NTDrawer';
import ChatBox from '../../components/ChatBox';

export function ChatDrawer({ open, onClose, messages, onSendMessage }:
  { open: boolean; onClose: () => void; messages: { senderName: string; message: string; timestamp: number }[]; onSendMessage: (m: string) => void }) {
  return (
    <NTDrawer open={open} title="Global Network Chat" onClose={onClose}>
      <ChatBox messages={messages} onSendMessage={onSendMessage} />
    </NTDrawer>
  );
}
```
Run `npm run test -w client -- ChatDrawer` → PASS.

- [ ] **Step 5: Suite + build + commit**
```bash
git add packages/client/src/admin/hooks/useChatUnread.ts packages/client/src/admin/hooks/useChatUnread.test.tsx packages/client/src/admin/drawers/ChatDrawer.tsx packages/client/src/admin/drawers/ChatDrawer.test.tsx
git commit -m "feat(admin): ChatDrawer + useChatUnread (default-open, persisted collapse, unread badge)"
```

---

### Task 4: `BroadcastConsole` — OUTPUTS lane + FFmpeg chip

**Files:**
- Create: `packages/client/src/admin/console/BroadcastConsole.tsx` + `BroadcastConsole.test.tsx`
- Modify: `packages/client/src/ui/dark-nt.css`

**Context:** The persistent dock. This task builds the shell + the OUTPUTS lane (reusing the binding/relay logic that lives in `DestinationsTab`) + the FFmpeg health chip. The SOURCES lane is Task 5.

- [ ] **Step 1: CSS** — Append:
```css
.ntd-console { background: var(--ntd-face-2); border-top: 2px solid var(--ntd-sh); padding: 6px 8px; display: flex; flex-direction: column; gap: 6px; }
.ntd-console__head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--ntd-text-dim); }
.ntd-console__lane { display: flex; flex-direction: column; gap: 3px; }
.ntd-console__row { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 2px 0; }
```

- [ ] **Step 2: Failing test** — `console/BroadcastConsole.test.tsx` (reuse DestinationsTab.test's stub: `destinations`, `bindings`, `relays`, `sources`, `serverStatus`, `ffmpeg`, `destinationActions`):
```tsx
  it('shows the FFmpeg health chip and the OUTPUTS lane', () => {
    const { container } = render(<AdminDataProvider value={base}><BroadcastConsole /></AdminDataProvider>);
    expect(container.textContent).toMatch(/running|idle/i);     // ffmpeg chip
    expect(container.textContent).toMatch(/outputs/i);
    expect(container.textContent).toMatch(/add destination/i);  // outputs ＋add
  });
```
Run → FAIL.

- [ ] **Step 3: Implement** — `BroadcastConsole.tsx`. Reproduce DestinationsTab's binding/relay rendering in the OUTPUTS lane (or import `DestinationsTab` if its layout suits a horizontal lane — but a dock wants a compact horizontal form, so build a lane that maps `sources × destinations` → `setBinding`/`removeBinding` with `StatusTag` from `relays.get(relayKey(src, dest))`). FFmpeg chip from `ffmpeg.status`/`ffmpeg.stats`:
```tsx
import { useAdminData } from '../AdminDataProvider';
import { relayKey } from '../../hooks/useRelays';
import { StatusTag } from '../../ui/StatusTag';
import { NTButton } from '../../ui/NTButton';
// (full OUTPUTS rendering mirrors DestinationsTab's Routing section; SOURCES lane added in Task 5)
export function BroadcastConsole() {
  const { ffmpeg, sources, destinations, bindings, relays, destinationActions } = useAdminData();
  // …FFmpeg chip + OUTPUTS lane (source→dest bind checkboxes + StatusTag + ＋add)…
  return (
    <div className="ntd ntd-console">
      <div className="ntd-console__head">
        <strong>Broadcast</strong>
        <span>FFmpeg <StatusTag state={ffmpeg.status.state} label={ffmpeg.status.state.toUpperCase()} />{ffmpeg.stats ? ` ${ffmpeg.stats.fps}fps · ${ffmpeg.stats.bitrate}` : ''}</span>
      </div>
      {/* SOURCES lane placeholder — Task 5 */}
      <div className="ntd-console__lane">
        <span className="ntd-console__head">OUTPUTS</span>
        {/* per source → destination bind rows + relay StatusTag + ＋ add destination (reuse DestinationsTab logic) */}
      </div>
    </div>
  );
}
```
IMPLEMENTER: lift the OUTPUTS rendering from `admin/tabs/DestinationsTab.tsx` (the library + per-source binding + relay `StatusTag` via `relayKey`), laid out compactly for the dock. Keep `destinationActions` wiring identical. Run `npm run test -w client -- BroadcastConsole` → PASS.

- [ ] **Step 4: Suite + build + commit**
```bash
git add packages/client/src/admin/console/BroadcastConsole.tsx packages/client/src/admin/console/BroadcastConsole.test.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(admin): BroadcastConsole shell + OUTPUTS lane + FFmpeg chip"
```

---

### Task 5: Console SOURCES lane (`ConsoleSourceRow` + `deriveConsoleSources`)

**Files:**
- Create: `packages/client/src/admin/console/deriveConsoleSources.ts` + `.test.ts`
- Create: `packages/client/src/admin/console/ConsoleSourceRow.tsx` + `.test.tsx`
- Modify: `packages/client/src/admin/console/BroadcastConsole.tsx` (mount the SOURCES lane)

**Context:** Per RTMP source (publisher): health dot + route + 📋copy + viewer count + bitrate + ▸expand (preview/REC). Unifies the old Active RTMP Links + Live Publishers + RTMP Viewers.

- [ ] **Step 1: Pure helper + test** — `deriveConsoleSources.ts`: from `serverStatus` build `{ streamKey, active, viewers, bitrate, health }[]` by joining `rtmpPublishers` (active publishers) with `rtmpSessions` (viewers per path). Test cases: a publisher with N viewers → `{active:true, viewers:N}`; a publisher with a reconnecting/low-bitrate state → `health:'warn'`. Write `deriveConsoleSources.test.ts` with 2-3 cases first (FAIL), then implement.
```ts
export interface ConsoleSource { streamKey: string; active: boolean; viewers: number; bitrate: number; health: 'live' | 'warn' | 'idle'; }
export function deriveConsoleSources(serverStatus: { rtmpPublishers?: { streamKey: string; uptime?: number }[]; rtmpSessions?: { path?: string; bitrate?: number }[] } | null): ConsoleSource[] {
  const pubs = serverStatus?.rtmpPublishers ?? [];
  const sessions = serverStatus?.rtmpSessions ?? [];
  return pubs.map(p => {
    const mine = sessions.filter(s => (s.path || '').includes(p.streamKey));
    const bitrate = mine.reduce((a, s) => a + (s.bitrate ?? 0), 0);
    return { streamKey: p.streamKey, active: true, viewers: mine.length, bitrate, health: 'live' };
  });
}
```
(Adjust the health rule + path-match to the real `rtmpSessions` shape — read `AdminServerStatus` for the exact fields; if `rtmpSessions` lacks a per-key bitrate/path, derive viewers as the session count and health from `active`.)

- [ ] **Step 2: `ConsoleSourceRow` + test** — renders a row: `StatusDot` (health) + `<code>streamKey</code>` + `CopyRouteField` (the rtmp pull route — reuse the existing `CopyRouteField`/`buildRouteUrl`) + `{viewers} viewers` + bitrate + a ▸ button that toggles an inline `RtmpPlayerTile` + REC button (`recordings.start/stop`). Test: renders streamKey + viewers; clicking ▸ shows the preview (mock `RtmpPlayerTile` like LiveTab.test); REC fires `recordings.start`.
- [ ] **Step 3: Mount the SOURCES lane in `BroadcastConsole`** — map `deriveConsoleSources(serverStatus)` → `<ConsoleSourceRow>` above the OUTPUTS lane. Update BroadcastConsole.test to assert a source row renders (extend the stub's `serverStatus.rtmpPublishers`).
- [ ] **Step 4: Suite + build + commit**
```bash
git add packages/client/src/admin/console/deriveConsoleSources.ts packages/client/src/admin/console/deriveConsoleSources.test.ts packages/client/src/admin/console/ConsoleSourceRow.tsx packages/client/src/admin/console/ConsoleSourceRow.test.tsx packages/client/src/admin/console/BroadcastConsole.tsx packages/client/src/admin/console/BroadcastConsole.test.tsx
git commit -m "feat(admin): console SOURCES lane (health + route copy + viewers + expand preview/REC)"
```

---

### Task 6: `StageTileControls` (per-tile spotlight/kick/mute)

**Files:**
- Create: `packages/client/src/admin/stage/StageTileControls.tsx` + `.test.tsx`

**Context:** A small overlay component for a stage tile exposing ★ spotlight, ✕ kick (host-only, `isElectron`), 🔇 mute. AdminApp will render it on each `VideoFeed` tile in T7. Built standalone here (props: the peer id + handlers + isElectron + spotlighted flag).

- [ ] **Step 1: Failing test** — `stage/StageTileControls.test.tsx`:
```tsx
  it('fires spotlight + mute; shows kick only for the host', () => {
    const onSpotlight = vi.fn(), onKick = vi.fn(), onMute = vi.fn();
    const { container, rerender } = render(<StageTileControls peerId="p1" isHost spotlighted={false} onSpotlight={onSpotlight} onKick={onKick} onMute={onMute} />);
    fireEvent.click(screen.getByTitle(/spotlight/i)); expect(onSpotlight).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByTitle(/mute/i)); expect(onMute).toHaveBeenCalledWith('p1');
    expect(screen.queryByTitle(/kick|remove/i)).toBeTruthy();
    rerender(<StageTileControls peerId="p1" isHost={false} spotlighted={false} onSpotlight={onSpotlight} onKick={onKick} onMute={onMute} />);
    expect(screen.queryByTitle(/kick|remove/i)).toBeNull(); // hidden for non-host
  });
```
Run → FAIL.

- [ ] **Step 2: Implement** — `StageTileControls.tsx` (reuse the existing ★ spotlight + ✕ kick button styles from AdminApp's current Connected-Clients block):
```tsx
export function StageTileControls({ peerId, isHost, spotlighted, onSpotlight, onKick, onMute }:
  { peerId: string; isHost: boolean; spotlighted: boolean; onSpotlight: (id: string) => void; onKick: (id: string) => void; onMute: (id: string) => void }) {
  return (
    <div className="ntd-tile-controls" style={{ display: 'flex', gap: 4 }}>
      <button title="Spotlight" onClick={() => onSpotlight(peerId)} style={{ background: spotlighted ? 'var(--ntd-navy-b)' : 'var(--ntd-face-2)', color: '#fff', border: '1px solid var(--ntd-sh)', fontSize: 10 }}>★</button>
      <button title="Mute" onClick={() => onMute(peerId)} style={{ background: 'var(--ntd-face-2)', color: 'var(--ntd-text)', border: '1px solid var(--ntd-sh)', fontSize: 10 }}>🔇</button>
      {isHost && <button title="Remove" onClick={() => onKick(peerId)} style={{ background: '#ff000022', color: 'var(--ntd-error)', border: '1px solid var(--ntd-error)', fontSize: 10 }}>✕</button>}
    </div>
  );
}
```
(Mute may be a no-op handler for now if there's no per-peer server mute — wire `onMute` to whatever exists, or have AdminApp pass a local mute toggle; if no mute exists, drop 🔇 and keep ★/✕ — report.) Run `npm run test -w client -- StageTileControls` → PASS.

- [ ] **Step 3: Suite + build + commit**
```bash
git add packages/client/src/admin/stage/StageTileControls.tsx packages/client/src/admin/stage/StageTileControls.test.tsx
git commit -m "feat(admin): StageTileControls (per-tile spotlight/kick/mute overlay)"
```

---

### Task 7: Arrange the zones in `AdminApp`; dissolve the old sidebar + AdminWorkspace

**Files:**
- Modify: `packages/client/src/AdminApp.tsx`
- Modify: `packages/client/src/AdminApp` tests if any assert old sidebar text
- (Delete usage of) `admin/AdminWorkspace.tsx`, `admin/ServerStatusBar.tsx` (replaced by AdminTopBar) — keep files if other tests import them, else remove

**Context:** The final swap. Render the five zones; remove the old scroll sidebar + `<AdminWorkspace/>` + `<ServerStatusBar/>`. The data hooks/state in AdminApp stay; add drawer/console open-state + wire the new containers.

- [ ] **Step 1: Add zone state + the chat-unread hook** — In `AdminApp`, add: `const [settingsOpen, setSettingsOpen] = useState(false);` `const [recOpen, setRecOpen] = useState(false);` `const [addFeedOpen, setAddFeedOpen] = useState(false);` and `const { open: chatOpen, setOpen: setChatOpen, unread: chatUnread } = useChatUnread(chatMessages.length);`. (chatMessages comes from the existing useWebRTC destructure.)

- [ ] **Step 2: Replace the admin render with the zones** — Replace the `<ServerStatusBar/>` + sidebar (`<div className="side-panel ntd">…</div>` incl. AdminWorkspace + ChatBox) + main-area composition with:
```tsx
<div className="ntd" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
  {isElectron && (/* keep the app-title-bar */)}
  <AdminTopBar
    onSettings={() => setSettingsOpen(true)}
    onRecordings={() => setRecOpen(true)}
    onAddFeed={() => setAddFeedOpen(true)}
    onChat={() => setChatOpen(!chatOpen)}
    chatUnread={chatUnread}
  />
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      {/* STAGE: the existing Admin Video Hub controls + GridView + the userStream/peer VideoFeeds,
          each peer tile wrapped with <StageTileControls .../> using the existing toggleGridMember/
          spotlightId/kickUser handlers. Reproduce the current main-area JSX here, swapping the
          old per-peer kick/spotlight buttons for <StageTileControls>. */}
    </div>
    <BroadcastConsole />
  </div>
  <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} extra={/* grid-options + System Status JSX moved from the old sidebar */} />
  <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} messages={chatMessages} onSendMessage={sendMessage} />
  {/* Recordings drawer: <NTDrawer open={recOpen} title="Recordings"><RecordingsTab/></NTDrawer> */}
  {/* Add-feed dialog: a small NTDrawer/modal with the old Add-RTMP-Feed inputs (newFeedKey/newFeedLabel/addSyntheticFeed) */}
</div>
```
DELETE the old sidebar block (System Status / Connected Clients / Grid Controls / Add Feed / Active RTMP Links / AdminWorkspace / sidebar ChatBox). MOVE: grid-options + System Status → the SettingsDrawer `extra`; Add-feed inputs → the add-feed dialog; Recordings → the Recordings drawer (reuse `RecordingsTab`). The "Active RTMP Links" + Live publishers/viewers are now the console SOURCES lane (delete the old sections). Connected-Clients list → gone (tile controls replace it).

- [ ] **Step 3: Update tests** — `AdminApp` smoke test / `App.test`: if anything asserts old sidebar text ("Connected Clients", "Active RTMP Links", a permanent ChatBox), update to the new reality (top bar + console). If `AdminWorkspace.test`/`ServerStatusBar.test` now test dead components, either delete those files (if the components are removed) or keep the components + tests if still imported elsewhere. Report what you changed.

- [ ] **Step 4: Full suite + build**
`npm run test -w client` (EXIT 0); `npm run build` (EXIT 0). Fix any unused-import/var from the dissolution.

- [ ] **Step 5: Manual eyeball** — `npm run dev`: the admin window is now top bar + stage + Broadcast Console; ⚙/💬/📁/＋ open drawers/dialogs; chat opens by default + the badge works; the console shows source health + route-copy + outputs; tile controls spotlight/kick. No scroll sidebar. Refine spacing/responsive here.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(admin): arrange five zones in AdminApp; remove scroll sidebar + AdminWorkspace"
```

---

## Self-Review

**Spec coverage:** §1 top bar → T1 (AdminTopBar) + T7 (mount). §2 stage + tile controls → T6 + T7. §3 Broadcast Console (sources+outputs+ffmpeg+expand) → T4 (outputs+ffmpeg) + T5 (sources+expand). §4 chat drawer (default-open/persist/unread) → T3. §5 settings drawer → T2 (+ grid-options/system-status via `extra` in T7). Component mapping + dissolution → T7. ✅

**Placeholder scan:** The new container components have concrete skeletons + tests. T4/T5/T7 reference "lift the rendering from DestinationsTab / reproduce the main-area JSX" rather than reprinting hundreds of lines — this is a MOVE of existing, already-tested rendering into new containers, bounded by the behavior tests + the eyeball; that's the correct granularity for a presentation relocation (reprinting the full DestinationsTab/main-area JSX would be worse). Visual spacing/responsive is the documented eyeball step. New logic (useChatUnread, deriveConsoleSources, the drawer/badge) is concrete + TDD'd.

**Type/name consistency:** `NTDrawer({open,title,onClose,children})` used by SettingsDrawer/ChatDrawer/recordings. `useChatUnread(count) → {open,setOpen,unread}` used in T7. `AdminTopBar` props `{onSettings,onChat,onRecordings,onAddFeed,chatUnread}` match T7's wiring. `deriveConsoleSources(serverStatus) → ConsoleSource[]` feeds `ConsoleSourceRow`. All consume the existing `useAdminData` contract (no data-layer change). `localStorage` key `hub-chat-open`. Reuses `relayKey`/`StatusTag`/`CopyRouteField`/`RtmpPlayerTile`/`recordings.*`/`destinationActions.*` exactly as their current owners do.

**Risk note:** T7 is the big swap (delete sidebar, rewire main area). It's de-risked by Tasks 1–6 building + testing every new container first, so T7 is assembly + deletion, verified by suite-green + eyeball. The data layer never changes, so no logic regression surface.
