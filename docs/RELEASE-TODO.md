# RTMP Hub Spot — Public Release / MVP TODO

_Created 2026-07-06. Consolidated from a full code review (security + packaging sweeps) plus the
strategy in `PUBLIC-RELEASE-v1.md`. Priorities: **P1 = must-do before release**, **P2 = should-do
hardening/polish**, **P3 = post-launch / nice-to-have**. Effort: S (<1h), M (few hrs), L (day+)._

## Scope — pick the target first (this changes what's P1)

There are two meanings of "public release", and `PUBLIC-RELEASE-v1.md` argues for **A first**:

- **A) Proof release** — repo public + refreshed README + 90s demo clip + OG meta + a GitHub Release.
  A recruiter/visitor watches the clip; they do **not** run the `.exe` on a hostile LAN. **No code
  blockers.** Everything here is in **P1‑Storefront** below. ~1 focused block.
- **B) Shippable MVP** — a stranger downloads the `.exe`, runs it, invites LAN guests, broadcasts to
  OBS/YouTube. This requires the **packaging** and **security** blockers below to be real.

**Recommendation:** ship **A** immediately (fast, feeds the job search, low risk), and land **P1‑Packaging**
along the way (the fixes are cheap and a download link to a broken `.exe` is worse than no link). Treat
**P1‑Security** + **P1‑Core** as the gate for calling it a usable **B** product.

---

## P1 — MUST DO before release

### P1‑Packaging — the shipped build is currently broken (do these together, then smoke-test)
- [ ] **Add `room-pin.js` + `local-ip.js` to `build.files`.** `packages/server/package.json:43-60`
      enumerates files, which *replaces* electron-builder's default `**/*`; both are `require()`d at
      startup (`main.js:27-28`) → packaged app throws `Cannot find module` on launch. `local-ip.js` is
      the file we just added in #17, so it's brand-new and un-listed. (Simplest: replace the list with a
      glob that excludes `*.test.js`.) **S**
- [ ] **`asarUnpack` the ffmpeg-static binary + rewrite its path.** No `asarUnpack` exists, so
      `ffmpeg.exe` gets packed inside `app.asar` and cannot be spawned → **all broadcasting + recording
      fail** in the packaged app (`main.js:64` `setFfmpegPath(ffmpegStatic)`, spawn at `:667`). Add
      `"asarUnpack": ["**/node_modules/ffmpeg-static/**"]` and `ffmpegStatic.replace('app.asar','app.asar.unpacked')`. **S**
- [ ] **Smoke-test the portable `.exe` on a clean Windows box** — launches, sets a PIN, a guest joins,
      grid broadcast reaches OBS/VLC, a recording finalizes. Validates the two fixes above + the
      cold-start load race (S7). **M**

### P1‑Security — unsafe to publish as a product (path B)
- [ ] **Authenticate the RTMP ingest (`:1935`).** The PIN only guards WebRTC signaling, not publishing
      (`main.js:194-210` has no `onPrePublish`). Any LAN user can `ffmpeg … rtmp://host:1935/live/grid`
      to hijack the broadcast — and if a destination binding exists, their video **relays straight out to
      YouTube/Twitch**. Add an NMS publish auth (stream-key secret / `onPrePublish` check). **M**
- [ ] **Bind HTTP-FLV egress (`:8000`) to loopback (or auth it).** Currently `0.0.0.0`, `allow_origin:'*'`,
      no auth (`main.js:204-208`) → anyone on the LAN pulls any participant's feed. The in-app preview only
      needs `127.0.0.1` (`RtmpPlayerTile.tsx:9`), so bind to loopback. **S**
- [ ] **Lock the room by default / force a PIN on first run.** No saved config = open hub
      (`main.js:56`) while bound to `0.0.0.0` (`main.js:83`); the code itself flags this as a pre-release
      requirement (`main.js:79-82`). Default locked, or block joins until a PIN is set. **S**

