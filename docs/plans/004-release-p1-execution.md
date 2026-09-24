# 004 — Release P1 Execution Plan (concrete, PR-by-PR)

**Created:** 2026-09-24 (Fable planning session, resumed after the 2026-07-07 pause).
**Status:** Proposed — nothing here is implemented yet. `main` @ `c77d249`, tree clean except
untracked `docs/debug/screenshot/*`.
**Source of truth for WHAT:** `docs/RELEASE-TODO.md` (P1/P2/P3 checklist). **This doc is the HOW** —
each item below is written so a cheaper model (Sonnet/Haiku) or a human can execute it without
re-deriving anything. Every code claim was re-verified against the tree on 2026-09-24.

---

## 0. Decisions (made in this session; overturn explicitly if you disagree)

| # | Decision | Why |
|---|----------|-----|
| D0 | **Ship path A (proof release) first**, with P1‑Packaging landed alongside it. P1‑Security is the gate for calling it a path‑B product. | Same recommendation as RELEASE-TODO; nothing has changed. A broken `.exe` download is worse than none, so Packaging rides with A. |
| D1 | **RTMP publish auth uses NMS v4's built‑in `auth.publish` + `?sign=`**, not a custom `prePublish` hook. | Verified in `node_modules/node-media-server/src/server/broadcast_server.js:59-77,149-157`: v4.2.4 verifies `sign=<exp>-<md5(streamPath-exp-secret)>` before `postPublish`. Zero new dependencies, ~20 lines. |
| D2 | **HTTP‑FLV binds to loopback**, RTMP stays on `BIND_IP`. | The in‑app preview only uses `127.0.0.1:8000` (`RtmpPlayerTile.tsx:9`). RTMP must stay LAN‑reachable because the README's OBS flow pulls `rtmp://<LAN-IP>/live/grid` from another box. |
| D3 | **"Locked by default" = block LAN joins until a PIN exists**, not auto‑generate a PIN. | Auto‑generated PINs still need a UI to display them; blocking is one line in `room-pin.js` and forces the first‑run onboarding (P2) to be the real fix. |
| D4 | **`build.files` becomes globs**, not a longer allowlist. | The allowlist is how `room-pin.js`/`local-ip.js` got dropped; every new server module would repeat the bug. |
| D5 | Each PR below is **independently mergeable** and ordered by value/risk. Stop anywhere and `main` is still better than today. | Token/time budget is the binding constraint. |

---

## 1. Model routing (spend Fable/Opus only where judgment is needed)

| Tier | Use for | PRs |
|------|---------|-----|
| **Haiku / Sonnet** (mechanical, spec is exact) | PR‑0, PR‑1, PR‑3, PR‑5 (meta tags), PR‑6 (CI) | copy the edits below verbatim, run the listed checks |
| **Sonnet / Opus** (multi‑file, needs tests written) | PR‑2 (RTMP sign), PR‑4 (README) | follow the spec, write the named tests |
| **Human only** (real hardware) | H‑1 smoke test, H‑2 grid broadcast e2e, H‑3 demo clip, H‑4 GitHub Release | see §4 |

---

## 2. PR sequence

### PR‑0 — Housekeeping (5 min, Haiku)
Branch: `chore/gitignore-debug-shots`
1. Append to `.gitignore` (the existing rule covers `docs/debugging/`, but the real folder is `docs/debug/`):
   ```
   # Local retest screenshots (not for the repo)
   docs/debug/
   ```
2. `git status` must show a clean tree afterwards.
3. In `docs/plans/003-adminapp-refactor.md:5`, change the Status line to note Phases 0–3 shipped in PR #14
   (HANDOFF.md item 3 — housekeeping that was never done).

---

### PR‑1 — Fix the packaged `.exe` (P1‑Packaging, ~30 min, Sonnet)
Branch: `fix/packaging-files-and-ffmpeg`
Both bugs are still present as of `c77d249` (re‑verified: `packages/server/package.json:43-60` allowlist
has no `room-pin.js`/`local-ip.js`; there is no `asarUnpack` key anywhere).

**Edit 1 — `packages/server/package.json`, replace the whole `"files"` array:**
```json
"files": [
  "*.js",
  "!*.test.js",
  "package.json",
  "assets/**/*",
  "../client/dist/**/*"
],
"asarUnpack": [
  "**/node_modules/ffmpeg-static/**"
],
```
Rationale: every runtime module in `packages/server/` is a flat `*.js` (see `ls packages/server`);
the only non‑runtime `.js` files are `*.test.js`. No `vitest.config.*` lives in that folder, so the
glob is safe.

