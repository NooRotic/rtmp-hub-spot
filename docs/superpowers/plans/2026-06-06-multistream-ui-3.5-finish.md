# Multi-Stream UI — Plan 3.5: glance-able telemetry + dark-NT re-skin finish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the dark-NT re-skin so the whole admin window is cohesive and glance-able — restore the trimmed telemetry density to the tabs, then convert the remaining light G2 sidebar + main-area chrome to dark-NT.

**Architecture:** One testable glance-ability task (re-add FFmpeg frame/size/target, publisher uptime, viewer Mbps to `LiveTab` from data already in `useAdminData`) followed by presentational re-skin tasks (swap the legacy light `.window`/`.btn`/`.inset-field`/inline-`#808080` chrome on the sidebar G2 sections + the main-area window for the dark-NT `.ntd-*` primitives, all under a `.ntd` scope). `GridView`/`VideoFeed` internals (the delicate MediaRecorder→FFmpeg pipe) are NOT touched — only their surrounding admin chrome. Re-skin tasks are validated by the suite staying green (behavior unchanged) + an eyeball.

**Tech Stack:** React 18 + TS, Vitest + jsdom, the 3.1 `ui/` primitives + `dark-nt.css`, the 3.2 provider.

**Source of truth:** spec §3 (dark-NT visual language), §4 (IA), §6 (at-a-glance type / semantic color). The dropped-telemetry list is in the 3.3 holistic-review note (session memory).

