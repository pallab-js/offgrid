import WebSocket from "ws";
import { deriveRoomKey, computeProof } from "../src/lib/crypto/room";
import { randomB64 } from "../src/lib/crypto/base64";
import { ulid } from "../src/lib/utils/id";
import { s2cSchema, type ServerFrame } from "../src/lib/protocol";

const BASE = process.env.HUB ?? "http://localhost:3000";

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function collect(ws: WebSocket, sink: ServerFrame[]): void {
  ws.on("message", (data) => {
    const parsed = s2cSchema.safeParse(JSON.parse(data.toString()));
    if (parsed.success) sink.push(parsed.data);
  });
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

async function main(): Promise<void> {
  const roomId = ulid();
  const passphrase = "rate-limit-passphrase";
  const salt = randomB64(16);
  const key = await deriveRoomKey(passphrase, salt);
  const proof = await computeProof(key, roomId);
  const create = await fetch(`${BASE}/api/rooms`, json({ roomId, name: "N5", salt, proof }));
  if (create.status !== 201) {
    console.log("room create failed", create.status);
    process.exit(1);
  }

  const floodId = ulid();
  const join = await fetch(
    `${BASE}/api/rooms/${encodeURIComponent(roomId)}/join`,
    json({ deviceId: floodId, name: "Flooder", color: "#111111", proof }),
  );
  if (join.status !== 200) {
    const text = await join.text();
    console.log("join failed", join.status, text.slice(0, 200));
    process.exit(1);
  }
  const { token } = (await join.json()) as { token: string };

  const ws = new WebSocket(BASE.replace("http", "ws") + "/ws");
  const frames: ServerFrame[] = [];
  collect(ws, frames);
  await waitOpen(ws);
  ws.send(JSON.stringify({ t: "join", token, device: { id: floodId, name: "Flooder", color: "#111111" } }));
  await new Promise((r) => setTimeout(r, 400));
  const joined = frames.find((f) => f.t === "joined");
  if (!joined || joined.t !== "joined") {
    console.log("no joined frame");
    process.exit(1);
  }
  const general = joined.channels.find((c) => c.name === "general")!;
  const body = { ct: "Yg==", iv: "aXY=" };

  const before = frames.filter((f) => f.t === "error").length;
  for (let i = 0; i < 400; i++) {
    ws.send(
      JSON.stringify({
        t: "msg.send",
        clientId: ulid(),
        channelId: general.id,
        kind: "text",
        body,
        attachments: [],
      }),
    );
  }
  await new Promise((r) => setTimeout(r, 2500));
  const errors = frames.slice(before).filter((f) => f.t === "error");
  const rateLimited = errors.filter((f) => f.t === "error" && f.code === "RATE_LIMITED");
  const stillOpen = ws.readyState === WebSocket.OPEN;

  const bystanderId = ulid();
  const joinB = await fetch(
    `${BASE}/api/rooms/${encodeURIComponent(roomId)}/join`,
    json({ deviceId: bystanderId, name: "Bystander", color: "#222222", proof }),
  );
  const { token: tokenB } = (await joinB.json()) as { token: string };
  const wsB = new WebSocket(BASE.replace("http", "ws") + "/ws");
  const framesB: ServerFrame[] = [];
  collect(wsB, framesB);
  await waitOpen(wsB);
  wsB.send(JSON.stringify({ t: "join", token: tokenB, device: { id: bystanderId, name: "Bystander", color: "#222222" } }));
  await new Promise((r) => setTimeout(r, 400));
  const ref = ulid();
  wsB.send(
    JSON.stringify({ t: "msg.send", clientId: ref, channelId: general.id, kind: "text", body, attachments: [] }),
  );
  await new Promise((r) => setTimeout(r, 2000));
  const bystanderAcked = framesB.some((f) => f.t === "ack" && f.ref === ref);

  console.log(
    `errors=${errors.length} rate_limited=${rateLimited.length} socket_open=${stillOpen} bystander_acked=${bystanderAcked}`,
  );
  const ok = rateLimited.length > 0 && stillOpen && bystanderAcked;
  console.log(ok ? "N5 PASS" : "N5 FAIL");
  ws.close();
  wsB.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