**Edit 2 — `packages/server/main.js:39`** (currently `const ffmpegStatic = require('ffmpeg-static');`):
```js
// electron-builder packs node_modules into app.asar, which cannot be spawned.
// asarUnpack (package.json) keeps the binary on disk under app.asar.unpacked;
// rewrite the path so fluent-ffmpeg + execFile (canInitEncoder, :775) find it.
const ffmpegStatic = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
```
`ffmpegStatic` is used at `:64` (`setFfmpegPath`) and `:775` (`execFile` in the encoder probe) —
the single rewrite at the require site covers both.

**Checks:**
```bash
npm test -w server                 # 116 tests, all green (baseline)
npm run release                    # builds client + electron-builder portable → dist/
```
Then, on the build box, launch `dist/RTMP Hub Spot*.exe`: the admin window must open (proves
`room-pin.js`/`local-ip.js` load) and `main.log` must NOT contain `Cannot find module` or `ENOENT
...ffmpeg`. Full behavioural validation is H‑1.

**Add a test (guards D4 regressions):** `packages/server/package-files.test.js`
```js
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import pkg from './package.json';
describe('electron-builder files', () => {
  it('ships every runtime module main.js requires', () => {
    const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const locals = [...src.matchAll(/require\('\.\/([\w-]+)'\)/g)].map(m => `${m[1]}.js`);
    // Glob "*.js" + "!*.test.js" must admit all of them.
    for (const f of locals) expect(pkg.build.files).toContain('*.js');
    expect(pkg.build.files).toContain('!*.test.js');
    expect(pkg.build.asarUnpack).toContain('**/node_modules/ffmpeg-static/**');
  });
});
```

---

### PR‑2 — Authenticate RTMP publish on `:1935` (P1‑Security, ~2 h, Opus)
Branch: `fix/rtmp-publish-auth`
Threat: any LAN host can `ffmpeg … -f flv rtmp://<hub>:1935/live/grid` and replace the broadcast;
with a relay binding active that video relays out to YouTube/Twitch. NMS v4.2.4 has the fix built in.

**New pure module `packages/server/rtmp-sign.js`** (mirrors `room-pin.js` style — no fs/electron):
```js
'use strict';
const crypto = require('crypto');
/**
 * NMS v4 publish/play signature: `<exp>-<md5(streamPath + '-' + exp + '-' + secret)>`.
 * See node-media-server/src/server/broadcast_server.js verifyAuth().
 * @param {string} streamPath  e.g. '/live/grid'
 * @param {string} secret
 * @param {object} [o]
 * @param {number} [o.ttlSec=31536000]  default 1 year: pipe-manager restarts rebuild
 *   args (pipe-manager.js:60) so a short TTL is fine, but the secret is per-process
 *   anyway (see main.js), so a long TTL costs nothing.
 * @param {()=>number} [o.now=Date.now]
 */
function makeSign(streamPath, secret, { ttlSec = 31536000, now = () => Date.now() } = {}) {
  const exp = Math.floor(now() / 1000) + ttlSec;
  const hash = crypto.createHash('md5').update(`${streamPath}-${exp}-${secret}`).digest('hex');
  return `${exp}-${hash}`;
}
/** Append `?sign=` to an rtmp URL for the given key. */
function signPublishUrl(url, streamKey, secret, opts) {
  return `${url}?sign=${makeSign(`/live/${streamKey}`, secret, opts)}`;
}
module.exports = { makeSign, signPublishUrl };
```

**`packages/server/main.js` edits:**
1. Near `hostToken` (`:49`): `const rtmpPublishSecret = crypto.randomBytes(24).toString('hex');`
   — per‑process, never persisted, never sent to renderers or LAN. Only the local ffmpeg publishes.
2. `nmsConfig` (`:194-210`): add
   ```js
   auth: { play: false, publish: true, secret: rtmpPublishSecret },
   ```
   `play:false` keeps OBS/VLC pulls, the recorder (`:667`), the relay input (`relay-args.js:16`)
   and HTTP‑FLV preview working unchanged.
3. Where `pipeManager` is created (`:567` passes `buildFfmpegArgs`): wrap it so the output URL is
   signed, keeping `ffmpeg-args.js` pure and its 20+ tests untouched:
   ```js
   const { signPublishUrl } = require('./rtmp-sign');
   buildFfmpegArgs: (cfg) => {
     const a = buildFfmpegArgs(cfg);
     return { ...a, outputUrl: signPublishUrl(a.outputUrl, cfg.streamKey, rtmpPublishSecret) };
   },
   ```
   This is the **only** publish path: `spawnPipe` (`:542-559`) is invoked solely by `pipeManager`,
   which calls `buildFfmpegArgs` at `pipe-manager.js:60` on every spawn *and* every restart (so
   restarts get a fresh sign). `spawnRelay` (`:578-587`) *pulls* from NMS — that is a play, not a
   publish, and stays unauthenticated by design (`auth.play:false`). The recorder at `:667` likewise
   pulls. No other edit sites.
