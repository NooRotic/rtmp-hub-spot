# Plan 003: AdminApp.tsx Refactor — corrected & executable

**Supersedes:** `002-refactor-adminapp-summary.md` (kept for history; do not execute 002 as written).
**Target:** `packages/client/src/AdminApp.tsx` (618 lines).
**Status:** Phase 0 = in progress (this PR). Phases 1–3 = TODO, each its own PR.
**Author note:** every claim below was verified against the code on `main` (node v22.22.3, npm 10.9.8).

---

## 0. Why 002 was rewritten

002 was directionally right (the seams it named are real) but omitted three realities that this plan fixes:

1. **`AdminApp` has ~0% test coverage today** (6.47% lines, **0% functions** — the component is never rendered by any test). 002 names "testability" as the goal but proposes refactoring with no safety net. → **Phase 0 adds one.**
2. **`AdminDataSidecar` (002's Phase 3) would not reduce re-renders.** `AdminDataProvider` is already a pure pass-through (`admin/AdminDataProvider.tsx:70-72`, no hooks, no memo); `AdminApp` is the single subscriber. Relocating the `adminData` assembly changes nothing. The real win is **splitting the context** into stable-actions vs volatile-telemetry. → **Phase 3 is rewritten.**
3. **`gridMembers` is dead/vestigial.** It's written in four places but read only by two checkboxes (`AdminApp.tsx:500`, `:600`) and consumed by nothing downstream (`allStreams` 269-285 and `GridView` props 452-468 never reference it; `GridViewProps` has no member field). 002 would lift-and-shift this dead state into `useAdminState`. → **Phase 1 reckons with it (see Decision Gate D1).**

---

## 1. Baseline gates (all PASS today — never regress these)

Run from `M:\dev\rtmp-hub-spot`:

| Gate | Command | Today |
|---|---|---|
| Build | `npm run build` | ✅ clean (1 benign >500 kB bundle-size warning) |
| Tests | `npm test` | ✅ 290/290 (client 190, server 97, shared 3) |
| Client tests only (fast loop) | `npm run test -w client` | ✅ 45 files / 190 tests, ~170s, 100% reliable |
| Typecheck | `npx tsc -p packages/client --noEmit` | ✅ 0 errors (`strict: true`) |
| Lockfile | `npm ci --dry-run` | ✅ in sync |

Notes that constrain the work:
- **No ESLint** is installed anywhere — the `// eslint-disable-next-line react-hooks/exhaustive-deps` at `AdminApp.tsx:146` is **inert**. Don't rely on lint to catch dep-array mistakes; rely on the tests + `tsc`.
- **No coverage threshold** is configured, so coverage can't gate CI yet (Phase 0 changes this for `AdminApp.tsx`).
- `npm run test:coverage -w client` works but is **flaky on Windows** (v8 temp-file ENOENT race) — re-run on failure; use `npm run test -w client` for the correctness loop.

---

## 2. Test-harness rules (non-negotiable — derived from the existing suite)

These are the reasons a naive smoke test fails. Follow them exactly.

1. **Do NOT import `@testing-library/react`.** It resolves to root `node_modules` (React 19) and crashes against the client's React 18 (dual-instance `useState`). Use the repo's own harness: `import { render, screen, fireEvent, cleanup } from './test/testUtils'`. `@testing-library/jest-dom` matchers (`toBeInTheDocument`, …) ARE active via `src/test/setup.ts`.
2. **`isElectron` is a module-level const** (`hooks/useElectronBridge.ts`), evaluated at **import time** from `navigator.userAgent` (` Electron/` token, leading space required) or `window.process.versions.electron`. To exercise Electron mode you must set the globals **before** importing AdminApp and use a dynamic `await import('./AdminApp')`.
3. **One mode per file.** The Electron-forcing tests (`*.pipe.test.tsx`) mutate `navigator.userAgent` at module top and never restore it; isolation relies on vitest's default multi-fork (one process per file). Put browser-mode and Electron-mode AdminApp smoke tests in **separate files**. Never run coverage with `--pool=forks --singleFork` (breaks 4 existing tests).
4. **Electron mode needs a thenable IPC.** `AdminApp.tsx:94-96` does `ipc.invoke('get-host-token').then(...)`. A bare `vi.fn()` returns `undefined` → `.then` throws → AdminApp unmounts. Use `makeFakeIpc()` from `src/test/fakeIpc.ts` (its `invoke` defaults to `async () => undefined`).
5. **`setup.ts` already stubs** `MediaStream`, `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, `HTMLCanvasElement.prototype.captureStream`, `ResizeObserver`. Do not re-stub. (`matchMedia`, canvas `getContext`, `HTMLMediaElement.play` are NOT stubbed but are tolerated.)
6. **Minimum mocks to render AdminApp:** `useWebRTC` (full shape — copy `App.test.tsx:9-30`), `useMediaDevices` (`{videoDevices:[],audioDevices:[]}`), and `mpegts.js` (`default.getFeatureList()=>({mseLivePlayback:false})` short-circuits the synthetic-feed effect; `default.createPlayer` present for the truthy case). Browser `?role=admin` mode needs the fewest mocks because `ipc` is `null` and the ipc-driven hooks no-op.

---

## Decision Gate D1 — `gridMembers` → **RESOLVED: D1-B (Wire it in)**

The "Include Admin" (`:498-502`) and per-feed "Grid" (`:598-603`) checkboxes toggle `gridMembers`, but nothing reads it to filter the grid — they are **currently no-ops**.

**Decision (made by the owner): D1-B — wire it in.** Those checkboxes were intended to control composite-grid membership; the wiring was lost. Phase 1 restores it as a **deliberate behavior change** (not a refactor): `allStreams` (and the `GridView` `streams` prop) will filter by `gridMembers`, and `gridMembers` is kept and folded into `useGridState`. This requires a new test proving a toggle adds/removes a tile. (Rejected alternative D1-A would have deleted the state + both checkboxes as dead code.)

**Phase 0 interaction:** the Phase 0 browser smoke test asserts the *current* no-op behavior (toggling "Include Admin" does **not** change tile count) to characterize today's state. That single assertion is the one Phase 1 D1-B will **intentionally flip** to assert the new filtering behavior — it is the executable record of the bug being fixed. Every other Phase 0 assertion stays green through Phase 1.

---

## Phase 0 — Characterization safety net (this PR)

**Goal:** lock current `AdminApp` behavior with runnable tests before touching it, and make coverage enforceable for this file.

**Deliverables (new files):**
1. `packages/client/src/AdminApp.smoke.browser.test.tsx` — render in `?role=admin` browser mode; assert the four zones render (TopBar present, "Admin Monitor"/stage, BroadcastConsole, drawers closed→open). Assert toggling the "Include Admin" checkbox does **not** change the rendered grid tiles (characterizes the dead `gridMembers`).
2. `packages/client/src/AdminApp.smoke.electron.test.tsx` — force Electron mode (UA + `window.electron` via `makeFakeIpc()` **before** `await import('./AdminApp')`); assert the Electron-only title bar + broadcast controls (`START ADMIN CAMERA`, `SHARE GRID TO ALL`) render and `get-host-token` is invoked.
3. `packages/client/src/AdminApp.feeds.test.tsx` (stretch) — characterize `addSyntheticFeed`/`removeSyntheticFeed`: adding a feed key shows a `[FETCHING]` row; removing it drops the row. (Drives the Add-Feed drawer inputs via `fireEvent.change`/`click`.)

**Coverage step:** add a per-file coverage floor so this can't silently rot. In `packages/client/vitest.config.ts`:
```ts
test: {
  // …existing…
  coverage: {
    provider: 'v8',
    reporter: ['text', 'clover', 'json-summary'],   // json-summary so CI can read coverage-summary.json
    thresholds: { 'src/AdminApp.tsx': { statements: 81, functions: 53, lines: 81, branches: 78 } },
  },
}
```
**Rule: measure first, then set the floor a few points below what the finalized smoke tests actually achieve — never aspirational.** A render-smoke test legitimately can't hit 100% functions (many are Electron-only inline handlers and effect closures); forcing `functions: 100` makes the coverage command exit 1. Per-file only — no global threshold. Ratchet each floor up as Phases 1–3 add focused tests. (A function floor of 100 was the original mistake here; the smoke tests render the component but exercise ~58% of its inline handlers once the interactive controls are clicked — clicking more is how Phases 1–3 ratchet it up.)

**Status — Phase 0 IMPLEMENTED & verified (✅).** Files added: `AdminApp.smoke.browser.test.tsx`, `AdminApp.smoke.electron.test.tsx`, `AdminApp.feeds.test.tsx`, plus the coverage block in `vitest.config.ts`. Measured result:

| Metric (`AdminApp.tsx`) | Before | After Phase 0 | Floor set |
|---|---|---|---|
| Statements | 6.47% | **86.73%** | 81 |
| Lines | 6.47% | **86.73%** | 81 |
| Branches | 100%* | **83.78%** | 78 |
| Functions | **0%** | **58.62%** | 53 |

(\*pre-existing 100% branch was over one trivially-hit line.) Suite: **202/202 green** (was 190); `npm run test:coverage -w client` exits **0** with the gate enforced; `npx tsc -p packages/client --noEmit` clean. Verified independently (the tests render the real component with bidirectional Electron/browser discrimination, real feed CRUD, and clicks that assert real DOM changes — not hollow asserts).

**Verification gates (Phase 0 exit) — all PASS:**
- `npm run test -w client` green (48 files / 202 tests).
- `npm run test:coverage -w client` exits 0; `AdminApp.tsx` 0%→58.62% funcs / 6.47%→86.73% lines; per-file threshold enforced.
- `npx tsc -p packages/client --noEmit` clean.

**STOP/rollback:** test files are additive — if the harness fights back, delete the files; zero production risk.

**Not yet committed:** the three test files + `vitest.config.ts` change + this `docs/plans/` dir are untracked/modified in git — commit them so the coverage gate persists in CI.

---

## Phase 1 — Extract concern hooks + `useSyntheticFeeds` + wire `gridMembers` (own PR; D1-B)

Order chosen by ascending coupling so each step keeps tests green. **This phase includes the D1-B behavior change** (step 5), so split it into two commits: (a) the pure hook extractions (behavior-preserving, all Phase 0 tests stay green), then (b) the `gridMembers` wiring (which flips the Phase 0 "checkbox no-op" assertion).

1. **`useDrawerState`** (`hooks/useDrawerState.ts`) — owns `settingsOpen/recOpen/addFeedOpen` (`:50-52`); returns booleans + open/close handlers. Zero coupling; safest first move.
2. **`useOverlaySettings`** (`hooks/useOverlaySettings.ts`) — owns `showWatermark/watermarkPos/showSettingsOverlay` (`:113-115`); self-contained.
3. **`useGridState`** (`hooks/useGridState.ts`) — owns `gridAutoLayout/spotlightId/previewOpen/gridStream/isGridShared/showGrid` (`:56,57,58,77,78,76`) **plus `gridMembers` + `addGridMember`/`removeGridMember`/`toggleGridMember`** (kept per D1-B, for the membership filter and the two checkboxes).
4. **`useSyntheticFeeds(serverStatus)`** (`hooks/useSyntheticFeeds.ts`) — owns `syntheticFeeds/newFeedKey/newFeedLabel` (`:118-120`) + `feedPlayersRef` (internal, never returned) + both effects (`:177-224`, `:227-236`). **Must preserve the invariant at `:219-223`** — empty cleanup in the `[syntheticFeeds, serverStatus]` effect; teardown only in the unmount-only effect. Interface:
   ```ts
   function useSyntheticFeeds(args: {
     serverStatus: unknown;                 // effect dep ONLY — never tear down in cleanup
     onFeedLive: (id: string) => void;      // replaces setGridMembers add (:209-213) — feed auto-joins grid on live
     onFeedRemoved: (id: string) => void;   // replaces setGridMembers delete (:260-264)
   }): {
     syntheticFeeds; newFeedKey; setNewFeedKey; newFeedLabel; setNewFeedLabel;
     addSyntheticFeed; removeSyntheticFeed; liveFeeds;
   }
   ```
   The hook never imports grid state directly; AdminApp wires `onFeedLive = addGridMember`, `onFeedRemoved = removeGridMember` from `useGridState`, preserving today's "a feed auto-joins the grid when it goes live" behavior.
5. **Wire `gridMembers` into the grid — the D1-B behavior change (separate commit).** Make `allStreams` (`:269-285`) / the `GridView` `streams` prop honor membership: include a tile for `id` only when it's a member. **Peer semantics must be chosen explicitly** — peers aren't in `gridMembers` today. **Recommended: default-in** (peers show unless excluded), so the "Include Admin" + per-feed "Grid" checkboxes become *subtractive* controls and the current "everyone shows" feel is preserved; the only visible change is that unchecking now actually removes a tile. Document the semantics in `useGridState`.

**Tests added this phase:**
- Unit (alongside each hook): `useDrawerState.test.ts`, `useOverlaySettings.test.ts`, `useGridState.test.ts`, `useSyntheticFeeds.test.ts` via the repo's `renderHook`. The feed-hook test must assert the no-churn invariant: a `serverStatus` change does **not** call the mpegts mock's `destroy` (players survive a status tick).
- Behavior (D1-B): a new test asserting that toggling "Include Admin" / a feed's "Grid" checkbox **adds/removes the corresponding tile** from the rendered grid. **Update the Phase 0 browser smoke test's no-op assertion to the new filtering behavior** in the same commit (this is the deliberate flip).

**Gates:** all baseline gates green; `AdminApp.tsx` line count drops materially; coverage threshold ratcheted up; commit (a) leaves all Phase 0 tests unchanged/green; commit (b) flips exactly the one characterization assertion and adds the filter test.

---

## Phase 2 — Layout extraction (own PR)

Extract the four zones into presentational components driven by props/hooks (not a monolithic `ZoneManager` that re-introduces a god-prop):
- `admin/zones/StageZone.tsx` (`:347-472`), `admin/zones/ConsoleZone.tsx` (`:474-487`), and the drawers (`:489-612`) into `admin/zones/AdminDrawers.tsx`.
- AdminApp becomes orchestration: hooks + `<AdminTopBar/> <StageZone/> <ConsoleZone/> <AdminDrawers/>`.

**Tests:** each zone gets a focused render test (props in → DOM out). The Phase 0 smoke tests remain the integration guard.

**Gates:** baseline green; smoke tests unchanged; coverage holds/rises.

---

## Phase 3 — Context split (own PR; replaces 002's `AdminDataSidecar`)

Split the single `AdminData` into two contexts so stable consumers stop re-rendering on the 5 s telemetry tick.

- **`AdminTelemetryContext` (volatile):** `socketStatus, isConnected, serverStatus, relays, ffmpeg, recordings, sources`.
- **`AdminActionsContext` (stable):** `destinations, bindings, destinationActions, settings, roomAccess, previewOpen, setPreviewOpen, refreshTelemetry`.

**Producer change (`AdminApp.tsx:287-318`):** split the one `useMemo` into **two** with disjoint dep arrays (the actions memo must NOT depend on `serverStatus/ffmpeg*/relays/socketStatus/isConnected/recNow`, so its identity survives ticks). Wrap children in nested providers.

**Consumer change:** 7 call sites, each one line — replace `useAdminData()` with `useAdminActions()` and/or `useAdminTelemetry()`:
| Consumer | New hook(s) |
|---|---|
| `SettingsTab.tsx:30` | `useAdminActions()` → **stops ticking (full win)** |
| `DestinationsTab.tsx:13` | `useAdminActions()` + `useAdminTelemetry()` (still ticks on `relays`) |
| `RecordingsTab.tsx:7` | `useAdminTelemetry()` (stays volatile by design — `recordings.now` clock) |
| `ServerStatusBar`, `AdminTopBar`, `BroadcastConsole`, `LiveTab` | telemetry (must keep ticking — they show live data) |

**Back-compat to minimize test churn:** keep a combined `AdminDataProvider` shim that internally derives both contexts from one `value`, so the ~10 existing provider-wrapping test files keep their one-object shape. (The re-render win still requires AdminApp's two-memo split; the shim is only for test ergonomics.)

**Tests:** a re-render test asserting `SettingsTab` does not re-render when only `serverStatus` changes (spy on a render counter) — proves the win, prevents regression.

**Gates:** baseline green; the new re-render test passes; smoke tests unchanged.

---

## Sequencing & rollback

Phase 0 → Phase 1 [1a hooks · 1b `gridMembers` wiring (D1-B)] → Phase 2 → Phase 3, each a separate PR with all baseline gates green and the Phase 0 smoke tests passing unchanged at every step. Any phase can be reverted independently; the Phase 0 net stays in place as the regression guard for all later work.
