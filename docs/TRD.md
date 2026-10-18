# TRD — OffGrid Mesh

> Technical Requirements & Specification · v1 (alpha)
> Companion docs: [PRD](./PRD.md) · [SDA](./SDA.md) · [Implementation Plan](./IMPLEMENTATION-PLAN.md)

## 1. Technology baseline

| Concern | Requirement | Pinned (v1) |
|---|---|---|
| Runtime | Node.js ≥ 20.9 | 20.20.x local |
| Package manager | pnpm ≥ 10 | 10.33.x |
| Framework | Next.js App Router, TypeScript strict | next 16.3.x, react 19 |
| Styling | Tailwind CSS v4 (CSS-first `@theme`) | tailwindcss 4.3.x, @tailwindcss/postcss |
| Language | TypeScript 5.x, `strict: true`, no `any` in exports | — |
| WebSocket | `ws` server, JSON text frames | ws 8.x |
| Database | embedded SQLite, WAL, synchronous API | better-sqlite3 12.11.x (13.x needs Node ≥ 22) |
| Client store | zustand slices (no redux) | zustand 5.x |
| Client DB | IndexedDB wrapper | idb 8.x |
| Validation | zod schemas shared by both planes | zod 4.x |
| Fonts | self-hosted variable fonts | @fontsource-variable/inter, @fontsource/jetbrains-mono |
| Icons | tree-shaken icon set | lucide-react 1.x |
| Unit tests | vitest | vitest 5.x |
| Lint | eslint (next/core-web-vitals + ts) | eslint 9.x |

**Prohibited in this repo:** Docker/compose files, cloud SDKs, CI-provider config requiring hosted runners, telemetry, external HTTP calls at runtime, CSS frameworks besides Tailwind, state libraries besides zustand.

## 2. Environment & scripts

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | hub listen port |
| `HOSTNAME` → `BIND_HOST` | `0.0.0.0` | bind address (all interfaces for LAN). Renamed from `HOSTNAME`: shells and container runtimes export `HOSTNAME` as a machine/container id, not an address (startup used to die with ENOTFOUND); the hub now reads `BIND_HOST` only. |
| `DATA_DIR` | `./data` | SQLite + file store + logs |
| `TOKEN_TTL_DAYS` | `30` | room-join bearer tokens lapse after this many days without an authenticated use; every use (WS join, Bearer-authenticated HTTP) slides the window forward |
| `MAX_FILE_BYTES` | `536870912` (512 MB) | upload cap |
| `MAX_FRAME_BYTES` | `1048576` (1 MB) | ws frame cap |
| `LOG_LEVEL` | `info` | `debug/info/warn/error` |

Scripts: `dev` (tsx watch server), `build` (next build + server tsc), `start` (node dist), `lint`, `typecheck` (`tsc --noEmit`), `test` (vitest run), `test:watch`.

## 3. HTTP API

All responses `application/json; charset=utf-8`. Errors: `{ "error": { "code": string, "message": string } }` with 4xx/5xx. Auth = `Authorization: Bearer <token>` on room-scoped routes.

