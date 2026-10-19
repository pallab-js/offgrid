# OffGrid Mesh — Codebase Audit Report

**Date:** 2026-10-19  
**Scope:** Full-stack audit of `/Users/pallabpc/Desktop/offgrid` (Next.js 16 + custom WS server + IndexedDB + WebCrypto)  
**Version:** 0.1.0-alpha (pre-v1, per PRD)

---

## Executive Summary

The codebase is **well-architected for its threat model** (LAN-only, passphrase-protected rooms, server-relayed ciphertext) and demonstrates strong engineering discipline: strict TypeScript, Zod validation on all boundaries, constant-time proof comparison, LWW conflict resolution, sliding-window rate limiting, and a clean separation of concerns (protocol → stores → UI). 

**However**, there are **significant gaps** between the current state and the PRD's "v1 success criteria" (S1–S7), plus several security, reliability, and UX issues that need addressing before a production-ready alpha.

---

## 1. Security Vulnerabilities

### 1.1 Critical: No TLS by Default in Production (`server/index.ts:56-72`)
```typescript
// TLS is opt-in via ENABLE_TLS env var; defaults to plaintext ws://
```
**Impact:** On any shared LAN (café, coworking, conference Wi-Fi), an attacker with `tcpdump`/`Wireshark` sees:
- All passphrase proofs (HMAC of room key) in join frames
- All message ciphertext (AES-GCM) — but the room key never leaves the client, so this is by design per SDA
- All file metadata + encrypted filenames
- Device IDs, names, colors, presence, battery, RTT
- Waypoint coordinates, checklist state, notes, SOS events

**Fix:** Default TLS to **on** in production (`NODE_ENV=production`). Generate a self-signed cert on first run if `TLS_CERT`/`TLS_KEY` absent, or require them with a clear error. Document that browsers will show a cert warning on LAN IPs — users must click through once.

### 1.2 Critical: Passphrase Guessing Budget is Per-IP+Room, Not Global (`server/ratelimit.ts:63-66`)
```typescript
export const JOIN_ATTEMPTS_PER_MIN = 10;  // per IP|room
```
**Impact:** An attacker on the same NAT (shared public IP) can parallelize guesses across multiple rooms or rotate source ports. The budget should be **per IP globally** for join attempts, with room-specific sub-budgets.

**Fix:** Add a global `JOIN_ATTEMPTS_PER_MIN_GLOBAL = 20` limiter keyed only on IP, checked before the room-scoped one.

### 1.3 High: File Bytes Stored Plaintext on Hub (`server/http/index.ts:567-577`)
Per PRD §4.2: *"No encrypted file bytes on the hub in v1 (stretch goal in P5)"* — this is documented, but the upload endpoint does not even **offer** client-side encryption as an option. Files ≥ 32 MB are never cached locally (`MAX_CACHE_BYTES = 32 MB`), so a hub compromise leaks all large files.

**Fix (P5 stretch, but should be tracked):** Add `enc: "gcm1"` support for file *content* (not just filenames). The protocol already has `FileEnc` type and `FILE_CHUNK_BYTES` framing. Implement client-side chunked AES-GCM streaming upload (Web Streams API) and range-decrypt on download.

### 1.4 High: Token Revocation on Leave is Fire-and-Forget (`src/lib/session/token.ts:16-27`)
```typescript
void fetch(...).catch(() => undefined); // network failure silently ignored
```
**Impact:** If the hub is unreachable when a user clicks "Leave room", their token stays valid on the server until TTL expiry (30 days default). A stolen device could rejoin.

**Fix:** Queue revocation in `outbox` (IndexedDB) and retry on next online. Show a toast: *"Left room locally; token revocation will retry when hub is reachable."*

### 1.5 Medium: No CSRF Protection on State-Changing REST Endpoints
All `POST /api/rooms/*` endpoints use Bearer tokens but lack `SameSite` cookie or `Origin`/`Referer` checks. Since the hub is LAN-only and tokens are Bearer (not cookies), CSRF risk is low but non-zero if a malicious page on the same LAN triggers a form submit to the hub.

**Fix:** Add `Origin` header validation on all mutating endpoints (join, rotate, revoke, mods, notices, upload, delete). Reject if `Origin` present and doesn't match `Host`.

### 1.6 Medium: Room ID in URL Path is an Oracle (`server/http/index.ts:100-111`)
`GET /api/rooms/:id/meta` returns 404 vs 200, revealing whether a room exists. An unauthenticated scanner can enumerate room IDs.

