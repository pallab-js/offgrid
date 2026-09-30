# Implementation Plan — OffGrid Mesh

> Phase-by-phase delivery plan · v1 (alpha)
> Companion docs: [PRD](./PRD.md) · [SDA](./SDA.md) · [TRD](./TRD.md)

## 0. Working agreements

- **Order:** docs (this phase) → scaffold → P1…P6. No feature code before its phase opens.
- **Gate per phase:** `pnpm lint` + `pnpm typecheck` + `pnpm test` green, phase deliverables demoed manually, then a git commit (`docs: …`, `feat(pN): …`, `fix(pN): …`, `chore(pN): …`).
- **Git:** `git init` now, commits local; remote added later with `git remote add origin <url>` and pushed on request. History is append-only (no force-push, no interactive rebase of shared history).
- **Scope control:** stretch items (QR join, file encryption, read receipts, reactions) only after the phase's must-haves pass their gate.
- **Design law:** every UI change is checked against `DESIGN.md` (pill CTAs, one block per viewport, weight-not-opacity, mono eyebrows).

## Phase 0 — Documentation & scaffold

**Goal:** repo exists, docs approved, app boots with the design system.

| # | Task | Output |
|---|---|---|
| 0.1 | Write PRD / SDA / TRD / this plan | `docs/*.md` |
| 0.2 | `git init`, `.gitignore` (node, .next, data, *.log), initial commit | history starts |
| 0.3 | `pnpm create-next-app` (TS, Tailwind 4, App Router, src dir, ESLint) | runnable skeleton |
| 0.4 | Tokens from DESIGN.md → `globals.css` `@theme`; fonts via @fontsource; weight/radius/text role utilities | design system live |
| 0.5 | UI primitives: `Button` (primary/secondary/tertiary/icon), `Pill`, `Eyebrow`, `ColorBlock`, `TextInput`, `TopNav`, `Footer` | `src/components/ui` |
| 0.6 | Landing page: hero (display-xl), marquee strip, lime/navy/coral block rhythm, footer | `/` per DESIGN.md |
| 0.7 | README quickstart stub | `README.md` |

**Gate:** app renders landing at `localhost:3000`, passes visual review vs DESIGN.md, lint/typecheck green. Commit `docs: PRD/SDA/TRD/plan` + `feat(p0): scaffold, design system, landing`.

## Phase 1 — Server core, rooms, realtime spine

**Goal:** a peer can create/join a room and see live presence over ws.

| # | Task |
|---|---|
| 1.1 | `server/index.ts`: http server, `/ws` upgrade routing with Next HMR passthrough, config loader |
| 1.2 | SQLite bootstrap (`schema.ts`, WAL, `rev_seq`), repositories for rooms/tokens/channels/devices |
| 1.3 | REST: create room / meta / join (proof verify, token issue) — zod-validated |
| 1.4 | `ws/attach.ts`: connection registry, join/leave, heartbeat (15 s/45 s), ping RTT, rate limiter, frame cap |
| 1.5 | Protocol package `src/lib/protocol` (all frame schemas + types) |
| 1.6 | Client socket wrapper (`src/lib/ws`): connect, backoff reconnect, send/ref acks, event bus |
| 1.7 | Join UI flow: create/join screens, passphrase derive + proof, session unlock (sessionStorage), profile picker |
| 1.8 | Presence UI: peer chips + `StatusPill` (live/reconnecting/offline) |

**Gate:** two browsers join the same room; each sees the other's peer chip appear/disappear live; wrong passphrase rejected with a clear message; RTT displays. Tests: protocol schemas, proof/crypto roundtrip, rooms repo. Commit `feat(p1): hub server, rooms, presence, protocol`.

## Phase 2 — Chat (local-first messaging)

**Goal:** reliable encrypted messaging with offline queue.

