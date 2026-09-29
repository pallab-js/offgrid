# PRD — OffGrid Mesh

> Product Requirements Document · v1 (alpha)
> Status: approved for build · Companion docs: [SDA](./SDA.md) · [TRD](./TRD.md) · [Implementation Plan](./IMPLEMENTATION-PLAN.md)

## 1. Problem & Opportunity

Teams operating **off the grid** — expedition crews, disaster-response volunteers, rural/remote communities, event and field crews — lose the two things modern coordination depends on most: a shared message history and a shared file drop. Consumer chat apps require internet and cloud accounts; mesh-radio hardware is expensive, low-bandwidth, and phone-hostile; USB sticks don't scale past two people.

Almost every group in these situations already owns the one piece of infrastructure that works without the internet: **a laptop or phone acting as a local Wi-Fi/hotspot hub.** OffGrid turns any machine into that hub.

**OffGrid** is a self-hosted, browser-based real-time messaging + file-sharing platform that runs entirely on a local network, with integrated survival tooling (distress beacon, offline map, checklists, morse signaling, shared journal, team status) so the same app that carries the conversation also carries the plan.

## 2. Product principles

1. **No cloud, ever.** No accounts, no email, no telemetry, no external APIs at runtime. Everything lives on the hub machine and the peers' devices.
2. **Works when the internet doesn't.** The only network required is the local one. If the local network degrades, the client keeps working locally and syncs when it reconnects.
3. **Field-practical over feature-complete.** A tired user at 2 a.m. with 12% battery must succeed on the first try. Big targets, clear states, zero jargon.
4. **Content privacy by default.** Message and note content is encrypted at rest on the hub with a room passphrase the server never learns.
5. **The design system is the product.** One monochrome editorial chrome + pastel color-block sections (per `DESIGN.md`) keeps marketing and app surfaces a single brand.

## 3. Personas

| Persona | Context | Core need |
|---|---|---|
| **Expedition lead (Maya)** | 6-person trek, phone hotspot as hub, no cell signal | One shared log: who said what, which file is current, are we all looking at the same map |
| **Volunteer responder (Dan)** | Disaster zone, intermittent power, ad-hoc team | Instant SOS that everyone sees, checklists that don't need re-downloading, roster status at a glance |
| **Remote homestead / rural crew (Priya)** | Property far from reliable internet | Durable local messaging + file drop for equipment manuals, rosters, plans — usable by non-technical family |

## 4. Scope

### 4.1 In scope (v1)

**A. Platform**
- Landing/marketing page implementing `DESIGN.md` (editorial monochrome + color blocks).
- Local profile (display name + color) — no accounts, no passwords, no email.
- **Rooms** protected by a shared passphrase; join flow proves knowledge of the passphrase without revealing it to the server.
- Hub architecture: one machine runs the server; any device on the LAN joins through its browser.

**B. Messaging**
- Channels within a room (`#general`, `#logistics`, `#sos`, user-created).
- Real-time text messages, replies, soft-delete, system messages.
- Typing indicators, presence (online/last-seen), delivery status (pending → sent → synced).
- Offline queue: messages composed offline are stored locally and sync on reconnect.
- Client-side full-text search over local (decrypted) history.

**C. File sharing**
- Streaming upload to the hub with progress; large-file friendly (no size cliff in the UI).
- File library: browse, filter, preview (image/audio/video/PDF/text), download with resume (`Range`).
- Attach files to chat messages; small files cached locally for offline viewing.

**D. Survival suite** (all six are v1 requirements)
1. **SOS / distress beacon** — one-tap raise; full-screen flashing overlay + tone on every connected peer; pinned `#sos` channel entry; explicit clear.
2. **Offline map & waypoints** — coordinate grid map with optional user-supplied map image (2-point calibration), GPS read where available, manual coordinates, waypoint create/share/sync, distance measurement, JSON/GPX import-export. **No internet map tiles.**
3. **Emergency checklists & guides** — bundled offline content (evacuation, water, first-aid basics, signaling, weather, etc.), per-room progress sync, instant search. Clearly labeled as reference material, not medical advice.
4. **Morse / beacon signaling** — text → morse with audio playback and full-screen visual flash, adjustable WPM, preset distress patterns; a morse message can be shared to peers for synchronized transmission.
5. **Shared notes / group journal** — multi-note collaborative notebook, encrypted at rest, conflict-tolerant (last-writer-wins per note).
6. **Battery & signal status board** — per-peer battery level, connection RTT, last-seen, device color/name; hub health (uptime, storage used, connected clients).

**E. Operations**
- Local data export (JSON backup) and destructive-clear with confirmation.
- Offline app-shell caching so the UI + local history remain usable if the hub briefly disappears.
- LAN discovery instructions (QR or copyable join URL) so pairing is one step.

### 4.2 Non-goals (v1)