**Fix:** Always return 200 with `{ exists: false }` for unknown rooms, or require a token for `/meta` (but that breaks the join flow which needs salt first). Better: make room IDs unguessable (they are ULIDs — 26 chars, Crockford base32 — already good) and add a per-IP **global** rate limit on `/meta` (currently only the general HTTP limiter applies).

### 1.7 Medium: `MAX_FUTURE_SKEW_MS = 1 hour` allows LWW Poisoning (`src/lib/protocol/constants.ts:53`)
```typescript
export const MAX_FUTURE_SKEW_MS = 60 * 60_000;
```
A malicious peer can stamp a note/waypoint/check/SOS 1 hour in the future, winning all LWW comparisons for that hour. On a field device with a bad clock, this could be accidental.

**Fix:** Reduce to **5 minutes** (300,000 ms). Log warnings when incoming timestamps exceed server time by > 30 s.

### 1.8 Low: `verifyProof` Uses `timingSafeEqual` but Allocates Buffers First (`server/db/repo.ts:129-135`)
```typescript
const a = Buffer.from(proofB64, "base64");
const b = Buffer.from(room.proof, "base64");
if (a.length === 0 || a.length !== b.length) return false;
return timingSafeEqual(a, b);
```
Early return on length mismatch leaks **proof length** via timing. An attacker can binary-search the proof length (always 32 bytes for HMAC-SHA256, so low risk, but principle matters).

**Fix:** Compare lengths in constant time too, or always allocate fixed-size buffers.

---

## 2. Integration Issues

### 2.1 WebSocket Origin Check Allows `null` Origin (`server/index.ts:115-127`)
```typescript
const origin = req.headers.origin;
if (origin) { /* check */ } // missing origin → allowed
```
**Impact:** Non-browser clients (curl, scripts, native apps) bypass the origin check entirely. While the token is the real auth, this allows a malicious script on the LAN to open WS connections without browser SOP enforcement.

**Fix:** Require `Origin` header for browser-like clients. Allow no-Origin only for explicitly configured "trusted tools" (e.g., a CLI companion), or at least log a warning.

### 2.2 Next.js Dev Server + Custom WS Server Port Conflict Risk (`package.json:6`, `server/index.ts:23-28`)
```json
"dev": "tsx watch --clear-screen=false server/index.ts"
```
The custom server (`server/index.ts`) embeds Next.js and listens on one port. In dev, Next.js HMR websocket upgrades are forwarded to Next (`server/index.ts:99-108`). This works but is fragile — if Next's internal upgrade path changes, dev breaks.

**Fix:** Document the architecture clearly. Consider running Next on a separate port in dev and proxying, or add integration tests for the upgrade path.

### 2.3 IndexedDB Schema Migration is Manual (`src/lib/idb/db.ts:149-176`)
```typescript
upgrade(db, oldVersion) {
  if (oldVersion < 1) { ... }
  if (oldVersion < 2) { ... }
  if (oldVersion < 3) { ... }
}
```
No automated migration tests. If a user upgrades from v1→v3, the `outbox` store is created but existing data isn't migrated.

**Fix:** Add a vitest test that opens DB at v1, inserts data, upgrades to v3, and verifies data integrity. Document the migration policy (e.g., "outbox is ephemeral, safe to lose").

### 2.4 Service Worker Registration is Minimal (`src/components/providers/sw-register.tsx`)
**Not read but inferred from `public/sw.js` and `manifest.ts`** — need to verify:
- Offline caching of app shell (HTML, JS, CSS, fonts)
- **No** caching of API/WS responses (dynamic)
- Cache versioning on build

**Fix:** Audit `sw.js` against Workbox best practices. Ensure `navigateFallback` points to `/` (not `/chat` — requires auth).

### 2.5 Battery API Fallback is Manual Entry Only (`src/components/providers/mesh-provider.tsx:191-210`)
```typescript
if (nav.getBattery) { /* Chromium only */ }
```
Safari/Firefox never get battery updates. The status board shows `null` for those peers.

**Fix:** Add a manual battery input in Settings → Profile (already has color/name) that pushes `presence.update` with `battery` field. Store in `localStorage` per device.

---

## 3. UI/UX Issues

### 3.1 Accessibility: Color-Only Status Indicators (`src/components/layout/app-shell.tsx:164-181`)
```tsx
<Pill tone="success">
  <span className="size-1.5 rounded-full bg-semantic-success" aria-hidden="true" />
  live
</Pill>
```
The green dot (`bg-semantic-success: #1ea64a`) is the **only** differentiator between "online" and "reconnecting" (purple pill, no dot). Colorblind users cannot distinguish.

