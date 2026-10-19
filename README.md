# OffGrid

[![CI](https://github.com/pallab-js/offgrid/actions/workflows/ci.yml/badge.svg)](https://github.com/pallab-js/offgrid/actions/workflows/ci.yml)

Messaging, file sharing and survival tools for teams **beyond the reach of the internet**. One machine on the local network becomes the hub; everyone else joins from a browser. No cloud, no accounts, no external services.

> Status: **v0.1.0-alpha** — local-first alpha, run the hub yourself. Roadmap: [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md).

## Features

- **Channels** — real-time messaging with replies, typing indicators, soft deletes and an offline outbox that syncs on reconnect.
- **Files** — streaming uploads, resumable downloads, in-browser previews, offline cache for small files.
- **Encrypted rooms** — a shared passphrase protects content at rest on the hub (AES-GCM, PBKDF2); the server never sees it. A compromised passphrase can be rotated room-wide without losing history.
- **Survival suite** — SOS beacon, offline map + waypoints, checklists/guides, morse/beacon signaling, shared notes, battery/signal status board.
- **Local-first** — every device keeps an IndexedDB mirror of history: the app stays readable and queues writes while the hub is down.

## Quickstart

Requires **Node ≥ 20.9** and **pnpm ≥ 10**.

```bash
pnpm install
pnpm dev              # hub + app on http://localhost:3000
```

**Join from another device:** run the hub on a machine everyone can reach (`pnpm dev`, or `pnpm build && pnpm start` for production), find its LAN address (`ip addr` / `ipconfig` / System Settings → Network), then open `http://<hub-ip>:3000` on each device — create a room on one, join it on the others with a display name and the **passphrase**. Write the passphrase down: it is the only secret, and there is no recovery.

Configuration (port, bind address, storage, logging, TLS) is documented in [.env.example](.env.example) — the hub reads env vars from the shell, it does not auto-load `.env`.

### TLS for untrusted networks

```bash
ENABLE_TLS=true TLS_CERT=/path/to/cert.pem TLS_KEY=/path/to/key.pem pnpm start
```

App, API and WebSocket switch to `https`/`wss` automatically.

## Security model

The full analysis is in [docs/SDA.md](docs/SDA.md). In short:

- **The network is cleartext by default** — anyone on the LAN can see ciphertext, file bytes, salts and tokens. That matches the trusted-LAN threat model; enable TLS on networks you don't control.
- **Always on:** join guesses rate-limited (10/min per IP+room), device identity bound to its server-issued token, tokens expire after 30 days of disuse and are revoked — live connections included — on leave or wipe, every frame and body schema-validated.
- **Moderation, not hierarchy** — the first device to join a room moderates it: delete any message, clear join notices, revoke a lost device. Everyone holding the passphrase stays equal (Settings → Moderation).
- **Passphrase compromise? Rotate it** — Settings → Passphrase swaps the room's salt and verifier, revokes every token and disconnects everyone; history stays readable via a re-wrapped key. Assume an old passphrase holder saw what existed before.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | dev server (hot reload) |
| `pnpm build` / `pnpm start` | production build / run |
| `pnpm typecheck` / `pnpm lint` | `tsc --noEmit` / ESLint (zero warnings) |
| `pnpm test` | vitest unit suite |
| `pnpm exec tsx scripts/smoke-p1.ts` | end-to-end smoke against a running hub |

Live scripts (`smoke-*`, `n5-*`, `verify-*`) need a running hub (`HUB=http://host:port`, default `localhost:3000`) and **Node ≥ 22**; `scripts/verify-{revoke,moderation,rotate}.ts` re-check the security flows. Every push runs [CI](.github/workflows/ci.yml): typecheck, lint, tests, production build — then a live hub verification.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm dev` fails with "port in use" | `PORT=3001 pnpm dev`, join at `:3001`. |
| Other devices can't reach the hub | Same network, and allow Node through the OS firewall (port 3000); disable Wi-Fi "client isolation"/"AP isolation". |
| "wrong passphrase" on join | Passphrases are case-sensitive — including after a rotation. There is no recovery: create a new room if it is lost. |
| Messages stay "pending" | The offline banner has a **Retry now** button; failed frames were rejected — check the hub log. |
| Wipe this device / reset the hub | Settings → Danger zone → type `WIPE`; stop the hub and delete `./data/`. |

## Documentation

| Doc | Contents |
|---|---|
| [docs/PRD.md](docs/PRD.md) | product requirements, personas, scope |
| [docs/SDA.md](docs/SDA.md) | architecture, data flows, crypto & threat model |
| [docs/TRD.md](docs/TRD.md) | stack, WS protocol, REST, SQLite schema, NFRs |
| [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) | phases, gates, acceptance checklists |
| [DESIGN.md](DESIGN.md) | visual system (tokens in `src/app/globals.css`) |

## License

[MIT](LICENSE) — see [LICENSE](LICENSE).