| # | Task |
|---|---|
| 2.1 | IDB schema + repositories (`messages`, `outbox`, `meta`, `channels`) |
| 2.2 | Outbox engine: optimistic write → send → ack → `synced`; retry/backoff; dedupe by `clientId` |
| 2.3 | Server message pipeline: insert + rev + broadcast; soft delete; `sync.pull` batches |
| 2.4 | Crypto: `seal/open` message bodies (AES-GCM), search over decrypted local rows |
| 2.5 | Channels: server-side default channels + create channel UI; channel switcher |
| 2.6 | Chat UI: thread (day grouping, author color, status ticks), composer (Enter/send, disabled states), typing indicator, replies, delete |
| 2.7 | System messages (join/leave) + `#sos` channel rendering |

**Gate:** AC-CHAT + AC-SYNC pass (hub restart mid-conversation). Search returns hits offline. Commit `feat(p2): local-first chat`.

## Phase 3 — File sharing

**Goal:** upload/download with progress and resume.

| # | Task |
|---|---|
| 3.1 | Streaming upload handler (headers, size cap while streaming, atomic `.part` → final, sha256, rev) |
| 3.2 | Download with `Range`/206, correct `Content-Type`/`Content-Disposition`, HEAD metadata, DELETE |
| 3.3 | Client uploader: queue, per-file progress (XHR upload events), cancel, retry |
| 3.4 | File library UI: grid/list, filters, upload dropzone, previews (image/audio/video/pdf/text via blob), download with resume |
| 3.5 | Offline cache policy (< 32 MB → IDB blob) + "cached" badge |
| 3.6 | Attach file to message (`kind: "file"`, attachment chips render in thread) |

**Gate:** AC-FILES (500 MB + interrupted resume, checksums equal). Commit `feat(p3): file sharing`.

## Phase 4 — Survival suite

**Goal:** all six tools functional and synced.

| # | Task | Sub-gate |
|---|---|---|
| 4.1 | **SOS**: raise/clear frames, overlay (strobe + WebAudio alarm, reduced-motion aware), `#sos` entry, always-visible SOS action | AC-SOS |
| 4.2 | **Status board**: battery (`getBattery` + manual fallback), RTT, last-seen, hub health card | AC-STATUS |
| 4.3 | **Checklists**: bundled `src/content` JSON (checklists + guides), progress sync, search, per-item LWW | AC-CHECK |
| 4.4 | **Notes**: encrypted notes CRUD, LWW sync, IDB mirror, editor UX | AC-NOTES |
| 4.5 | **Map**: coordinate grid, image load + 2-point calibration, waypoint CRUD + sync, distances, JSON/GPX import-export | AC-MAP |
| 4.6 | **Beacon**: morse encoder (Farnsworth timing), WebAudio playback, full-screen flasher, WPM slider, presets, `beacon.share` | AC-BEACRON |

**Gate:** every AC in TRD §10 for these tools passes; unit tests for morse/geo/LWW reducer. Commit `feat(p4): survival suite`.

## Phase 5 — Resilience & polish

**Goal:** field-ready behavior and DESIGN.md fidelity.

| # | Task |
|---|---|
| 5.1 | `public/sw.js` + registration: cache-first shell, network-first navigation, versioned cache cleanup |
| 5.2 | Offline banner + outbox visibility (pending count, manual retry, `failed` state) |
| 5.3 | Data export (JSON incl. decryptable content while unlocked) + wipe with typed confirmation |
| 5.4 | Route `error.tsx` / `loading.tsx` / empty states everywhere; toaster for transient errors |
| 5.5 | Responsive pass per DESIGN.md breakpoints (960/768/560); mobile nav rail → bottom bar |
| 5.6 | A11y pass: focus rings, labels, contrast, keyboard SOS, reduced motion |
| 5.7 | Perf: bundle budget check (N7), lazy-load map/beacon media paths |
| 5.8 | README final (LAN join walkthrough, troubleshooting, data locations) |