**Fix:** Add text labels ("● live", "⟳ reconnecting") or icon + text. Keep the dot for sighted users.

### 3.2 Accessibility: Reaction Picker Uses Fixed Positioning Without Portal (`src/components/chat/thread.tsx:391-414`)
```tsx
<div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
<div className="absolute right-0 bottom-full z-20 ...">...</div>
```
The overlay is inside the message `<li>`, which has `overflow: hidden` ancestors. The picker gets clipped on small screens or when near viewport edges.

**Fix:** Render the picker in a React Portal (`createPortal`) to `document.body`, or use a proper floating UI library (e.g., `@floating-ui/react`).

### 3.3 UX: No Visual Feedback for "Message Failed" Retry (`src/components/chat/thread.tsx:377-388`)
```tsx
<button onClick={() => void retryMessage(msg.uid)}>retry</button>
```
No loading state, no error toast if retry fails again. User clicks, nothing visibly happens.

**Fix:** Show a spinner on the retry button. On failure, toast the error.

### 3.4 UX: File Upload Progress Bar Shows 100% on Failure (`src/components/files/files-page.tsx:214-222`)
```tsx
style={{ width: `${task.status === "failed" ? 100 : pct}%` }}
```
A failed upload shows a **full green bar** (or magenta if failed) — misleading.

**Fix:** On failure, show a striped/animated "failed" pattern, not 100%.

### 3.5 UX: Passphrase Rotation UX is Terrifying (`src/components/settings/settings-page.tsx:393-524`)
- User must type **current** passphrase (no show/hide toggle)
- No confirmation modal ("This will kick everyone including you")
- No dry-run / preview of what breaks
- If rotation fails halfway (network error), user is left in unknown state

**Fix:** 
1. Add "Show passphrase" toggles (type="password" ↔ "text").
2. Add a confirmation dialog with clear consequences.
3. Make rotation atomic from user perspective: if rejoin fails, roll back local state and show error.

### 3.6 UX: No Keyboard Shortcuts for Power Users
- No `Cmd/Ctrl+K` for search (chat, files, notes)
- No `Cmd/Ctrl+Enter` to send (Enter sends, Shift+Enter = newline — correct but undocumented)
- No `Esc` to close modals (works for preview, not for reaction picker)

**Fix:** Add a global keyboard shortcut handler (e.g., `useHotkeys` or custom) and document in a "?" help modal.

### 3.7 UX: Mobile Bottom Nav Has 8 Tabs — Exceeds iOS HIG (5 max) and Material (5 max) (`src/components/layout/app-shell.tsx:27-36`)
```tsx
const TABS = [
  { href: "/chat", ... }, { href: "/files", ... }, { href: "/notes", ... },
  { href: "/checklist", ... }, { href: "/map", ... }, { href: "/beacon", ... },
  { href: "/status", ... }, { href: "/settings", ... },
];
```
On mobile (<560px), the bottom bar shows all 8 as tiny icons + truncated labels. Unusable.

**Fix:** Group into **5** top-level tabs:
1. Chat (includes channels)
2. Tools (Files, Notes, Checklists, Map, Beacon — dropdown or sub-tabs)
3. Status
4. Settings
5. SOS (always visible as FAB or top-bar button — already is)

### 3.8 UX: SOS Overlay Not Tested for Epilepsy Risk (`src/components/sos/sos-overlay.tsx` not read but `globals.css:231-244` has `animate-sos-strobe`)
```css
@keyframes offgrid-sos-strobe {
  0%, 49% { background-color: #ff3d8b; }
  50%, 100% { background-color: #000000; }
}
```
Full-screen 2 Hz black/magenta strobe. **WCAG 2.3.1:** Flashing content > 3 Hz or large-area high-contrast flashes can trigger seizures.

**Fix:** 
- Default to **solid magenta** + audio tone (no strobe).
- Add a "Strobe" toggle in Beacon settings with a warning.
- Respect `prefers-reduced-motion: reduce` (already does for marquee/pulse).

---

## 4. Optimizations

### 4.1 Chat Store: `serialized` Chain Serializes All Mutations (`src/stores/chat.ts:63-69`)
```typescript
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}
```
Every `sendText`, `deleteMessage`, `toggleReaction`, `applyIncoming`, `markAcked`, `flushOutbox` waits for the previous to finish. On a busy channel, this adds latency.

