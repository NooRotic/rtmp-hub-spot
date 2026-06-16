# Public Release v1 — Checklist

**Created:** 2026-06-16
**Repo:** `rtmp-hub-spot` — this is also **RipTheStack Product #1** ("RTS:ST Multi-Stream Pro").
**This doc is self-contained** so it can be picked up from a fresh session on another machine (e.g. `NRotic64-X`).

---

## Why this doc exists — the two-layer split

This project does double duty: it is both (a) Walter's strongest **job-search proof point** (the 25-year video/streaming anchor, live) and (b) a **commercial product**. The remaining work splits cleanly by which goal it serves, and the two layers are sequenced differently:

- **Layer 1 — Public PROOF release (DO NOW).** Get it live, demoable in 60 seconds, and linked from the portfolio / LinkedIn / resume. This *is* job-search work — negative opportunity cost, because it directly feeds recruiter conversations (Motion, Bruce M). ~1–2 focused blocks.
- **Layer 2 — Commercial launch (PARKED).** Gumroad listing, pricing, license gate, landing page, ToS/Privacy, streamer outreach. Speculative near-term income, near-zero job-search overlap. Resume on a **trigger, not a date** (see below) — not on the original 2026-06-22 plan date, which was set before the financial-pressure pivot to "job search first."

Rationale: under the current $0-floor / job-search-first window, the highest expected-value-per-hour path is the job search. The proof release advances it; the commercial machinery competes with it.

---

## Verified current state (2026-06-16)

- **Multi-destination relay is merged to `main`** (PR #6 `feat/multi-stream-ui`). The commercial differentiator exists.
  - **Free tier:** simulcast one broadcast to multiple platforms via FFmpeg `-c copy` (no re-encode) — `youtube | kick | tiktok | twitch | facebook | custom`.
  - **Pro tier (reserved/locked, R2):** per-destination transcode overrides + watermark overlay (`EncodeOverride` / `WatermarkConfig` in `packages/shared/index.ts`). Decode→overlay→re-encode; intentionally not shipped under Free.
  - Backend: `destinationStore.js`, `destinationHandlers.js`, `broadcast-orchestrator.js`. Frontend: `admin/tabs/DestinationsTab.tsx`, `DestinationForm.tsx`, `hooks/useDestinations.ts`. All tested.
- **Admin UI** (through 6/8): zone layout, Broadcast Console, Chat drawer, Settings drawer, Room-PIN auth, persistent logging + startup-failure dialog.
- **Core pipe stable:** Electron admin composites peer grid → `MediaRecorder` → IPC → FFmpeg → Node-Media-Server → RTMP. WebRTC full-mesh in single `main-hub` room.
- **README.md is STALE** — dated 3/24, predates ~2.5 months of work. For a public repo the README is the storefront.
- **No OG / link-preview meta** on the client (a WebGL/canvas SPA won't self-scrape — shared links render blank).
- `main` == `origin/main`, clean tree, **no pre-push hook**, `core.hooksPath` unset.

---

## Layer 1 — Public PROOF release (DO NOW)

- [ ] **Record a 90-second demo clip** — the single highest-value asset. Show the real pipeline end-to-end: clients join → grid composites → start broadcast → Destinations tab fans out to 2+ platforms (or local OBS/VLC ingests) simultaneously. Recruiters watch clips; they never install an `.exe`.
- [ ] **Refresh `README.md`** — what it is, the architecture diagram (lift from `CLAUDE.md`), the demo clip, a screenshot, Free vs Pro one-liner, run instructions.
- [ ] **Add OG / Twitter-card meta** to the client `index.html` (`og:image` 1200×630, title, description). Use the `social-preview` skill — same gap PRISM shipped with; don't repeat it.
- [ ] **Make it demoable without a build** — either a hosted client-join page *or* a GitHub Release with a downloadable Electron build + a one-line "how to run" so engineers who want to can.
- [ ] **Link it from the job-search surfaces:** portfolio site, LinkedIn Featured, and the resume's video/streaming line.
- [ ] **Tag a GitHub release** (`v1.0.0` or similar) once the README + demo are up.

**Note on hosting:** do NOT try to cloud-host the full desktop broadcast pipeline (Electron + local FFmpeg + NMS) — that's a multi-week rabbit hole for ~10% more value. The demo clip + a downloadable build captures the proof.

---

## Layer 2 — Commercial launch (PARKED — resume on a TRIGGER)

Do **not** schedule these on a calendar date. Resume when **either**:
1. A job / contract lands and income stabilizes, **or**
2. The Layer-1 proof release draws organic inbound ("can I buy / use this?").

Parked items (legal foundation already DONE — DBA filed + EIN in hand, see `RipTheStack/legal/`):
- [ ] Gumroad listing + pricing ($29–49 one-time per v4 ranking)
- [ ] License gate (RSA-signed key, Gumroad webhook → fulfillment, first-run gate) — Handoff A Phase 4–5
- [ ] Landing page + ToS (termsfeed) + Privacy (termly)
- [ ] Launch tweets, streamer outreach, r/cscareerquestions (for the sibling RTLB product)
- [ ] Pro-tier implementation (per-destination transcode + watermark) — only if sales justify it

Full plan if/when resumed: `C:/Dev/projects/_brainstorms/2026-05-28-product-ideas/NEXT-STEPS-v4.md`.

---

## "Released" acceptance criteria (Layer 1)

Done = all true:
1. `README.md` reflects current reality and shows the demo + a screenshot.
2. A 90-second demo clip is linked and plays.
3. Shared repo/portfolio links render a correct preview image (OG works).
4. The project is reachable from portfolio + LinkedIn Featured.
5. A tagged GitHub release exists.

---

## NRotic64-X continuation notes

This is where Twitch / OBS lives, which matters for verifying the demo:

- **Verify multi-destination relay against real targets** — point a destination at a local OBS/VLC RTMP ingest and/or a real platform stream key; confirm the Free `-c copy` fan-out holds 2+ relays with stable `relay-status` (`live`) and no dropped-frame spikes.
- Capture the demo clip **here**, since OBS is the natural ingest/verification tool.
- After capturing assets, push asset/README changes back per the normal branch + PR flow (this checklist commit goes straight to `main` only because it is docs-only and needed for cross-machine pull).