**Gate:** AC-OFFLINE passes; axe-clean on primary routes; bundle < 250 KB gz. Commit `feat(p5): offline shell, polish, docs`.

## Phase 6 — Verification & release readiness

| # | Task |
|---|---|
| 6.1 | Full vitest suite green (protocol, crypto, sync, repos, morse, geo) |
| 6.2 | `pnpm lint && pnpm typecheck && pnpm test` — final sweep |
| 6.3 | **2-device LAN test** (§5 checklist below) on real hardware |
| 6.4 | Docs reconciled with implementation (update TRD deltas, mark decisions changed) |
| 6.5 | `pnpm build && pnpm start` production smoke test |
| 6.6 | Tag `v0.1.0-alpha`; prepare for remote (`.gitignore` audit, no secrets committed) |

**Gate:** §5 checklist all-pass; tag created; ready to `git remote add` when URL provided.

## 1. Risk register (live)

| Risk | Mitigation baked into |
|---|---|
| Next 16 custom-server HMR conflict | P1 task 1.1 verifies `/ws`-only upgrade handling on day one |
| better-sqlite3 native build | install check in P0/P1; fallback plan `node:sqlite` (Node 22+) or `sql.js` documented in SDA |
| Crypto UX (re-prompt on reload) | sessionStorage session unlock (SDA §6.2) |
| Scope creep across 6 tools | P4 sub-gates; stretch queue only after gate |
| Font substitution drift (Inter x-height) | DESIGN.md note: line-height −0.02 applied in tokens (P0 task 0.4) |

## 2. Out-of-band (after remote repo provided)

1. `git remote add origin <url> && git push -u origin main`
2. Optional protected-branch / PR conventions — decided then, no CI config assumed.

## 3. Definition of Done (v1)

- [x] PRD must-haves all accepted via §5 checklist (user sign-off 2026-09-30)
- [x] TRD N1–N10 verified — P6 measurements: N5 rate-limit 341×`RATE_LIMITED` + bystander unaffected; N6 start < 1 s; N7 167 KB gz; N4 fuzz in smoke; N10 sweep green; N1/N2/N3/N8/N9 demonstrated in the two-device run (user sign-off 2026-09-30)
- [x] Lint/typecheck/test green; production build boots (verified P6: build 19 s, `pnpm start` healthy in 0.8 s, production smoke 49/49)
- [x] Docs match code; README sufficient for a new user to run hub + join from a second device in < 5 minutes (TRD reconciled + README walkthrough; user sign-off 2026-09-30)
- [x] No runtime network calls beyond the hub origin; `data/` gitignored (grep-audited P6)

## 4. Stretch queue (only after DoD or explicit approval)

QR join codes · encrypted file bytes at rest · read receipts · reactions · GPX route drawing · hub export endpoint · light/dark navy theme toggle for `/map`.

## 5. Two-device LAN acceptance checklist (run at P1, P2, P3, P4, P6)

1. Device A: `pnpm dev` → create room `Field-1` with passphrase → note join URL.
2. Device B (other machine/phone): open `http://<A-ip>:3000` → join with passphrase → appears in A's presence within 2 s.
3. A sends message → B receives < 300 ms; statuses settle to `synced`.
4. Toggle airplane mode on B (10 min at P6): B queues 10 messages; restore → all sync, no dupes, order preserved.
5. A uploads a file (include one ≥ 100 MB) → B downloads; interrupt + resume; checksums equal.
6. A raises SOS → B gets overlay + sound < 1 s; A clears → B clears.
7. A checks a checklist item, writes a note, drops a waypoint, shares a morse beacon → all visible on B.
8. Status board shows B's battery (or manual value) and live RTT on both.
9. Kill hub process → B shows offline banner, history still readable, queued send retries → restart hub → auto-recovery < 5 s.
10. Reload both browsers → session unlock works (same tab) / passphrase re-prompt (new session) → history intact.