4. Optional but cheap: log rejected publishes so hijack attempts are visible —
   NMS logs `publish stream … authentication verification failed` itself; grep for it in H‑1.

**Tests:** `packages/server/rtmp-sign.test.js` — (a) `makeSign` matches a hand‑computed md5 for a
fixed `now`; (b) `signPublishUrl` appends exactly one `?sign=`; (c) recompute NMS's `verifyAuth`
inline in the test (it's 12 lines) and assert it accepts our sign and rejects a tampered path.
Add one `main.test.js` case if it already mocks `nmsConfig`: `auth.publish === true` and secret is
48 hex chars.

**Manual check (H‑1):** from another LAN box, `ffmpeg -re -i test.mp4 -c copy -f flv rtmp://<hub>:1935/live/grid`
must be refused while the hub's own grid broadcast keeps flowing to OBS.

---

### PR‑3 — Loopback HTTP‑FLV + locked‑by‑default room (P1‑Security, ~45 min, Sonnet)
Branch: `fix/flv-loopback-and-default-lock`

**Edit 1 — `main.js:204-208`:**
```js
http: {
  port: NMS_HTTP_PORT,
  host: '127.0.0.1',          // egress is preview-only; RtmpPlayerTile.tsx:9 already hard-codes 127.0.0.1
  allow_origin: 'https://localhost:' + SIGNALING_PORT
},
```
Keep `rtmp.host: BIND_IP` (D2). Also fix the comment block at `:74-82` that still says the whole
server is 0.0.0.0. Update `README.md:56` if it promises LAN `.flv` URLs (it currently only advertises
`rtmp://`, so probably no change).

**Edit 2 — `room-pin.js` `check()`:** replace the "Open hub" branch:
```js
// No PIN configured: only the trusted host may join (locked-by-default, D3).
if (!pin) return { allowed: false, reason: 'unset' };
```
Update the JSDoc return type to `'pin'|'cooldown'|'unset'`. `isLocked()` should now return `true`
when the pin is empty too (rename semantics: "requires a PIN to join") — **or** add
`isConfigured()` and leave `isLocked` alone; pick whichever breaks fewer of the 7 client files that
read `locked` (`grep -rln roomPin packages/client/src`). Client `Lobby.tsx` must map
`join-denied {reason:'unset'}` to copy like *"The host hasn't set a room PIN yet."*

**Edit 3 — `ServerStatusBar.tsx:27-29`:** 🔓 currently means "open". After D3 there is no open
state; show 🔒 + "PIN not set" (amber) vs 🔒 + "PIN set" (green).

**Tests:** extend `room-pin.test.js` (unset → denied, trusted host still allowed, set PIN → normal
flow) and `Lobby.test.tsx` (renders the 'unset' message). Baseline: client 259 / server 116 / shared 3.

---

### PR‑4 — README storefront refresh (P1‑Storefront, ~1.5 h, Sonnet; screenshots from Walter)
Branch: `docs/readme-storefront`
Concrete fixes, all verified present today:
- `README.md:36` `yourusername` → `NooRotic`.
- `:19-21` and `:93-95` screenshot placeholders → real images under `docs/media/` (Walter: crop from
  `docs/debug/screenshot/Screenshot (2..4).png`, 1600 px wide, PNG). Once real media exists, the
  `docs/debug/` ignore from PR‑0 keeps only the raw shots out.
- Add a **Security model** section: LAN‑only by default; PIN required before anyone can join (PR‑3);
  RTMP publish is signed so only the hub can feed `/live/*` (PR‑2); HTTP‑FLV is loopback‑only; the
  self‑signed cert warning and the "Advanced → Proceed" guest step.
- Add the **demo clip** embed/link placeholder that H‑3 fills.
- "Prerequisites → FFmpeg" is wrong for the packaged app (ffmpeg‑static is bundled); state that only
  the source install needs Node 18+.
- Free vs Pro one‑liner from `PUBLIC-RELEASE-v1.md` (Pro = per‑destination transcode + watermark,
  reserved).

---

### PR‑5 — OG / Twitter‑card meta (P1‑Storefront, ~30 min, Haiku + `social-preview` skill)
Branch: `feat/og-meta`
`packages/client/index.html` has only charset + viewport today. Add inside `<head>`:
```html
<meta name="description" content="WebRTC→RTMP LAN hub with a Windows NT 4.0 face. Guests join from a phone; the host composites a grid and fans it out to OBS, YouTube, Twitch." />
<meta property="og:type" content="website" />
<meta property="og:title" content="RTMP Hub Spot" />
<meta property="og:description" content="WebRTC→RTMP LAN hub with a Windows NT 4.0 face." />
<meta property="og:image" content="https://raw.githubusercontent.com/NooRotic/rtmp-hub-spot/main/docs/media/og-1200x630.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://raw.githubusercontent.com/NooRotic/rtmp-hub-spot/main/docs/media/og-1200x630.png" />
```
Generate `docs/media/og-1200x630.png` with the `social-preview` skill from the best admin
screenshot. Note: the SPA is served from the Electron app / LAN only, so the tag that actually
matters for recruiters is the **GitHub repo social preview** (Settings → Social preview → upload the
same PNG). Do both; the skill's cache‑bust playbook covers LinkedIn.

---

### PR‑6 — Windows packaging job in CI (P2 but cheap insurance for PR‑1, ~45 min, Sonnet)
Branch: `ci/windows-package`
`.github/workflows/ci.yml` is ubuntu‑only. Add a second job:
```yaml
  package-windows:
    runs-on: windows-latest
    needs: build-and-test
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with: { node-version: "20", cache: "npm" }
      - run: npm install
      - run: npm run release
      - name: Smoke — required modules exist in the unpacked app
        shell: pwsh
        run: |
          $exe = Get-ChildItem dist -Filter "*.exe" | Select-Object -First 1
          if (-not $exe) { throw "no portable exe produced" }
          Test-Path dist/win-unpacked/resources/app.asar.unpacked/node_modules/ffmpeg-static | Out-Null
      - uses: actions/upload-artifact@v4
        with: { name: portable-exe, path: dist/*.exe }
```
The artifact is what H‑4 attaches to the GitHub Release, so this also removes "build on the
right box" as a release dependency.

---

## 3. Sequencing and budget

| Order | PR | Effort | Model | Unblocks |
|-------|----|--------|-------|----------|
| 1 | PR‑0 housekeeping | 5 min | Haiku | clean tree |
| 2 | PR‑1 packaging fix | 30 min | Sonnet | H‑1 |
| 3 | PR‑3 loopback + default lock | 45 min | Sonnet | path B security |
| 4 | PR‑2 RTMP publish auth | 2 h | Opus | path B security |
| 5 | PR‑5 OG meta | 30 min | Haiku | link previews |
| 6 | PR‑4 README | 1.5 h | Sonnet | path A |
| 7 | PR‑6 Windows CI | 45 min | Sonnet | H‑4 artifact |

Path A is complete after **PR‑0, PR‑1, PR‑5, PR‑4 + H‑2, H‑3, H‑4** (~3 h of model time + one hardware
evening). Path B additionally needs **PR‑2, PR‑3 + H‑1**.

---

## 4. Human‑only checklist (real hardware; Fable can't do these)

- **H‑1 Packaged smoke test** (after PR‑1, ideally after PR‑2/3): clean Windows box → launch the
  portable `.exe` → window opens → set PIN → phone joins over LAN via `https://<LAN-IP>:4001`
  (accept cert) → enable grid → start broadcast → VLC on another box opens
  `rtmp://<LAN-IP>:1935/live/grid` → stop a recording, confirm the `.mp4` plays (moov finalised).
  If anything fails grab `%APPDATA%\server\logs\main.log`, grep `[FFMPEG]` / `[GPU]` / `Cannot find`.
- **H‑2 Grid broadcast end‑to‑end** (P1‑Core): the runtime encoder probe from #15 is still the
  *suspected* fix for "broadcast silently dies". Confirm 10+ min of stable grid output in OBS.
- **H‑3 90‑second demo clip**: capture on NRotic64‑X (OBS box). Script: 2 guests join → grid
  composites → Destinations tab fans out to 2 targets → OBS shows both. Upload to YouTube unlisted;
  link from README (PR‑4) and the portfolio.
- **H‑4 GitHub Release**: bump `packages/shared` `1.0.0` → `1.1.0` (drifted), tag `v1.1.0`, attach the
  CI artifact from PR‑6 (or a local `npm run release` build), paste CHANGELOG `[1.1.0]` + a
  "known limitations" note (self‑signed cert step, LAN only, Windows only).

---

## 5. Deferred (unchanged from RELEASE-TODO P2/P3, not re‑planned here)
Persist the self‑signed cert; QR/copy‑URL join UX; gate `server-status` to room members; PIN
min‑length + global attempt ceiling; SIGINT recordings on quit; surface pipe death in the UI;
license/author metadata; cold‑start `did-fail-load` retry; NSIS installer; first‑run onboarding;
GridView resize‑only (memory `gridview-draggable-revisit`); Layer‑2 commercial (parked on trigger).