| Method & path | Body | Returns | Notes |
|---|---|---|---|
| `GET /api/health` | — | `{ ok, uptimeMs, clients, rev, version }` | unauthenticated |
| `POST /api/rooms` | `{ roomId, name, salt, proof }` | `{ roomId, channels: [...] }` | creates room + default channels (`general`, `logistics`, `sos`); `sos` is system channel, non-deletable |
| `GET /api/rooms/:id/meta` | — | `{ name, salt, createdAt }` | needed to derive proof; no secret leaked |
| `POST /api/rooms/:id/join` | `{ deviceId, name, color, proof }` | `{ token, serverTime }` | 403 `BAD_PROOF` on mismatch |
| `POST /api/rooms/:id/revoke` | — (Bearer) | `{ revoked: true }` | deletes the presented token (room-scoped) and closes live WS connections riding it (close 4001 `token revoked`); idempotent + no validity oracle: unknown/expired/foreign tokens return the same 200 |
| `POST /api/rooms/:id/channels` | `{ name }` | `{ channel }` | auth; slugified unique per room |
| `POST /api/rooms/:id/files` | raw body | `{ fileId, rev, size, enc }` | auth; headers: `X-File-Name` (URI-encoded sealed name), `X-File-Iv`, `X-File-Mime`, `X-File-Id` (client ULID, idempotent). Client-encrypted uploads add `X-Enc: gcm1`, `X-Plain-Size` and multipart framing `X-Part`/`X-More`: stored bytes are AES-GCM ciphertext (64 KiB frames), `size` reports plaintext length, `sha256` covers stored bytes |
| `GET /api/rooms/:id/files/:fileId` | — | bytes | auth; supports `Range: bytes=a-b` → 206 + `Content-Range`; `HEAD` returns metadata only |
| `DELETE /api/rooms/:id/files/:fileId` | — | `{ rev }` | auth; soft delete + unlink |
| `GET /api/rooms/:id/export` | — | `offgrid-hub-export` v1 JSON | auth (Bearer, hub capability token); full dump `{ format, version, exportedAt, room, channels, devices, messages, reads, notes, files, waypoints, progress, sos, beacons }`; sealed fields decrypt client-side with the room key. (Settings still offers the client-side `offgrid-export` v1 from IndexedDB.) |

Validation: zod on every JSON body; file headers sanitized (strip path separators, cap 255 chars). Unknown routes → Next 404.

Rate limits (sliding window per client IP, `429` + `RATE_LIMITED` when exceeded; constants in `server/ratelimit.ts`):

| Budget | Limit |
|---|---|
| All API routes (health exempt) | 300 req/min per IP |
| `POST /api/rooms` | 10/min per IP |
| `POST /api/rooms/:id/join` (passphrase guesses) | 10/min per IP **and** room — charged before the body is read |

## 4. WebSocket protocol — `/ws`

### 4.1 Envelope

```ts
// client → server
{ t: FrameType, ref?: string /* clientId / correlation id */, ...payload }
// server → client
{ t: ServerFrameType, ref?: string, ...payload }
```

- `ref` is echoed on `ack`/`error` so the client can settle an outbox entry.
- Hub validates 100 % of inbound frames/bodies with zod (`src/lib/protocol`); invalid → `error { code: "BAD_FRAME" }`, never crash the hub.
- Client validates every inbound `s2c` frame with the same schemas, loaded **lazily** (`import("@/lib/protocol/frames")` on first message) so zod stays out of first-load JS (N7). Outbound frames are compile-time typed; the hub re-validates them.
- Text frames only; max `MAX_FRAME_BYTES`. Binary frames rejected.

### 4.2 Client → server frames

| `t` | Payload | Server effect |
|---|---|---|
| `join` | `{ token, device: { id, name, color } }` | verify token → register connection → reply `joined` → send presence |
| `leave` | `{}` | deregister |
| `ping` | `{ ts }` | reply `pong { ts, serverTs }` |
| `msg.send` | `{ clientId, channelId, kind: "text"\|"file", body: {ct,iv}\|null, attachments?: string[], replyTo?: string }` | insert (dedupe by clientId) → `ack` → broadcast `msg.new` |
| `msg.del` | `{ clientId, id }` | soft delete → `ack` → broadcast `msg.deleted` |
| `msg.react` | `{ clientId, id, emoji, on }` | per-device add/remove on the message row → `ack` → `msg.new` with updated `reactions` (broadcast only when changed) |
| `msg.read` | `{ channelId, at }` | upsert `channelId::deviceId` read cursor (monotonic, rev-streamed) → `channel.read` broadcast only when the cursor advances |
| `typing` | `{ channelId, on }` | fan-out only (not persisted) |
| `sync.pull` | `{ cursor }` | `sync.batch` of all events with `rev > cursor`, ≤ 500/batch, `done` flag |
| `presence.update` | `{ battery?: number\|null, manualBattery?: number }` | update device row → broadcast `presence` |
| `note.save` | `{ clientId, id?, title: {ct,iv}, body: {ct,iv}, rev? }` | LWW insert/update → `ack` → `note.upsert` |
| `note.del` | `{ clientId, id }` | soft delete → `note.deleted` |
| `check.set` | `{ clientId, itemId, checked, updatedAt, deviceId }` | LWW → `check.update` |
| `wp.save` | `{ clientId, id?, lat?, lng?, gx?, gy?, label: {ct,iv}, color, updatedAt, deviceId }` | LWW → `wp.upsert` |
| `wp.del` | `{ clientId, id }` | soft delete → `wp.deleted` |
| `sos.raise` | `{ clientId, lat?, lng?, note?: {ct,iv}, updatedAt, deviceId }` | insert active SOS → broadcast `sos.raised` (high priority) |
| `sos.clear` | `{ clientId, id, deviceId }` | deactivate → `sos.cleared` |
| `beacon.share` | `{ clientId, text: {ct,iv}, wpm }` | insert → `beacon.new` (all peers may transmit) |
| `file.announce` | `{ clientId, fileId }` | verify file row → `file.new` broadcast |
| `file.del` | `{ clientId, fileId }` | soft delete + unlink → `file.deleted` |