- No cloud deployment, Docker, Kubernetes, CI/CD, or hosted multi-tenant operation.
- No internet relaying, no WebRTC/STUN/TURN fallback across networks (LAN only).
- No native mobile apps (responsive web only).
- No end-to-end encryption *between peers* (server relays ciphertext at rest, but the hub process can decrypt nothing; content is not protected from a hostile hub operator in real time — see SDA threat model).
- No encrypted **file bytes** on the hub in v1 (message/note content is encrypted; files are documented as plaintext at rest — stretch goal in P5).
- No message edit history, voice/video calls, bots, plugins, or app-store distribution.
- No formal security audit; crypto is standard WebCrypto primitives, documented but unaudited.
- No dark mode (per `DESIGN.md`; navy block + inverse surfaces provide the dark register).

### 4.3 Success criteria

| # | Criterion | Measure |
|---|---|---|
| S1 | Two devices on one LAN can exchange messages | < 300 ms median broadcast latency on LAN |
| S2 | Hub join is a single-screen flow | Passphrase + name; ≤ 3 interactions |
| S3 | Offline behavior is honest and safe | Compose offline → auto-sync on reconnect; zero message loss in a 10-min disconnect test |
| S4 | Large file transfer works | 500 MB file completes with visible progress; download supports resume |
| S5 | Field-readability | All primary CTAs ≥ 44 px tap height; body copy never below 16 px |
| S6 | Zero external runtime calls | DevTools network panel shows only hub-origin requests after load |
| S7 | Quality gates | `pnpm lint`, `tsc --noEmit`, `pnpm test` all green on every phase commit |

## 5. User stories (prioritized)

**MoSCoW:** M = must (v1), S = should (v1 if time), C = could (stretch), W = won't (v1)

### Must
- As a field lead, I create a room with a passphrase and share a join URL so my team enters the same private space.
- As a teammate, I pick a display name and color, enter the passphrase once per session, and see the channel list instantly.
- As a sender, I see my message appear immediately with a status that changes from pending → synced.
- As an offline user, my messages queue and send themselves when the hub returns.
- As any peer, I receive messages in real time without refreshing.
- As a teammate, I upload a file with progress and others can download it from the library.
- As anyone, one tap on **SOS** flashes and sounds an alert on every connected device until cleared.
- As a teammate, I mark checklist items and everyone sees the state.
- As a teammate, I drop a waypoint and it appears on my teammates' maps.
- As a teammate, I write a note and it syncs; a concurrent edit by another resolves without data loss.
- As a user, I see peers' battery/connection/last-seen status.
- As a user, I can export or wipe my local data.

### Should
- As a sender, I reply to a specific message and the thread shows the reference.
- As a reader, I search my local history and jump to a hit.
- As a user, I attach a file to a message.
- As a user, I transmit morse visually (screen flash) and audibly with adjustable speed.
- As a user, I load a local map image and calibrate it to plot real coordinates.
- As a returning user, the app shell and my local history load even if the hub is briefly down.

### Could (stretch)
- As a user, I encrypt file bytes at rest on the hub.
- As a user, I scan a QR code to join instead of typing a URL.
- As a user, I see read receipts per peer.
- As a user, reactions on messages.

### Won't (v1)
- Cross-internet relay, voice/video, native apps, plugin system, multi-hub federation.

## 6. UX surfaces

| Route | Purpose | Color-block register |
|---|---|---|
| `/` | Marketing landing (DESIGN.md editorial) | lime → navy → coral rhythm |
| `/chat` | Channels + message thread + composer | white canvas (monochrome) |
| `/files` | File library, upload, previews | white + surface-soft tiles |
| `/notes` | Shared journal | block-cream |
| `/checklist` | Checklists & guides | block-lime |
| `/map` | Grid/map + waypoints | block-navy panel |
| `/beacon` | SOS + morse signaling | block-coral + single magenta CTA |
| `/status` | Peer status board | block-mint |
| `/settings` | Profile, room, data export/wipe | white canvas |

First-run flow: **landing → create/join room → profile → app**. A persistent top bar shows room name, hub connection state, and the SOS action (always one tap away).

## 7. Dependencies & risks

| Risk | Impact | Mitigation |
|---|---|---|
| Custom server interferes with Next dev HMR | Dev friction | Upgrade router forwards everything except `/ws` to Next; verified in P1 |
| Battery API absent in Safari/Firefox | Status board incomplete | Manual battery entry fallback + clear "unavailable" state |
| Passphrase forgotten | Room unreadable (by design) | Explicit warning at creation; local export still possible while unlocked |
| Long hub downtime | Peers hold divergent queues | Append-only sync + monotonic revisions; full-state reconciler in P5 |
| Scope pressure on 6 survival tools | Delayed delivery | Each tool independently shippable in P4; checklists/guides are static content |

## 8. Release & support

- Distributed as a git repo; run locally with `pnpm install && pnpm dev` (or `pnpm build && pnpm start`).
- Version tag per phase completion; changelog in git history.
- No telemetry; support = README + docs.
