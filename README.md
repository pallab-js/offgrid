# OffGrid — off-grid messaging & field tools

Real-time messaging, file sharing and survival tooling for teams **beyond the reach of the internet**. One machine on the local network becomes the hub; everyone else joins from any browser. No cloud, no accounts, no external services.

> Status: **v0.1.0-alpha · in development.** See [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) for the current phase.

## Why

Field teams, expedition crews, disaster-response volunteers and remote households lose shared messaging and file drops the moment the internet goes away. Almost every group already owns the fix: a laptop or hotspot on the local network. OffGrid is the software that makes that machine useful.

## What it does (v1)

- **Channels & messaging** — real-time channels with replies, typing indicators, soft deletes and an offline outbox that syncs on reconnect.
- **File sharing** — streaming uploads to the hub with progress, resumable downloads (`Range`), in-browser previews, offline cache for small files.
- **Encrypted rooms** — a shared passphrase protects room content at rest on the hub (AES-GCM, PBKDF2 proofs); the server never learns the passphrase.
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

Production build:

```bash
pnpm build
pnpm start
```

### Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | dev server (hot reload) |
| `pnpm build` / `pnpm start` | production build / run |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | vitest unit suite |
| `pnpm exec tsx scripts/smoke-p1.ts` | end-to-end smoke against a running hub |

### Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm dev` fails with "port in use" | `PORT=3001 pnpm dev`, then join at `:3001`. |
| Other devices cannot reach the hub | Allow Node through the OS firewall on port 3000; make sure every device is on the *same* network (many Wi-Fi networks isolate clients — disable "client isolation"/"AP isolation" in the router). |
| "wrong passphrase" on join | Passphrases are case-sensitive and must match the room exactly. There is no recovery — create a new room if it is lost. |
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

TBD (repository owner to choose before the remote is published).
