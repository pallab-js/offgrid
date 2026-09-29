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

Join from another device on the same network: `http://<your-lan-ip>:3000`.

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

### Local data

Everything the hub persists lives in `./data/` (gitignored): `mesh.db` (SQLite), `files/` (uploaded bytes), `logs/`. Delete the folder to reset the hub.

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