### 4.3 Server → client frames

`joined { room, channels, device, cursor, serverTime }` · `ack { ref, id, rev }` · `error { ref?, code, message }` · `pong { ts, serverTs }` · `presence { peers: Peer[] }` · `sync.batch { events: Event[], cursor, done }` · `msg.new { msg, rev }` · `msg.deleted { id, rev }` · `note.upsert`/`note.deleted` · `check.update` · `wp.upsert`/`wp.deleted` · `sos.raised`/`sos.cleared` · `file.new`/`file.deleted` · `beacon.new` · `channel.new` · `channel.read { channelId, deviceId, at, rev }`.

`Peer = { deviceId, name, color, battery|null, rttMs|null, lastSeen, online }`.

Error codes: `BAD_FRAME`, `BAD_TOKEN`, `BAD_PROOF`, `ROOM_NOT_FOUND`, `RATE_LIMITED`, `NOT_IN_ROOM`, `PAYLOAD_TOO_LARGE`, `INTERNAL`.

### 4.4 Presence & liveness

- Client sends `ping` every 15 s; RTT = pong latency (EMA over 5 samples).
- Hub marks peer offline after 45 s without any frame; broadcasts `presence`.
- On socket close: mark offline, broadcast.

### 4.5 Rate limits & connection admission

- Frame budgets are charged **before parsing** (malformed frames count) and include `ping` — 60 frames/s per connection, 480 frames/s per IP across all of that IP's connections (8 sockets' worth, so N sockets can't multiply one host's budget while a co-located peer keeps working).
- `RATE_LIMITED` error responses are throttled to 1/s per connection so a flooder can't dictate our outbound traffic.
- Upgrade admission: `Origin`, when present, must match `Host` (cross-site WebSocket hijacking); max 32 connections per IP, 256 total — refusals answer `403`/`429` on the raw upgrade. Clients without `Origin` (scripts) are allowed; the token + frame budgets still apply.