### P1‑Core — confirm the headline feature actually works
- [ ] **Grid broadcast end-to-end on real hardware.** The runtime-verify encoder probe (#15) is the
      *suspected* fix for "broadcast silently dies" but is unconfirmed. Start a grid broadcast, pull
      `rtmp://10.0.0.175:1935/live/grid` in VLC/OBS; if it fails, capture
      `…\Roaming\server\logs\main.log` (`[FFMPEG]`/`[GPU]`). **M**

### P1‑Storefront — needed for ANY public release (paths A + B)
- [ ] **README:** fix placeholders (`yourusername` clone URL `README.md:36`, screenshot placeholders
      `:19-21,:93-95`), add a real screenshot, and document the **security/PIN model + the guest cert step**. **S**
- [ ] **OG / Twitter-card meta** in `packages/client/index.html` (only charset+viewport today) — a
      canvas SPA won't self-scrape, so shared links render blank. 1200×630 image + title/description. **S**
- [ ] **90-second demo clip** (highest-value proof asset): clients join → grid composites → broadcast
      fans out to 2+ destinations. Capture on the streaming box (OBS is the natural ingest). **M**
- [ ] **Publish a GitHub Release.** A `v1.0.0` tag exists locally but there is **no published Release**
      and packages are at `1.1.0`. Tag `v1.1.0`, attach the (fixed) portable `.exe` + notes. **S**

---

## P2 — SHOULD DO (hardening + distribution polish)
- [ ] **Persist the self-signed cert** across launches (`main.js:221` regenerates every start) so guests
      don't re-accept the TLS warning after each restart. **S**
- [ ] **Improve guest join UX / cert story** — QR code + copy-URL button + a short "tap Advanced →
      Proceed" panel (`admin/ServerStatusBar.tsx:24-32`); ideally a local-CA (mkcert-style) so mobile
      `getUserMedia` isn't blocked. This is the biggest friction for non-technical guests. **M**
- [ ] **Gate `server-status` behind room membership** — it's `io.emit` to every connected socket
      (`main.js:380`), leaking LAN IP, stream keys, and publisher IPs to un-joined clients. **S**
- [ ] **PIN hardening** — enforce a min length (`room-pin.js:22`), add a global attempt ceiling (the
      per-IP 5/60s bucket is bypassable by a multi-IP attacker), and a per-connection join guard. **S**
- [ ] **Finalize recordings on quit** — `before-quit` (`main.js:501-518`) doesn't SIGINT active
      `recordingSessions`, risking an unfinalized `moov`. **S**
- [ ] **Surface broadcast death to the operator** — pipe-manager gives up after 3 restarts and only
      emits IPC (`pipe-manager.js:114-123`); confirm the UI raises a visible, persistent alarm. **S**
- [ ] **Metadata + license cleanup** (electron-builder embeds these): fill empty `author`/`description`,
      unify license to **MIT** across all `package.json`s (root MIT / server+shared ISC / client none),
      and fix the `LICENSE` holder ("AntiGravity" vs `com.noorotic.*`). **S**
- [ ] **Cold-start load race** — add a `did-fail-load` retry / wait-for-listen before `loadURL`
      (`main.js:178` loads before `server.listen` resolves at `:496`). **S**
- [ ] **Version-sync + tagging in release scripts** — `release:*` only bump root (`package.json:17-19`);
      `shared` has drifted to `1.0.0` vs `1.1.0` elsewhere. Add `--workspaces` + tag. **S**
- [ ] **CI packages Windows** — `.github/workflows/ci.yml` is ubuntu-only and never runs
      electron-builder, so P1‑Packaging bugs would never be caught. Add a `windows-latest` package +
      smoke job. **M**
- [ ] **NSIS installer** instead of portable-only (`win.target:"portable"`) — Start Menu, uninstaller. **S**
- [ ] **First-run onboarding** — a one-time welcome pointing users to set a PIN + share the Join URL
      (PIN is buried in the Settings drawer). **M**

## P3 — POST-LAUNCH / NICE-TO-HAVE
- [ ] Code signing (removes SmartScreen "Unknown publisher"). **M**
- [ ] Auto-update (`electron-updater` + a publish feed). **M**
- [ ] Cross-platform mac/linux targets + `.icns` (only if targeted). **L**
- [ ] CSP: replace `script-src 'unsafe-inline'` with a nonce/hash (`main.js:130`). **M**
- [ ] Rate-limit `chat-message`/signaling for joined clients (`main.js:410-454`). **S**
- [ ] Track child PIDs → clean up orphaned `ffmpeg.exe`/relays on hard crash (`main.js:12-13`). **S**
- [ ] Don't render the admin shell for `?role=admin` in a plain LAN browser (`App.tsx:13-17`). **S**
- [ ] Hand-authored multi-res `.ico` (crisper than the derived one from `assets/icon.png`). **S**
- [ ] Remove dead/stale code: `/api/status` placeholder (`main.js:248-251`), the `/jsDocs` prod route
      (`main.js:244-245`), stale "not wired" comments (`ClientPortal.tsx:18`, `AdminTopBar.tsx:18`). **S**
- [ ] **Make the Combined Grid View resize-only** (drop drag-move) so it can't cover tiles — deferred by
      decision, see memory `gridview-draggable-revisit`. **S**
- [ ] **Layer 2 — commercial (PARKED):** Gumroad listing + pricing, RSA license gate, landing page +
      ToS/Privacy, Pro tier (per-destination transcode + watermark, already stubbed in
      `shared/index.ts`). Resume on a trigger, not a date — see `PUBLIC-RELEASE-v1.md`. **L**

---

## Notes from the review (clean, for the record)
- No hardcoded secrets in tracked files; `.env` is gitignored and equals `.env.example`. `hostToken` is
  loopback/IPC-only with no leak path to LAN guests.
- Dev-only assumptions are correctly branched (`NODE_TLS_REJECT_UNAUTHORIZED=0` is dev-script-only; Vite
  proxy is dev-only; `app.isPackaged` prod/dev split is correct).
