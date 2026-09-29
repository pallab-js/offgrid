/* P1 spine smoke test — run with the dev hub already listening:
 *   pnpm dev &
 *   pnpm exec tsx scripts/smoke-p1.ts
 */
import WebSocket from "ws";
import { deriveRoomKey, computeProof } from "../src/lib/crypto/room";
import { randomB64 } from "../src/lib/crypto/base64";
import { ulid } from "../src/lib/utils/id";
import { c2sSchema, s2cSchema, type ServerFrame } from "../src/lib/protocol";

const BASE = process.env.HUB ?? "http://localhost:3000";
const results: Array<[string, boolean, string?]> = [];

function check(name: string, ok: boolean, detail = ""): void {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, init);
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

class TestClient {
  ws!: WebSocket;
  frames: ServerFrame[] = [];
  private waiters: Array<{ match: (f: ServerFrame) => boolean; resolve: (f: ServerFrame) => void }> = [];

  async connect(token: string, device: { id: string; name: string; color: string }): Promise<ServerFrame> {
    this.ws = new WebSocket(BASE.replace("http", "ws") + "/ws");
    this.ws.on("message", (data) => {
      const parsed = s2cSchema.safeParse(JSON.parse(data.toString()));
      if (!parsed.success) {
        check("server frame validates", false, JSON.stringify(parsed.error.issues[0]));
        return;
      }
      const frame = parsed.data;
      this.frames.push(frame);
      this.waiters = this.waiters.filter((w) => {
        if (w.match(frame)) {
          w.resolve(frame);
          return false;
        }
        return true;
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
    this.send({ t: "join", token, device });
    return this.waitFor((f) => f.t === "joined", 4000, "joined frame");
  }

  send(frame: unknown): void {
    const parsed = c2sSchema.safeParse(frame);
    if (!parsed.success) {
      check("client frame schema", false, parsed.error.issues[0]?.message ?? "");
      return;
    }
    this.ws.send(JSON.stringify(parsed.data));
  }

  waitFor(match: (f: ServerFrame) => boolean, ms = 4000, label = "frame"): Promise<ServerFrame> {
    const existing = this.frames.find(match);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), ms);
      this.waiters.push({
        match,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function main(): Promise<void> {
  const roomId = ulid();
  const salt = randomB64(16);
  const passphrase = "field-passphrase-1";
  const key = await deriveRoomKey(passphrase, salt);
  const proof = await computeProof(key, roomId);

  // 1. health
  const health = await api("/api/health").then((r) => r.json());
  check("GET /api/health", health.ok === true, `rev=${health.rev}`);

  // 2. create room
  const create = await api("/api/rooms", json({ roomId, name: "Field-1", salt, proof }));
  check("POST /api/rooms → 201", create.status === 201, `status=${create.status}`);
  const created = (await create.json()) as { channels: Array<{ name: string; rev: number }> };
  check("default channels created", created.channels.length === 3);

  // 3. meta
  const meta = await api(`/api/rooms/${roomId}/meta`).then((r) => r.json());
  check("GET meta returns salt", meta.salt === salt);

  // 4. join: wrong proof then right proof
  const bad = await api(`/api/rooms/${roomId}/join`, json({
    deviceId: ulid(),
    name: "Eve",
    color: "#efd4d4",
    proof: randomB64(32),
  }));
  check("wrong passphrase → 403", bad.status === 403, `status=${bad.status}`);

  const deviceA = { id: ulid(), name: "Maya", color: "#c5b0f4" };
  const joinA = await api(`/api/rooms/${roomId}/join`, json({ deviceId: deviceA.id, name: deviceA.name, color: deviceA.color, proof }));
  check("join → token", joinA.status === 200, `status=${joinA.status} ${(await joinA.clone().text()).slice(0,120)}`);
  const { token: tokenA } = (await joinA.json()) as { token: string };

  const deviceB = { id: ulid(), name: "Dan", color: "#c8e6cd" };
  const joinB = await api(`/api/rooms/${roomId}/join`, json({ deviceId: deviceB.id, name: deviceB.name, color: deviceB.color, proof }));
  const { token: tokenB } = (await joinB.json()) as { token: string };

  // 5. websockets
  const a = new TestClient();
  const joinedA = await a.connect(tokenA, deviceA);
  check("A joined", joinedA.t === "joined" && joinedA.channels.length === 3);

  const b = new TestClient();
  const joinedB = await b.connect(tokenB, deviceB);
  check("B joined", joinedB.t === "joined");

  const presence = await a.waitFor((f) => f.t === "presence" && f.peers.length === 2, 4000, "presence(2)");
  check("A sees 2 peers", presence.t === "presence" && presence.peers.length === 2);

  // 6. ping → pong
  a.send({ t: "ping", ts: Date.now() });
  const pong = await a.waitFor((f) => f.t === "pong", 3000, "pong");
  check("ping → pong", pong.t === "pong");

  // 7. sync pull returns channel events
  a.send({ t: "sync.pull", cursor: 0 });
  const batch = await a.waitFor((f) => f.t === "sync.batch", 3000, "sync.batch");
  check(
    "sync.batch carries channels",
    batch.t === "sync.batch" && batch.events.filter((e) => e.t === "channel.new").length === 3,
    batch.t === "sync.batch" ? `events=${batch.events.length} done=${batch.done}` : "",
  );

  // 8. channel.create → ack to A, event to B
  const clientId = ulid();
  a.send({ t: "channel.create", clientId, name: "Water Run" });
  const ack = await a.waitFor((f) => f.t === "ack" && f.ref === clientId, 3000, "ack");
  check("channel.create acked", ack.t === "ack");
  const newChannel = await b.waitFor((f) => f.t === "channel.new", 3000, "channel.new");
  check("B receives channel.new", newChannel.t === "channel.new");

  // 9. phase-gated frame rejected, hub alive
  a.send({ t: "msg.send", clientId: ulid(), channelId: "x", kind: "text", body: null, attachments: [] });
  const notImpl = await a.waitFor((f) => f.t === "error" && f.code === "NOT_IMPLEMENTED", 3000, "NOT_IMPLEMENTED");
  check("msg.send gated → NOT_IMPLEMENTED", notImpl.t === "error");

  // 10. invalid frame rejected without dropping the socket
  a.ws.send(JSON.stringify({ t: "nonsense" }));
  const badFrame = await a.waitFor((f) => f.t === "error" && f.code === "BAD_FRAME", 3000, "BAD_FRAME");
  check("invalid frame → BAD_FRAME, socket alive", badFrame.t === "error" && a.ws.readyState === WebSocket.OPEN);

  a.close();
  b.close();

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error("SMOKE FAILED:", error);
  process.exit(1);
});