## 5. SQLite schema (DDL)

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, salt TEXT NOT NULL,
  proof TEXT NOT NULL, created_at INTEGER NOT NULL, settings TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'normal', created_at INTEGER NOT NULL,
  UNIQUE(room_id, name)
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL, color TEXT NOT NULL, created_at INTEGER NOT NULL,
  last_seen INTEGER, battery REAL, meta TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, client_id TEXT, room_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  device_id TEXT NOT NULL, author TEXT NOT NULL, kind TEXT NOT NULL,
  body TEXT, iv TEXT, reply_to TEXT, attachments TEXT NOT NULL DEFAULT '[]',
  reactions TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL,
  UNIQUE(room_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_room_ch ON messages(room_id, channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_rev ON messages(rev);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, device_id TEXT NOT NULL,
  name_ct TEXT NOT NULL, name_iv TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, sha256 TEXT, enc TEXT NOT NULL DEFAULT 'none', path TEXT NOT NULL,
  created_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reads (
  id TEXT PRIMARY KEY,          -- `${channelId}::${deviceId}`
  room_id TEXT NOT NULL, channel_id TEXT NOT NULL, device_id TEXT NOT NULL,
  at INTEGER NOT NULL, rev INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reads_rev ON reads(rev);
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, title_ct TEXT NOT NULL, title_iv TEXT NOT NULL,
  body_ct TEXT NOT NULL, body_iv TEXT NOT NULL, updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  room_id TEXT NOT NULL, item_id TEXT NOT NULL, checked INTEGER NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, rev INTEGER NOT NULL,
  PRIMARY KEY (room_id, item_id)
);
CREATE TABLE IF NOT EXISTS waypoints (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, lat REAL, lng REAL, gx REAL, gy REAL,
  label_ct TEXT NOT NULL, label_iv TEXT NOT NULL, color TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sos_events (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, device_id TEXT NOT NULL,
  note_ct TEXT, note_iv TEXT, lat REAL, lng REAL, active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, cleared_at INTEGER, cleared_by TEXT, rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS beacons (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, device_id TEXT NOT NULL,
  text_ct TEXT NOT NULL, text_iv TEXT NOT NULL, wpm INTEGER NOT NULL,
  created_at INTEGER NOT NULL, rev INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rev_seq (v INTEGER NOT NULL);  -- single row, incremented per change
```

Migrations: forward-only runner in `schema.ts` — `meta.schema_version` records the last applied step; each pending `Migration { id, name, up }` runs in its own transaction **together with its version bump** (SQLite DDL is transactional → a failed step rolls back schema + version and is retried on next open); steps apply in id order; a database from a newer build (version ahead of code) is left untouched with `db.schema_ahead`. Baseline (id 1) is idempotent DDL in the latest shape; id 2 backfills `messages.reactions`/`files.enc` for pre-runner databases (guarded `ALTER … ADD COLUMN`). **DB file is gitignored**; schema lives in code.

## 6. Client data

### 6.1 IndexedDB — database `offgrid` v3

| Store | Key / index | Contents |
|---|---|---|
| `messages` | `uid`; idx `by-channel`, `by-client`, `by-server` | sealed body `{ct,iv}` + sync status (`pending`/`synced`/`failed`), reply/attachments/`reactions`, tombstones |
| `files` | `id`; idx `by-room` | sealed name, mime/size/sha256, `enc` marker (`gcm1`/`none`), cached blob when `size < 32 MB`, tombstones |
| `notes` | `id`; idx `by-room` | sealed title/body, LWW fields (`updatedAt`, `updatedBy`, `rev`, `deletedAt`) |
| `waypoints` | `id`; idx `by-room` | sealed label, lat/lng **or** grid x/y, color, LWW fields |
| `progress` | `roomId:itemId`; idx `by-room` | checklist item checked state, LWW fields |
| `sos` | `id`; idx `by-room` | sealed note, lat/lng, `active`/`clearedAt`, rev |
| `meta` | `key` | device-local only: `map` (image blob + 2-point calibration + drawn GPX route), `battery` (manual %), `offgrid-map-theme` in localStorage |
| `outbox` | `clientId` | raw client frames + `attempts` + `failed` flag + `nextAttemptAt` backoff gate (generic sync outbox for notes/checklist/map/SOS/beacon) |

Channels are **not** persisted — they arrive in the `joined` frame. Sealed payloads decrypt in memory via the cached room key (`openText`).

### 6.2 Web storage

`localStorage["offgrid.session.v1"]` holds `deviceId`, profile, room membership, token, cursor. `sessionStorage["offgrid.roomkey.v1"]` caches the raw room key **for the tab session only** (cleared on leave/wipe).

### 6.3 Write discipline

UI writes to IDB first, then the outbox/socket; server ack confirms and stamps `rev`. Reducers applying server events are idempotent and LWW-safe: skip only when `existing.rev > incoming.rev` (equal rev applies — the authoritative overwrite wins); SOS clear always wins.

**Cursor discipline:** the sync cursor asserts "everything before me is durably in IndexedDB" — `sync.batch` events are applied (awaited to the IDB commit) *before* the cursor advances and the next `sync.pull` goes out, so a crash mid-batch replays the batch instead of skipping it; the cursor itself never regresses. **Room transitions:** leaving a room, or joining a different one in the same tab, resets every domain store (`src/stores/reset.ts`) — the chat outbox flush is additionally scoped to the connected `roomId`, so pending messages from room A stay queued until A is re-entered.

## 7. Non-functional requirements

| ID | Requirement | Target / test |
|---|---|---|
| N1 | LAN broadcast latency | p50 < 300 ms (2 browsers, same machine) |
| N2 | Message durability | 10-min hub outage, 40 messages → all sync, no dupes |
| N3 | File transfer | 500 MB upload with progress; interrupted download resumes via Range (frame-aligned when encrypted; decrypt-on-the-fly pipeline) |
| N4 | Frame validation | fuzzed/oversized frames → `error`, hub stays up (unit test) |
| N5 | Rate limit | > 60 msg/s from one connection → `RATE_LIMITED`, others unaffected |
| N6 | Startup | cold `pnpm dev` ready < 10 s; `pnpm build && pnpm start` < 3 s |
| N7 | Bundle | first-load JS < 250 KB gzipped (app routes) |
| N8 | Accessibility | axe-clean on chat/beacon/settings; 44 px targets; reduced-motion honored |
| N9 | Offline | with hub stopped: shell + history render; composer queues; reconnect flushes |
| N10 | Determinism | `pnpm lint && pnpm typecheck && pnpm test` green; no network calls at runtime |

**Offline shell:** `public/sw.js` (registered production-only, scope `/`, `updateViaCache: "none"`) does network-first for navigations with cache fallback, cache-first for `/_next/static`, stale-while-revalidate for same-origin statics; `/api` and `/ws` are never intercepted; caches are namespaced `offgrid-v1-*` and orphaned versions are dropped on activate. PWA manifest via `src/app/manifest.ts`. UI: offline banner with outbox pending/failed counts + manual retry (Settings provides export/wipe).

## 8. Error handling & logging

- **Client:** socket errors surface as a `StatusPill` state (`live / reconnecting / offline`); outbox entries retry with exponential backoff (`nextAttemptAt`/`retryAfter` gates the queue so enqueue bursts don't consume attempts) and are marked `failed` after 8 attempts **or on permanent rejection** — failed entries are kept (banner-visible, re-armable via manual retry), never silently dropped. SOS raise/clear watch their delivery outcome and drop the `raising` flag + toast on failure instead of claiming success. Feature errors render inline (input-level), never global crash — route-level `error.tsx` boundaries everywhere.
- **Server:** try/catch per frame → `error` reply + log; uncaught exceptions logged and process kept alive (single-process hub: never `process.exit` on request errors). Log line format: `ISO level event room= device= detail` → `data/logs/hub.log` (size-rotated, 5 × 2 MB).
- **Never log** passphrases, room keys, plaintext bodies, or tokens.

## 9. Security requirements

1. Room key never leaves memory/sessionStorage; never in URLs, logs, or IDB `meta`.
2. Tokens compared by SHA-256 hash at rest; bearer only over LAN HTTP by default — documented cleartext threat model (SDA), TLS opt-in via `ENABLE_TLS`/`TLS_CERT`/`TLS_KEY` (README "Security model").
3. Path traversal impossible: file ids are ULIDs, storage paths built server-side only, download validated against DB row.
4. Upload size enforced while streaming (abort at cap) and enforced again on disk stat.
5. Zod validation on 100% of inbound frames/bodies; unknown keys stripped.
6. No `dangerouslySetInnerHTML` for user content; search highlighting via text nodes.
7. Room-scoped authorization: every query filters by `room_id` derived from the verified token, never from client payload.
8. Abuse surfaces are budgeted: join guesses 10/min per IP+room, room creation 10/min per IP, WS frames 60/s per connection and 480/s per IP, ≤ 32 sockets per IP — and the WS upgrade rejects foreign `Origin` headers.
9. Device identity is server-issued: the WS `join` derives `conn.device.id` from the **token row**, never from the frame (a differing frame id is ignored and logged as `ws.join.device_mismatch`) — all ownership checks (`msg.del`, file delete, authorship, presence) therefore read a token-bound identity. Residual trust is the PSK model itself: anyone who knows the passphrase proof can mint a token for any device id at HTTP join.
10. LWW inputs are time-bounded: client-supplied timestamps (`updatedAt` on note/wp/check/sos/file frames, `msg.read.at`) must be ≤ 1 h ahead of the server clock at parse time (`MAX_FUTURE_SKEW_MS`) or the frame is rejected `BAD_FRAME`. The past is unbounded (offline replay of days-old edits is legitimate); the future is capped because an item stamped far ahead wins every LWW comparison **forever**, locking it room-wide. s2c schemas stay unbounded — server-stamped values are authoritative and a slow client clock must not reject valid server frames.
11. Room-join tokens have a lifecycle: they expire `TOKEN_TTL_DAYS` (default 30) after their last authenticated use — each use slides the window forward, so active devices never lapse while abandoned credentials die (migration 3 grants existing tokens a one-time grace window so nobody is locked out at upgrade). Revocation: `POST /api/rooms/:id/revoke` with the token itself deletes it room-scoped and immediately closes every live WS connection bound to its hash (`conn.tokenHash`, close 4001) — called fire-and-forget by both Leave flows and wipe. The response is identical for unknown/expired tokens (200) so the endpoint is not a validity oracle; tokens are stored sha256-hashed and never logged.

## 10. Acceptance criteria per requirement area

- **AC-CHAT:** given two joined peers, a sent message renders on the receiver < 300 ms; sender sees `pending → synced`; reload restores history from IDB before network sync.
- **AC-SYNC:** kill hub 10 min while peer A sends 40 msgs; restart hub → B receives all 40 in order, A shows all `synced`, no duplicates after 3 reconnects.
- **AC-FILES:** upload a 500 MB file with visible %; peer downloads; interrupt at ~50 % and resume → checksum equal (`sha256sum`).
- **AC-SOS:** activating SOS shows overlay + audio on every peer within 1 s; clearing removes it everywhere; `#sos` contains the event.
- **AC-CHECK:** A checks item X → B sees it ≤ 1 s; B checks item Y while A offline → A sees both after reconnect (LWW per item).
- **AC-NOTES:** A and B edit different notes concurrently → both survive; same note → exactly one wins on both peers after sync.
- **AC-MAP:** load image, calibrate with 2 points, drop waypoint → peer receives it and plots at the same pixel position given the same calibration.
- **AC-BEACRON:** encode "SOS HELP" → audio timing matches Farnsworth tables ±10 %; flash output visible; shared to peer → peer can replay.
- **AC-STATUS:** battery shows % where supported, `manual` value otherwise, `n/a` in Safari; RTT updates ≤ 15 s; last-seen ages correctly after peer disconnect.
- **AC-OFFLINE:** stop hub → banner shows `offline`, history readable, new message queued → start hub → auto-flush < 5 s.
- **AC-DESIGN:** visual review vs `DESIGN.md` — pill CTAs only, no gray body text, one block color per viewport, mono eyebrows uppercase.

## 11. Test plan

| Layer | Tool | Coverage target |
|---|---|---|
| Protocol schemas | vitest | every frame: valid + invalid cases |
| Crypto (proof/seal/open, wrong passphrase) | vitest + WebCrypto (node) | roundtrip, tamper detection, proof mismatch |
| Sync reducer + outbox | vitest | idempotency, ordering, retry states |
| Morse encoder / geo math / byte utils | vitest | table-driven |
| Repositories (better-sqlite3) | vitest against temp DB | CRUD + rev monotonicity |
| Manual/LAN | checklist in IMPLEMENTATION-PLAN §5 | 2-device scenario pass per phase |

E2E browser automation is out of scope for v1 (documented non-goal).