**This is Plan 3.5 of 5 — the finale of the admin re-skin.** Deferred (optional follow-up, not blocking merge): `ClientPortal` extraction (slimming App's browser-participant branch) + re-skinning the client/lobby view — the client surface is separate from the admin window this arc targets. Noted at the end.

**Visual-work note:** Task 1 is TDD (real data). Tasks 2–3 are presentational conversions — concrete class-mapping guidance + "suite stays green + eyeball"; exact spacing refined live.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/client/src/admin/tabs/LiveTab.tsx` | Modify | Re-add FFmpeg frame/size/target, publisher uptime, viewer Mbps (glance-ability). |
| `packages/client/src/admin/tabs/LiveTab.test.tsx` | Modify | Assert the restored telemetry renders. |
| `packages/client/src/App.tsx` | Modify | Re-skin the G2 sidebar sections + main-area window chrome to dark-NT; tidy the Active RTMP Links slug label. |
| `packages/client/src/ui/dark-nt.css` | Modify | Any sidebar/main-area chrome classes needed for the re-skin. |

**Unchanged on purpose:** `GridView`/`VideoFeed` component internals (the pipe), the AdminWorkspace tabs (already dark-NT), the provider/hooks, the client/lobby branch.

---

### Task 1: Glance-able telemetry density in `LiveTab`

**Files:**
- Modify: `packages/client/src/admin/tabs/LiveTab.tsx`
- Modify: `packages/client/src/admin/tabs/LiveTab.test.tsx`

**Context:** Plan 3.3 trimmed display-only telemetry. Restore it for at-a-glance reading (spec §6) — all from data already in `useAdminData`: `ffmpeg.stats` has `frame`/`size`; `ffmpeg.status.streamKey` is the target; `serverStatus.rtmpPublishers[].uptime`; `serverStatus.rtmpSessions[].bitrate` (Mbps) + `.uptime`.

- [ ] **Step 1: Update the test** — In `packages/client/src/admin/tabs/LiveTab.test.tsx`, the `base` fixture already has `ffmpeg.stats` (frame 90, size '1MB') + a publisher `{streamKey:'grid'}`. Extend the fixture's publisher to include uptime and add an rtmpSessions row with bitrate+uptime, then add assertions. Specifically:
  (a) change the `serverStatus` in `base` to include a session and publisher uptime:
```ts
  serverStatus: { local: '10.0.0.5', clientCount: 1, rtmpCount: 1, rtmpSessions: [{ id: 'v1', ip: '10.0.0.9', path: '/live/grid', uptime: 42, bitrate: 3_500_000 }], rtmpPublishers: [{ streamKey: 'grid', uptime: 75 }] },
```
  (b) add these tests inside the describe:
```tsx
  it('shows FFmpeg frame + size + target in the health line when running', () => {
    const { container } = render_();
    expect(container.textContent).toContain('90');     // frame
    expect(container.textContent).toContain('1MB');    // size
    expect(container.textContent).toContain('grid');   // target streamKey
  });

  it('shows publisher uptime', () => {
    const { container } = render_();
    expect(container.textContent).toContain('75s');
  });

  it('shows a viewer row with IP and a Mbps figure', () => {
    const { container } = render_();
    expect(container.textContent).toContain('10.0.0.9');
    expect(container.textContent).toMatch(/3\.3\d* Mbps|3\.34|Mbps/i); // 3_500_000 / 1024 / 1024 ≈ 3.34
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w client -- LiveTab`
Expected: FAIL — the new telemetry isn't rendered yet.

- [ ] **Step 3: Implement** — In `packages/client/src/admin/tabs/LiveTab.tsx`:

(a) FFmpeg health stats line — replace the running-stats `<code>`:
```tsx
          <code style={{ color: 'var(--ntd-text-dim)' }}>
            {ffmpeg.stats.fps}fps · {ffmpeg.stats.bitrate} · {ffmpeg.stats.speed}x · {ffmpeg.stats.time}
          </code>
```
with one that adds frame, size, and the target streamKey:
```tsx
          <code style={{ color: 'var(--ntd-text-dim)' }}>
            {ffmpeg.stats.fps}fps · {ffmpeg.stats.bitrate} · {ffmpeg.stats.speed}x · frame {ffmpeg.stats.frame} · {ffmpeg.stats.size} · {ffmpeg.stats.time} · → {ffmpeg.status.streamKey}
          </code>
```

(b) Live Publishers row — the publisher `<code>{p.streamKey}</code>` becomes streamKey + uptime:
```tsx
                <code style={{ fontWeight: 'bold' }}>{p.streamKey}</code>
                <span style={{ color: 'var(--ntd-text-dim)', fontSize: 11 }}>{p.uptime ?? 0}s</span>
```
(place the uptime span right after the streamKey code, inside the row's left group.)

(c) RTMP Viewers table — add a Mbps column. Change the header row:
```tsx
            <thead><tr><th style={{ textAlign: 'left' }}>IP</th><th style={{ textAlign: 'left' }}>Path</th><th style={{ textAlign: 'left' }}>Mbps</th><th style={{ textAlign: 'left' }}>Uptime</th></tr></thead>
```
and the body row:
```tsx
              {sessions.map((s, i) => (
                <tr key={s.id ?? i}><td>{s.ip ?? 'Unknown'}</td><td>{s.path ?? 'Unknown'}</td><td>{((s.bitrate ?? 0) / 1024 / 1024).toFixed(2)}</td><td>{s.uptime ?? 0}s</td></tr>
              ))}
```
(`/1024/1024` matches the legacy Mbps formula; tunable at eyeball.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w client -- LiveTab`
Expected: PASS (existing + the 3 new telemetry tests).

- [ ] **Step 5: Full suite + build**

Run: `npm run test -w client`
Expected: 0 failures.
Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/admin/tabs/LiveTab.tsx packages/client/src/admin/tabs/LiveTab.test.tsx
git commit -m "feat(admin): restore glance-able telemetry in LiveTab (frame/size/target, uptime, Mbps)"
```
End the commit body with a real newline then:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 2: Dark-NT re-skin the G2 sidebar

**Files:**
- Modify: `packages/client/src/App.tsx` (the sidebar G2 sections)
- Modify: `packages/client/src/ui/dark-nt.css` (if helper classes needed)

**Context:** The admin sidebar (`<div className="side-panel">…`) still renders its G2 sections in the legacy LIGHT theme (`.window`, `.btn`, `.inset-field`, inline `#808080`/`#fff` colors), which clashes with the dark `<AdminWorkspace/>` + `ServerStatusBar` already in it. Convert these sidebar sections to dark-NT — **chrome/colors only, all handlers + logic unchanged**: System Status (header), Connected Clients & Feeds (peer/feed list), Grid Controls (checkboxes), Add RTMP Feed (inputs + CONNECT EXT FEED button), Active RTMP Links (the per-peer RTMP URL list + COPY). Also **tidy the Active RTMP Links label** to use the slugified stream key (matches the publishers' clean key) — reuse `slugifyStreamKey`/`feedKey` from `packages/client/src/utils/streamKey.ts` if the label is derived from a peer name.

This is a presentational conversion validated by the suite staying green + an eyeball.

- [ ] **Step 1: Read the sidebar JSX**

Read `packages/client/src/App.tsx` from the `<div className="side-panel">` (around line 410) through the `<AdminWorkspace />` line (~598). Identify the 5 G2 sections (System Status, Connected Clients & Feeds, Grid Controls, Add RTMP Feed, Active RTMP Links) and every light-theme class / inline light color they use. Also read `packages/client/src/utils/streamKey.ts` to see the exported slugify helpers.

- [ ] **Step 2: Scope the sidebar to `.ntd` and convert chrome**

Add `ntd` to the side-panel's className so the dark tokens resolve for its subtree:
```tsx
<div className="side-panel ntd" style={{ width: `${sidebarWidth}px`, display: 'flex', flexDirection: 'column' }}>
```
Then, within the 5 G2 sections, convert chrome to dark-NT:
- Section `<h3>` headers: replace the inline `borderBottom: '1px solid #808080'` with `borderBottom: '1px solid var(--ntd-sh)'` and ensure text uses the dark text color (the `.ntd` scope sets `color: var(--ntd-text)`, so inheriting is fine; remove any hardcoded dark-on-light colors).
- Buttons: replace `className="btn"` with `className="ntd-btn"` (and `ntd-btn--go` for primary actions like CONNECT EXT FEED / COPY).
- Inputs / inset fields: replace `className="inset-field"` with `className="ntd-field"`.
- Any inline light backgrounds (`#fff`, `#ffffe1` help boxes, `#f0f0f0`) → dark equivalents (`var(--ntd-field)` / `var(--ntd-face-2)`); light text colors → `var(--ntd-text)` / `var(--ntd-text-dim)`.
- Add `.side-panel.ntd { background: var(--ntd-face); color: var(--ntd-text); }` to dark-nt.css if the legacy `.side-panel` light background shows through (the legacy `.side-panel` is in index.css with a light bg — the `.ntd` scope's background applies, but if specificity favors `.side-panel`, add the override rule).

Keep ALL onClick/onChange/value/checked handlers and the section structure EXACTLY as-is — only classes/colors change.

- [ ] **Step 3: Tidy the Active RTMP Links label**

In the Active RTMP Links section, where the per-peer RTMP URL label is built from a peer name (the non-slugified `feed-mobile-rotic---camera-2,-fa…` form), use the slugify helper from `utils/streamKey.ts` so the displayed key matches the clean publisher key (`feed-mobile-rotic-camera-2-facing-back`). (Read the section to find how the label/URL is constructed; apply the same `feedKey`/`slugifyStreamKey` used elsewhere.)

- [ ] **Step 4: Verify (suite green — behavior unchanged)**

Run: `npm run test -w client`
Expected: 0 failures. (`App.test.tsx` renders App; class swaps don't change its assertions unless one targeted a light class — if so, update that assertion minimally + report.)

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Eyeball**

Run: `npm run dev`. The sidebar's G2 sections should now be dark-NT, cohesive with the AdminWorkspace + ServerStatusBar. Verify the controls still work (grid toggles, add feed, copy link) and the RTMP Links label is clean. Refine spacing/contrast here (small CSS tweaks only).

- [ ] **Step 6: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(ui): dark-NT re-skin the G2 sidebar (clients/grid/feed/links) + tidy RTMP link label"
```
(+ `Co-Authored-By` trailer.)

---

### Task 3: Dark-NT re-skin the main-area window chrome

**Files:**
- Modify: `packages/client/src/App.tsx` (the main-area `<div className="window">` + controls)
- Modify: `packages/client/src/ui/dark-nt.css` (if needed)

**Context:** The main area (`<div className="window">` ~line 608, "Admin Video Hub") + its control buttons (camera/grid/share, device selects) are still light-theme. Convert the **window chrome + controls** to dark-NT, leaving `GridView`/`VideoFeed` component internals untouched (they render their own canvas/video — do NOT modify those components). Chrome/colors only; all handlers unchanged.

- [ ] **Step 1: Read the main-area JSX**

Read `packages/client/src/App.tsx` from `<div className="window">` (~608) through the GridView/VideoFeed/ChatBox (~730). Identify the window-title, the control buttons (`className="btn"`), the device `<select>`s, and any inline light colors.

- [ ] **Step 2: Convert chrome to dark-NT**

- Wrap the main-area window in the `ntd` scope (add `ntd` to its className, or wrap the main content area): e.g. `<div className="window ntd">` (so dark tokens resolve), or use `<NTWindow>`-style classes. Simplest: add `ntd` to the existing `<div className="window">` → `<div className="window ntd">` and add `.window.ntd { background: var(--ntd-face); color: var(--ntd-text); }` + ensure `.window-title.ntd`/child styling reads dark (the navy title already works on dark).
- Buttons `className="btn"` → `ntd-btn` (primary actions → `ntd-btn--go`; STOP/destructive could use a red-tinted variant — add `.ntd-btn--stop` if desired, or leave beveled).
- Device `<select className="inset-field">` → `ntd-field`.
- Inline light colors → dark-NT vars.
- Do NOT touch `<GridView .../>` or `<VideoFeed .../>` props or the components themselves; only the surrounding window/control chrome.

- [ ] **Step 3: Verify + eyeball**

Run: `npm run test -w client` → 0 failures. `npm run build` → clean.
Run: `npm run dev` → the main area (Admin Video Hub + controls) is dark-NT cohesive; camera/grid/share buttons + device selects still work; the video tiles + grid still render (their internals unchanged). Refine spacing/contrast (small CSS only).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/App.tsx packages/client/src/ui/dark-nt.css
git commit -m "feat(ui): dark-NT re-skin the main-area window chrome (controls + selects)"
```
(+ `Co-Authored-By` trailer.)

---

### Task 4: Final eyeball + arc wrap

- [ ] **Step 1:** `npm run dev` — the ENTIRE admin window should now be cohesively dark-NT (status strip + Join URL + sidebar + AdminWorkspace tabs + main area), glance-able, with semantic status color throughout. Verify a full live flow: start grid broadcast, add+bind a destination (relay lights up), check the tabs' telemetry density reads at a glance, recordings/settings work.
- [ ] **Step 2:** If the look is good, the admin re-skin arc (Plans 3.1–3.5) is complete and the branch is ready to merge to `main` (via `superpowers:finishing-a-development-branch`). If small CSS polish is wanted, do it + commit.

---

## Self-Review

**Spec coverage (§3/§4/§6 — visual finish):**
- At-a-glance telemetry density (§6) → Task 1 (LiveTab frame/size/target, uptime, Mbps). ✅
- Dark-NT visual language across the whole admin window (§3) → Tasks 2 (sidebar) + 3 (main area); status strip/tabs already dark from 3.2/3.3. ✅
- Clear naming / tidy label (§6) → Task 2 slug-label tidy. ✅

**Deferred (optional, documented, not blocking merge):** `ClientPortal` extraction + re-skinning the client/lobby (browser-participant) view — a separate surface from the admin window this arc targets. Can be a 3.6 if desired.

**Placeholder scan:** Task 1 is concrete + TDD. Tasks 2–3 are presentational conversions that (correctly) instruct reading the current JSX before swapping classes — the change is "light class → dark-NT class + light color → dark var," validated by suite-green + eyeball, which is the right granularity for a visual re-skin (pixel spacing is not pre-specifiable).

**Type/name consistency:** Task 1 reads `ffmpeg.stats.frame/size`, `ffmpeg.status.streamKey`, `serverStatus.rtmpPublishers[].uptime`, `serverStatus.rtmpSessions[].bitrate/uptime` — all fields present on the `AdminData`/`AdminServerStatus` contract (Plan 3.2). The dark-NT classes (`.ntd-btn`, `.ntd-field`, `.ntd-btn--go`, `var(--ntd-*)`) are the 3.1 primitives. The slug helper is the existing `utils/streamKey.ts`.
