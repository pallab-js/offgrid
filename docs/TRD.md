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
| `HOSTNAME` | `0.0.0.0` | bind address (all interfaces for LAN) |
| `DATA_DIR` | `./data` | SQLite + file store + logs |
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
| `POST /api/rooms/:id/channels` | `{ name }` | `{ channel }` | auth; slugified unique per room |
| `POST /api/rooms/:id/files` | raw stream | `{ fileId, rev }` | auth; headers: `X-File-Name` (URI-encoded ciphertext), `X-File-Iv` (URI-encoded IV), `X-File-Mime`, `X-File-Id` (client ULID, idempotent) |
| `GET /api/rooms/:id/files/:fileId` | — | bytes | auth; supports `Range: bytes=a-b` → 206 + `Content-Range`; `HEAD` returns metadata only |
| `DELETE /api/rooms/:id/files/:fileId` | — | `{ rev }` | auth; soft delete + unlink |
| `GET /api/rooms/:id/export` | — | JSON dump of device's local data | auth; generated **client-side** from IndexedDB (hub export is optional stretch) |

Validation: zod on every JSON body; file headers sanitized (strip path separators, cap 255 chars). Unknown routes → Next 404.

## 4. WebSocket protocol — `/ws`

### 4.1 Envelope

```ts
// client → server
{ t: FrameType, ref?: string /* clientId / correlation id */, ...payload }
// server → client
{ t: ServerFrameType, ref?: string, ...payload }
```

- `ref` is echoed on `ack`/`error` so the client can settle an outbox entry.
- Every frame validated with zod (`src/lib/protocol`); invalid → `error { code: "BAD_FRAME" }`, never crash the hub.
- Text frames only; max `MAX_FRAME_BYTES`. Binary frames rejected.

### 4.2 Client → server frames

| `t` | Payload | Server effect |
|---|---|---|
| `join` | `{ token, device: { id, name, color } }` | verify token → register connection → reply `joined` → send presence |
| `leave` | `{}` | deregister |
| `ping` | `{ ts }` | reply `pong { ts, serverTs }` |
| `msg.send` | `{ clientId, channelId, kind: "text"\|"file", body: {ct,iv}\|null, attachments?: string[], replyTo?: string }` | insert (dedupe by clientId) → `ack` → broadcast `msg.new` |
| `msg.del` | `{ clientId, id }` | soft delete → `ack` → broadcast `msg.deleted` |
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

`joined { room, channels, device, cursor, serverTime }` · `ack { ref, id, rev }` · `error { ref?, code, message }` · `pong { ts, serverTs }` · `presence { peers: Peer[] }` · `sync.batch { events: Event[], cursor, done }` · `msg.new { msg, rev }` · `msg.deleted { id, rev }` · `note.upsert`/`note.deleted` · `check.update` · `wp.upsert`/`wp.deleted` · `sos.raised`/`sos.cleared` · `file.new`/`file.deleted` · `beacon.new` · `channel.new`.

`Peer = { deviceId, name, color, battery|null, rttMs|null, lastSeen, online }`.

Error codes: `BAD_FRAME`, `BAD_TOKEN`, `BAD_PROOF`, `ROOM_NOT_FOUND`, `RATE_LIMITED`, `NOT_IN_ROOM`, `PAYLOAD_TOO_LARGE`, `INTERNAL`.

### 4.4 Presence & liveness

- Client sends `ping` every 15 s; RTT = pong latency (EMA over 5 samples).
- Hub marks peer offline after 45 s without any frame; broadcasts `presence`.
- On socket close: mark offline, broadcast.

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
  created_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL,
  UNIQUE(room_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_room_ch ON messages(room_id, channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_rev ON messages(rev);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL, device_id TEXT NOT NULL,
  name_ct TEXT NOT NULL, name_iv TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, sha256 TEXT, path TEXT NOT NULL,
  created_at INTEGER NOT NULL, deleted_at INTEGER, rev INTEGER NOT NULL
);
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

Migrations: idempotent `CREATE TABLE IF NOT EXISTS` in `schema.ts` with a `meta(schema_version)` table for future ALTERs. **DB file is gitignored**; schema lives in code.

## 6. Client data (IndexedDB) — database `offgrid` v1

| Store | Key | Contents |
|---|---|---|
| `meta` | key | `deviceId`, `profile`, `roomId`, `cursor`, `mapImage` calibration refs |
| `messages` | `id` (clientId), index `channelId+createdAt` | full decrypted message rows + sync status |
| `outbox` | `clientId` | frames awaiting ack (raw sealed payloads) |
| `files` | `id` | metadata + cached blob when `size < 32 MB` |
| `notes` / `waypoints` / `progress` / `sos` | id | decrypted mirrors |
| `channels` | id | channel list |

Write discipline: UI writes to IDB first, then socket; server ack confirms and stamps `rev`. Reducer applying server events is idempotent (`if (existing.rev >= incoming.rev) skip`).

## 7. Non-functional requirements

| ID | Requirement | Target / test |
|---|---|---|
| N1 | LAN broadcast latency | p50 < 300 ms (2 browsers, same machine) |
| N2 | Message durability | 10-min hub outage, 40 messages → all sync, no dupes |
| N3 | File transfer | 500 MB upload with progress; interrupted download resumes via Range |
| N4 | Frame validation | fuzzed/oversized frames → `error`, hub stays up (unit test) |
| N5 | Rate limit | > 60 msg/s from one connection → `RATE_LIMITED`, others unaffected |
| N6 | Startup | cold `pnpm dev` ready < 10 s; `pnpm build && pnpm start` < 3 s |
| N7 | Bundle | first-load JS < 250 KB gzipped (app routes) |
| N8 | Accessibility | axe-clean on chat/beacon/settings; 44 px targets; reduced-motion honored |
| N9 | Offline | with hub stopped: shell + history render; composer queues; reconnect flushes |
| N10 | Determinism | `pnpm lint && pnpm typecheck && pnpm test` green; no network calls at runtime |

## 8. Error handling & logging

- **Client:** socket errors surface as a `StatusPill` state (`live / reconnecting / offline`); outbox entries retry with backoff and expose `failed` only after 5 attempts (user can retry manually). Feature errors render inline (input-level), never global crash — route-level `error.tsx` boundaries everywhere.
- **Server:** try/catch per frame → `error` reply + log; uncaught exceptions logged and process kept alive (single-process hub: never `process.exit` on request errors). Log line format: `ISO level event room= device= detail` → `data/logs/hub.log` (size-rotated, 5 × 2 MB).
- **Never log** passphrases, room keys, plaintext bodies, or tokens.

## 9. Security requirements

1. Room key never leaves memory/sessionStorage; never in URLs, logs, or IDB `meta`.
2. Tokens compared by SHA-256 hash at rest; bearer only over LAN HTTP (documented: no TLS in v1 — LAN threat model).
3. Path traversal impossible: file ids are ULIDs, storage paths built server-side only, download validated against DB row.
4. Upload size enforced while streaming (abort at cap) and enforced again on disk stat.
5. Zod validation on 100% of inbound frames/bodies; unknown keys stripped.
6. No `dangerouslySetInnerHTML` for user content; search highlighting via text nodes.
7. Room-scoped authorization: every query filters by `room_id` derived from the verified token, never from client payload.

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