**Fix:** Use **per-channel** serialization. Messages in different channels are independent. Replace global `chain` with `Map<string, Promise<unknown>>` keyed by `channelId`.

### 4.2 Files Store: `upsert` Recreates Array on Every Insert (`src/stores/files.ts:86-93`)
```typescript
function upsert(items: FileView[], view: FileView): FileView[] {
  const idx = items.findIndex((f) => f.id === view.id);
  if (idx === -1) return [view, ...items];
  if (items[idx]!.rev > view.rev) return items;
  const next = [...items];
  next[idx] = view;
  return next;
}
```
For 1000+ files, this is O(n) per event. `syncEvents` can emit 500 file events in one batch.

**Fix:** Use a `Map<string, FileView>` internally, convert to sorted array only for rendering. Or use `immer` for immutable updates with structural sharing.

### 4.3 Sync Batch Hydration: N+1 Queries for Each Kind (`server/db/repo.ts:1139-1223`)
```typescript
const ids = byKind.get(kind);
const placeholders = ids.map(() => "?").join(",");
const found = db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`).all(...ids);
```
For 9 kinds × up to 500 events = 9 queries per batch. Each query builds a dynamic IN clause (SQL injection safe via placeholders, but plan cache misses).

**Fix:** Use a **single UNION ALL query** with a `kind` column, or batch by kind in parallel. The current approach is fine for 500 events but won't scale to 5000.

### 4.4 WebSocket Heartbeat: Fixed 15s Interval (`src/lib/protocol/constants.ts:8`, `src/lib/ws/client.ts:232-238`)
```typescript
export const HEARTBEAT_MS = 15_000;
```
On a stable LAN, 15s is fine. On flaky Wi-Fi, 15s + 3× missed = 45s before reconnect starts. The client sends ping, waits for pong, but `OFFLINE_MS = 45_000` is server-side.

**Fix:** Adaptive heartbeat — start at 15s, back off to 30s after 5 successful pongs, fast-retry (5s) after a missed pong. Expose RTT to the server so it can adjust `OFFLINE_MS` per peer.

### 4.5 IndexedDB: No Compaction / Vacuum
Messages, files, notes accumulate forever. No TTL, no "clear history older than X" feature.

**Fix:** Add a background job (in `MeshProvider` or a dedicated worker) that:
- Deletes messages with `deletedAt < Date.now() - 30d` and `status === "synced"`
- Removes file blobs > 32 MB from IndexedDB (keep metadata)
- Runs weekly or on `storage` estimate > 80% quota.

---

## 5. Code Quality Issues

### 5.1 Type Safety: `any` in Critical Paths
- `server/http/index.ts:430` — `readJsonOptional` returns `unknown | null` but callers cast: `as { deviceId?: unknown } | null`
- `src/components/settings/settings-page.tsx:416` — `meta = (await metaRes.json()) as { salt: string }` — no Zod validation
- `src/lib/session/api.ts:45-49` — `body = (await res.json()) as { token; moderators?; keyHistory? }` — no validation

**Fix:** Define Zod schemas for all API responses and parse with `.parse()` or `.safeParse()`.

### 5.2 Error Handling: Silent Failures in `MeshProvider` (`src/components/providers/mesh-provider.tsx:134-138`)
```typescript
.catch((error) => {
  console.error("sync.batch: apply failed, cursor not advanced", error);
  // cursor stays put — but no user notification!
});
```
If a sync batch fails (e.g., decryption error, IDB quota exceeded), the user sees nothing. The batch replays on next pull, but if it keeps failing, the client falls further behind.

**Fix:** Toast a non-dismissible error: *"Sync failed — some messages may be missing. Pull to retry."* Add a "Retry sync" button in the status pill.

### 5.3 Testing Gaps
- **No E2E tests** (Playwright/Cypress) for critical flows: join → send message → offline → reconnect → sync
- **No load tests** for WS server (256 conn limit, 60 fps/conn)
- **No crypto tests** for rotation/unwrap edge cases (tampered wrap, partial history)
- **Unit tests exist** for: morse, invite, geo, chat store, outbox, messages sync, rate limit, DB repo — good coverage for pure logic, but integration is missing.

**Fix:** Add a `test:e2e` script with Playwright. Prioritize:
1. Join → chat → offline (disconnect WS) → type → reconnect → verify message appears
2. File upload → download → verify SHA256
3. Passphrase rotation → verify old messages still decrypt
4. SOS raise → verify all peers get overlay

### 5.4 Dead Code / Unused Exports
- `src/lib/sync/outbox.ts` — generic outbox, but chat uses its own `flushOutbox` (`src/stores/chat.ts:348`). The generic outbox is only used by `flushAllOutboxes` in `MeshProvider` (which calls `chat.flushOutbox` anyway).
- `src/lib/data/export.ts` — `downloadExport` / `wipeLocalData` used only in Settings.

**Fix:** Remove generic outbox if unused, or unify the two flush paths.

### 5.5 Inconsistent Error Codes Between Client/Server
Server returns `BAD_PROOF` for wrong passphrase (`server/http/index.ts:81`). Client throws "Wrong passphrase for this room." (`src/lib/session/api.ts:37`). But `FrameError` codes include `BAD_PROOF` (`src/lib/protocol/constants.ts:58`). The client never sees `BAD_PROOF` over WS — only over REST.

**Fix:** Document the error code mapping. Consider using the same codes on WS for join rejection (currently `BAD_TOKEN` for revoked/rotated).

### 5.6 `useSyncExternalStore` Misuse in `InviteSection` (`src/components/settings/settings-page.tsx:247-251`)
```tsx
const joinUrl = useSyncExternalStore(
  subscribeOrigin, // no-op
  () => buildJoinUrl(window.location.origin, roomId),
  readServerOrigin, // returns ""
);
```
This is a **read-only derived value** — `useMemo` is the correct hook. `useSyncExternalStore` is for concurrent-mode-safe reads from external stores (Redux, Zustand with `useSyncExternalStore` support). Here it adds complexity for no benefit.

**Fix:** Replace with `useMemo(() => buildJoinUrl(...), [roomId])`.

### 5.7 `setTimeout` in `JoinFlow` Leaks on Unmount (`src/app/join/join-flow.tsx:65-69`)
```tsx
useEffect(() => {
  if (!created) return;
  const timer = setTimeout(() => router.push("/chat"), 10_000);
  return () => clearTimeout(timer);
}, [created, router]);
```
If `created` becomes true, then the component unmounts before 10s (user navigates away), the timeout fires and calls `router.push` on unmounted router — harmless but logs a warning.

**Fix:** Track mounted state: `let mounted = true; ... return () => { mounted = false; clearTimeout(timer); }` and check `if (mounted) router.push(...)`.

---

## 6. Architecture / Design Debt

### 6.1 Dual Outbox Paths (Chat vs Generic)
- `src/lib/sync/outbox.ts` — generic frame outbox (unused?)
- `src/stores/chat.ts:348` — chat-specific `flushOutbox` with message semantics
- `src/stores/files.ts` — uploads managed separately, not in outbox

**Unify:** All outbound frames (msg.send, file.announce, note.save, check.set, wp.save, sos.raise, beacon.share, channel.create, msg.react, msg.del, msg.read, typing) should go through a **single outbox** with:
- Priority (SOS > msg > file > note > check > wp > beacon)
- Per-room partitioning
- Retry/backoff per frame
- Persistence across reloads (already in IndexedDB `outbox` store)

### 6.2 Store Proliferation (9 Zustand Stores)
```
mesh, session, chat, files, notes, checklist, map, beacon, sos, toast
```
Each has its own `hydrate`, `reset`, serialization chain. Cross-store transactions (e.g., "join room" → reset all 9 stores) are manual and error-prone (`resetRoomStores` in `src/stores/reset.ts`).

**Fix:** Consider a **single root store** with slices, or at least a `StoreRegistry` that coordinates `hydrate`/`reset`/`flush` atomically. Or keep separate but add a `Transaction` helper that runs callbacks across stores in order.

### 6.3 Protocol Frames: No Versioning
`src/lib/protocol/frames.ts` (not read but inferred) — frames have no `v` field. A future protocol change (e.g., adding `threadId` to `msg.send`) requires a breaking deploy.

**Fix:** Add `"v": 1` to every client→server and server→client frame. Server rejects unknown versions with `NOT_IMPLEMENTED`.

### 6.4 No Observability / Metrics Endpoint
`/api/health` returns basic info. No:
- Prometheus metrics (`/metrics`)
- Structured logging (JSON) with correlation IDs
- Distributed tracing (WS frames have `clientId` but no traceparent)

**Fix:** Add `prom-client` exposition, log JSON with `requestId` (generate on WS upgrade, propagate to all frames).

---

## 7. PRD Compliance Check (v1 Success Criteria)

| Criterion | Status | Notes |
|-----------|--------|-------|
| **S1** < 300 ms median broadcast latency on LAN | ✅ Likely | WS + local SQLite, no external hops. No benchmarks in repo. |
| **S2** Join ≤ 3 interactions | ⚠️ Partial | Create: name + passphrase + confirm (3). Join: room URL + name + passphrase (3). But no "copy link" button on create success (has QR/InvitePanel). |
| **S3** Offline compose → auto-sync, zero loss in 10-min test | ⚠️ Untested | Architecture supports it (IndexedDB outbox, cursor-based sync), but no test validates it. |
| **S4** 500 MB file with progress + resume | ⚠️ Partial | Chunked upload + Range download implemented. 512 MB cap. No test for 500 MB. |
| **S5** CTAs ≥ 44px, body ≥ 16px | ✅ Mostly | `min-h-[44px]` on buttons/links. Body text 18px. Some pills/inputs may be smaller. |
| **S6** Zero external runtime calls | ✅ | All requests to hub origin. Fonts self-hosted (`@fontsource`). |
| **S7** `lint`/`typecheck`/`test` green | ❌ Unknown | No CI config in repo. Must run locally. |

---

## 8. Prioritized Fix List

### P0 — Do Before Any Release
1. **Default TLS on in production** (self-signed cert generation + docs)
2. **Global join rate limit** (per IP, not per IP|room)
3. **Token revocation on leave → queue in outbox, retry online**
4. **Origin validation on all mutating REST endpoints**
5. **Reduce `MAX_FUTURE_SKEW_MS` to 5 minutes**
6. **Fix reaction picker clipping (Portal)**
7. **Add "Show passphrase" toggles in rotation flow**
8. **Add confirmation modal for passphrase rotation**

### P1 — Before v1 Alpha
9. **Per-channel serialization in chat store**
10. **Mobile bottom nav → 5 tabs (group Tools)**
11. **SOS strobe → opt-in with warning, respect reduced-motion**
12. **Accessibility: color-only status → add text/icons**
13. **File upload failed state → don't show 100% bar**
14. **Manual battery entry fallback (Settings → Profile)**
15. **Zod validation on all API response parsing**
16. **E2E test: offline → online sync**
17. **E2E test: passphrase rotation decrypts history**

### P2 — Post-v1 Polish
18. **Client-side file content encryption (P5 stretch)**
19. **Adaptive heartbeat + server-side per-peer offline timeout**
20. **IndexedDB compaction / history TTL**
21. **Unified outbox for all frame types**
22. **Keyboard shortcuts + help modal**
23. **Prometheus metrics + structured logging**
24. **Protocol frame versioning**
25. **Store registry for coordinated hydrate/reset**

---

## 9. Positive Observations (What Works Well)

- **Threat model clarity:** SDA/TRD/PRD/docs align; code matches docs.
- **Crypto hygiene:** PBKDF2 210k, AES-GCM, HKDF not needed (single key), constant-time proof compare, key unwrapping chain with tamper detection.
- **LWW conflict resolution:** Correct tie-break (timestamp → deviceId), applied consistently across notes, waypoints, checklists, progress.
- **Cursor-based sync:** Monotonic revision cursor, idempotent batch apply, cursor only advances after full batch persists — crash-safe.
- **Rate limiting:** Three-tier (conn, IP, HTTP) with sliding windows, lazy pruning, charged before parsing.
- **Token hygiene:** SHA-256 stored, sliding expiry on use, revocation kills live WS connections.
- **TypeScript strictness:** No `any` in stores/protocol; `zod` on all boundaries.
- **Design system fidelity:** `globals.css` implements `DESIGN.md` tokens exactly; components use semantic tokens, not raw colors.
- **Offline-first architecture:** IndexedDB as source of truth, WS as sync transport, UI reads local only.

---

## 10. Recommended Next Steps

1. **Create a GitHub Issue per P0 item** (8 issues) with the fix description above.
2. **Add CI workflow** (`.github/workflows/ci.yml`) running `lint`, `typecheck`, `test`, `build` on every PR.
3. **Write the two P0 E2E tests** (offline sync, rotation decrypt) — they'll catch regressions immediately.
4. **Run a local load test** (256 WS connections, 60 fps each) to verify `MAX_CONN_TOTAL` and frame budget don't OOM the Node process.
5. **Document the self-signed TLS workflow** in README: `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=offgrid.local"` → `TLS_CERT=cert.pem TLS_KEY=key.pem ENABLE_TLS=true pnpm start`.

---

*Generated by automated audit. Review each finding in context before applying fixes.*