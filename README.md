# OffGrid — off-grid messaging & field tools

[![CI](https://github.com/pallab-js/offgrid/actions/workflows/ci.yml/badge.svg)](https://github.com/pallab-js/offgrid/actions/workflows/ci.yml)

Real-time messaging, file sharing and survival tooling for teams **beyond the reach of the internet**. One machine on the local network becomes the hub; everyone else joins from any browser. No cloud, no accounts, no external services.

> Status: **v0.1.0-alpha.** Local-only alpha — run the hub yourself and join from the LAN. See [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) for the roadmap.

## Why

Field teams, expedition crews, disaster-response volunteers and remote households lose shared messaging and file drops the moment the internet goes away. Almost every group already owns the fix: a laptop or hotspot on the local network. OffGrid is the software that makes that machine useful.

## What it does (v1)

- **Channels & messaging** — real-time channels with replies, typing indicators, soft deletes and an offline outbox that syncs on reconnect. The first device to join a room is its moderator: it can remove any member's message, clear join notices and revoke a lost device.
- **File sharing** — streaming uploads to the hub with progress, resumable downloads (`Range`), in-browser previews, offline cache for small files.
- **Encrypted rooms** — a shared passphrase protects room content at rest on the hub (AES-GCM, PBKDF2 proofs); the server never learns the passphrase. A compromised passphrase can be rotated room-wide without losing history.
- **Survival suite** — SOS distress beacon, offline map + waypoints, bundled checklists/guides, morse/beacon signaling, shared notes, battery/signal status board.
- **Local-first** — every device keeps its own IndexedDB mirror of history, so the app stays readable (and queues writes) when the hub is down.

## Quickstart

Requirements: **Node ≥ 20.9**, **pnpm ≥ 10**.

```bash
pnpm install
pnpm dev            # hub + app on http://localhost:3000
```

### Join from another device (LAN walkthrough)

1. **Pick the hub.** Any machine on the Wi-Fi/Ethernet network works — a laptop is typical. Install Node ≥ 20.9 and pnpm ≥ 10 on it.
2. **Start the hub.** `pnpm dev` (development) or `pnpm build && pnpm start` (production) on that machine.
3. **Find its address.** `ip addr` (Linux), `ipconfig` (Windows) or System Settings → Network (macOS) — e.g. `192.168.1.24`.
4. **Create a room** by opening `http://192.168.1.24:3000` on the hub machine (or any device) and choosing *Create room*. Pick a room name and a **passphrase** — write the passphrase down; it is the only secret.
5. **Join from other devices.** Each teammate opens `http://192.168.1.24:3000`, chooses *Join room*, enters the room name and passphrase, picks a display name and color. Devices appear in the status board within seconds.
6. **Keep the hub awake** while the team works. If the hub sleeps, everyone keeps working — history stays readable, changes queue locally and re-sync when it returns.

The passphrase never reaches the server: it derives an AES-GCM key in each browser (PBKDF2, 210k iterations) that encrypts message bodies, notes, waypoint labels and file names at rest in the hub's SQLite database.

### Security model (read before field use)

- **Room content is encrypted at rest, but the network is cleartext by default.** On a Wi-Fi network you don't control, a passive observer can see message ciphertext, file bytes, room salts, join proofs (which enable *offline* passphrase guessing) and bearer tokens — and an active attacker can tamper with the app code served over plain HTTP. This matches the v1 threat model of a trusted/controlled LAN; the full analysis is in [docs/SDA.md](docs/SDA.md).
- **On a network you don't control, enable TLS:** `ENABLE_TLS=true TLS_CERT=/path/to/cert.pem TLS_KEY=/path/to/key.pem pnpm start`. The app, API and WebSocket all follow automatically (`https`/`wss`). Self-signed certificates show a warning on each joining device until you install your CA there.
- Always-on protections regardless of transport: join guesses are rate-limited (10/min per IP+room), device identity is bound to its token server-side (a stolen token cannot impersonate another device), tokens expire after 30 days of disuse (the window slides on every authenticated use) and are revoked server-side — including any live connections riding them — when you Leave the room or wipe, and every frame/body is schema-validated.
- **Moderation is a convenience, not a hierarchy.** The first device to join a room becomes its moderator: it can delete any member's message, clear join notices (the only way system messages ever leave the room), and revoke a lost device's access server-side. Settings → Moderation manages this. Because everyone holding the passphrase is still equal — a revoked device can rejoin with the passphrase, and a hostile moderator can be answered by rotating it — moderation never replaces the passphrase as the root of trust.
- **Compromised passphrase? Rotate it** (Settings → Passphrase). Rotation swaps the room's salt and verifier, revokes *every* token in the room, and disconnects live members — only holders of the new passphrase can get back in. Existing history stays readable to rejoiners: the old room key is re-wrapped under the new one and delivered on join, so nothing is lost — but assume anyone who had the old passphrase read (or copied) what existed before the rotation. Invite links keep working: they carry only the room id.
- There is **no passphrase recovery** — see Troubleshooting; and use Settings → Danger zone to wipe a device that leaves service.

Production build:

```bash
pnpm build
pnpm start
```

Every environment variable (port, bind address, storage, TLS, logging) is documented in [.env.example](.env.example) — the hub reads them from the shell, it does not auto-load `.env`.

### Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | dev server (hot reload) |
| `pnpm build` / `pnpm start` | production build / run |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | vitest unit suite |
| `pnpm exec tsx scripts/smoke-p1.ts` | end-to-end smoke against a running hub |
| `pnpm exec tsx scripts/n5-rate-limit.ts` | N5 acceptance: rate-limit flood + bystander check |
| `pnpm exec tsx scripts/verify-revoke.ts` | live token expiry/revocation checks (kills live WS sessions) |
| `pnpm exec tsx scripts/verify-moderation.ts` | live moderation-flow checks (mods, notice clearing, targeted revoke) |
| `pnpm exec tsx scripts/verify-rotate.ts` | live passphrase-rotation checks (rekey, key-history unwrapping) |

The live scripts (`smoke-*`, `n5-*`, `verify-*`) need a running hub — `pnpm dev` in another terminal — and default to `http://localhost:3000`; point them elsewhere with `HUB=http://host:port`. They use Node's global `WebSocket`, so run them on **Node ≥ 22**.

### Continuous integration

Every push to `main` and every pull request runs [`.github/workflows/ci.yml`](.github/workflows/ci.yml): install → typecheck → lint → unit tests → production build, then a **live end-to-end gate** — the built hub boots on an ephemeral data dir and `scripts/verify-revoke.ts`, `verify-moderation.ts` and `verify-rotate.ts` drive it over real HTTP + WebSocket. A red badge means the hub itself, not just the unit suite, is broken.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm dev` fails with "port in use" | `PORT=3001 pnpm dev`, then join at `:3001`. |
| Other devices cannot reach the hub | Allow Node through the OS firewall on port 3000; make sure every device is on the *same* network (many Wi-Fi networks isolate clients — disable "client isolation"/"AP isolation" in the router). |
| "wrong passphrase" on join | Passphrases are case-sensitive and must match the room exactly — including after a moderator rotated it (Settings → Passphrase; rejoin with the new one). There is no recovery — create a new room if it is lost. |
| A device never appears in presence | It joined a *different* room, or the tab is asleep — reload it. Check the hub terminal for `ws` errors. |
| Changes stay "pending" after reconnect | The header shows the offline banner with a **Retry now** button; open it. If frames show as failed, the hub rejected them — check its log. |
| App looks stale after an update | The service worker caches the shell (production only): hard-reload once, or close all tabs and reopen. |
| Wipe this device | Settings → Danger zone → type `WIPE`. |
| Reset the hub | Stop it and delete `./data/` (see below). |

### Local data locations

- **Hub:** `./data/` (gitignored) — `mesh.db` (SQLite: rooms, messages, file rows, revisions), `files/` (uploaded bytes), `logs/hub.log`.
- **Each browser:** IndexedDB database `offgrid` (history mirror, outbox, cached small files) + `localStorage`/`sessionStorage` (profile, room membership, cached room key for the tab session). Export or wipe these from **Settings**.

## Design

The visual system is defined in [DESIGN.md](DESIGN.md) — monochrome editorial chrome, oversized pastel color-block sections, pill-only CTAs, Inter Variable + JetBrains Mono. Tokens are implemented in `src/app/globals.css` (`@theme`).

## Documentation

| Doc | Contents |
|---|---|
| [docs/PRD.md](docs/PRD.md) | product requirements, personas, scope, success criteria |
| [docs/SDA.md](docs/SDA.md) | architecture, data flows, crypto & threat model, decisions |
| [docs/TRD.md](docs/TRD.md) | tech spec: stack, WS protocol, REST, SQLite schema, NFRs |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | phases, gates, acceptance checklists |

## Non-goals (v1)

No cloud deployment, Docker, internet relaying, native apps, voice/video, or encrypted file bytes on the hub. Details in the PRD.

## License

[MIT](LICENSE) — see [LICENSE](LICENSE).
