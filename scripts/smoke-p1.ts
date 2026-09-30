/* P1+P2 smoke test — run with the dev hub already listening:
 *   pnpm dev &
 *   pnpm exec tsx scripts/smoke-p1.ts
 */
import WebSocket from "ws";
import { deriveRoomKey, computeProof } from "../src/lib/crypto/room";
import { randomB64 } from "../src/lib/crypto/base64";
import { ulid } from "../src/lib/utils/id";
import { c2sSchema, s2cSchema, type ServerFrame } from "../src/lib/protocol";
import { FILE_CHUNK_BYTES, fileCipherSize } from "../src/lib/protocol/constants";
import {
  decryptFileFrameWith,
  encryptFileChunkWith,
  frameCount,
  frameOffset,
} from "../src/lib/crypto/file";

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

  // 9. P2 messaging: system notice, send, dedupe, delete, unknown channel
  const systemMsg = a.frames.find((f) => f.t === "msg.new" && f.msg.kind === "system");
  check("join system message emitted", Boolean(systemMsg));

  const channels = joinedA.t === "joined" ? joinedA.channels : [];
  const general = channels.find((c) => c.name === "general")!;
  const msgClientId = ulid();
  const body = { ct: "ZW5jb2RlZC1jaXBoZXJ0ZXh0", iv: "aXZpdg==" };
  a.send({ t: "msg.send", clientId: msgClientId, channelId: general.id, kind: "text", body, attachments: [] });
  const msgAck = await a.waitFor((f) => f.t === "ack" && f.ref === msgClientId, 3000, "msg ack");
  check("msg.send acked", msgAck.t === "ack");
  await a.waitFor((f) => f.t === "msg.new" && f.msg.clientId === msgClientId, 3000, "msg echo");
  const seenB = await b.waitFor((f) => f.t === "msg.new" && f.msg.clientId === msgClientId, 3000, "msg to B");
  check("B receives msg.new", seenB.t === "msg.new");

  a.send({ t: "msg.send", clientId: msgClientId, channelId: general.id, kind: "text", body, attachments: [] });
  await a.waitFor((f) => f.t === "ack" && f.ref === msgClientId && msgAck.t === "ack" && f.rev >= 0, 3000, "dup ack");
  await new Promise((r) => setTimeout(r, 250));
  const dupCount = b.frames.filter((f) => f.t === "msg.new" && f.msg.clientId === msgClientId).length;
  check("duplicate clientId deduped (no rebroadcast)", dupCount === 1, `count=${dupCount}`);

  a.send({ t: "msg.send", clientId: ulid(), channelId: "nope", kind: "text", body, attachments: [] });
  const unknownChannel = await a.waitFor((f) => f.t === "error" && f.code === "BAD_FRAME", 3000, "unknown channel");
  check("msg.send to unknown channel → BAD_FRAME", unknownChannel.t === "error");

  const delClientId = ulid();
  if (msgAck.t === "ack") {
    a.send({ t: "msg.del", clientId: delClientId, id: msgAck.id });
    const delAck = await a.waitFor((f) => f.t === "ack" && f.ref === delClientId, 3000, "del ack");
    check("msg.del acked", delAck.t === "ack");
    const tombstone = await b.waitFor(
      (f) => f.t === "msg.new" && msgAck.t === "ack" && f.msg.id === msgAck.id && f.msg.deletedAt !== null,
      3000,
      "tombstone to B",
    );
    check("delete broadcasts tombstone", tombstone.t === "msg.new");
  }

  // 10. P3 files: upload, idempotent retry, announce, range, head, delete
  const { createHash } = await import("node:crypto");
  const fileId = ulid();
  const fileBytes = Buffer.from(`water-cache-notes-${"x".repeat(500)}`);
  const fileHeaders = {
    authorization: `Bearer ${tokenA}`,
    "content-type": "application/octet-stream",
    "x-file-id": fileId,
    "x-file-name": encodeURIComponent("ZW5jLW5hbWUtY3Q="),
    "x-file-iv": encodeURIComponent("aXZpdg=="),
    "x-file-mime": "text/plain",
  };
  const upload = await api(`/api/rooms/${roomId}/files`, {
    method: "POST",
    headers: fileHeaders,
    body: fileBytes,
  });
  check("upload → 201", upload.status === 201, `status=${upload.status}`);
  const uploaded = (await upload.json()) as { fileId: string; rev: number; sha256: string };
  const expectedSha = createHash("sha256").update(fileBytes).digest("hex");
  check("upload sha256 matches", uploaded.sha256 === expectedSha);

  const retryUpload = await api(`/api/rooms/${roomId}/files`, {
    method: "POST",
    headers: fileHeaders,
    body: fileBytes,
  });
  const retried = (await retryUpload.json()) as { existing?: boolean };
  check(
    "re-upload same id → 200 existing",
    retryUpload.status === 200 && retried.existing === true,
    `status=${retryUpload.status}`,
  );

  const announceRef = ulid();
  a.send({ t: "file.announce", clientId: announceRef, fileId });
  const fileAck = await a.waitFor((f) => f.t === "ack" && f.ref === announceRef, 3000, "file ack");
  check("file.announce acked", fileAck.t === "ack");
  const fileNew = await b.waitFor((f) => f.t === "file.new" && f.file.id === fileId, 3000, "file.new");
  check("B receives file.new", fileNew.t === "file.new");

  const ranged = await api(`/api/rooms/${roomId}/files/${fileId}`, {
    headers: { authorization: `Bearer ${tokenA}`, range: "bytes=10-19" },
  });
  const rangedBytes = Buffer.from(await ranged.arrayBuffer());
  check(
    "range → 206 + slice",
    ranged.status === 206 &&
      (ranged.headers.get("content-range") ?? "").startsWith(`bytes 10-19/${fileBytes.length}`) &&
      rangedBytes.equals(fileBytes.subarray(10, 20)),
    `status=${ranged.status}`,
  );

  const full = await api(`/api/rooms/${roomId}/files/${fileId}`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const fullBytes = Buffer.from(await full.arrayBuffer());
  check(
    "full download checksum equal",
    createHash("sha256").update(fullBytes).digest("hex") === expectedSha,
  );

  const head = await api(`/api/rooms/${roomId}/files/${fileId}`, {
    method: "HEAD",
    headers: { authorization: `Bearer ${tokenB}` },
  });
  check(
    "HEAD metadata",
    head.status === 200 && head.headers.get("x-file-size") === String(fileBytes.length),
    `size=${head.headers.get("x-file-size")}`,
  );

  const delFile = await api(`/api/rooms/${roomId}/files/${fileId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const delPayload = (await delFile.json()) as { rev?: number };
  check("DELETE file → rev", delFile.status === 200 && (delPayload.rev ?? 0) > 0);
  const fileGoneEvent = await b.waitFor((f) => f.t === "file.deleted" && f.id === fileId, 3000, "file.deleted");
  check("B receives file.deleted", fileGoneEvent.t === "file.deleted");

  const afterDelete = await api(`/api/rooms/${roomId}/files/${fileId}`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  check("deleted file → 404", afterDelete.status === 404, `status=${afterDelete.status}`);

  // 11. P4 survival suite: notes, checklist, waypoints, SOS, beacon
  const cipher = { ct: "ZW5jb2RlZC1jaXBoZXJ0ZXh0", iv: "aXZpdg==" };

  const noteRef = ulid();
  a.send({ t: "note.save", clientId: noteRef, title: cipher, body: cipher, updatedAt: Date.now() });
  const noteAck = await a.waitFor((f) => f.t === "ack" && f.ref === noteRef, 3000, "note ack");
  check("note.save acked", noteAck.t === "ack");
  const noteUpsert = await b.waitFor((f) => f.t === "note.upsert", 3000, "note.upsert");
  check("B receives note.upsert", noteUpsert.t === "note.upsert");

  const noteDelRef = ulid();
  a.send({ t: "note.del", clientId: noteDelRef, id: noteAck.t === "ack" ? noteAck.id : "missing", updatedAt: Date.now() + 1 });
  const noteDelAck = await a.waitFor((f) => f.t === "ack" && f.ref === noteDelRef, 3000, "note.del ack");
  check("note.del acked", noteDelAck.t === "ack");
  const noteGone = await b.waitFor((f) => f.t === "note.deleted", 3000, "note.deleted");
  check("B receives note.deleted", noteGone.t === "note.deleted");

  const checkRef = ulid();
  a.send({ t: "check.set", clientId: checkRef, itemId: "water-food.1", checked: true, updatedAt: Date.now() });
  const checkAck = await a.waitFor((f) => f.t === "ack" && f.ref === checkRef, 3000, "check ack");
  check("check.set acked", checkAck.t === "ack");
  const checkEvt = await b.waitFor((f) => f.t === "check.update" && f.itemId === "water-food.1", 3000, "check.update");
  check(
    "B receives check.update",
    checkEvt.t === "check.update" && checkEvt.checked === true,
  );

  const wpRef = ulid();
  a.send({
    t: "wp.save",
    clientId: wpRef,
    lat: 12.9716,
    lng: 77.5946,
    gx: null,
    gy: null,
    label: cipher,
    color: "#ff3d8b",
    updatedAt: Date.now(),
  });
  const wpAck = await a.waitFor((f) => f.t === "ack" && f.ref === wpRef, 3000, "wp ack");
  check("wp.save acked", wpAck.t === "ack");
  const wpEvt = await b.waitFor((f) => f.t === "wp.upsert", 3000, "wp.upsert");
  check("B receives wp.upsert", wpEvt.t === "wp.upsert");

  const wpDelRef = ulid();
  a.send({ t: "wp.del", clientId: wpDelRef, id: wpAck.t === "ack" ? wpAck.id : "missing", updatedAt: Date.now() + 1 });
  const wpDelAck = await a.waitFor((f) => f.t === "ack" && f.ref === wpDelRef, 3000, "wp.del ack");
  check("wp.del acked", wpDelAck.t === "ack");
  const wpGone = await b.waitFor((f) => f.t === "wp.deleted", 3000, "wp.deleted");
  check("B receives wp.deleted", wpGone.t === "wp.deleted");

  const sosRef = ulid();
  a.send({ t: "sos.raise", clientId: sosRef, lat: 12.9, lng: 77.5, note: cipher, updatedAt: Date.now() });
  const sosAck = await a.waitFor((f) => f.t === "ack" && f.ref === sosRef, 3000, "sos ack");
  check("sos.raise acked", sosAck.t === "ack");
  const sosRaised = await b.waitFor((f) => f.t === "sos.raised", 3000, "sos.raised");
  check(
    "B receives sos.raised",
    sosRaised.t === "sos.raised" && sosRaised.sos.active === true,
  );

  const sosDupRef = ulid();
  a.send({ t: "sos.raise", clientId: sosDupRef, note: cipher, updatedAt: Date.now() + 1 });
  const sosDupAck = await a.waitFor((f) => f.t === "ack" && f.ref === sosDupRef, 3000, "sos dup ack");
  check(
    "second raise reuses the same SOS event",
    sosDupAck.t === "ack" && sosRaised.t === "sos.raised" && sosDupAck.id === sosRaised.sos.id,
    `ids=${sosDupAck.t === "ack" ? sosDupAck.id : "?"} vs ${sosRaised.t === "sos.raised" ? sosRaised.sos.id : "?"}`,
  );

  const sosClearRef = ulid();
  a.send({ t: "sos.clear", clientId: sosClearRef, id: sosAck.t === "ack" ? sosAck.id : "missing", updatedAt: Date.now() + 2 });
  const sosClearAck = await a.waitFor((f) => f.t === "ack" && f.ref === sosClearRef, 3000, "sos clear ack");
  check("sos.clear acked", sosClearAck.t === "ack");
  const sosCleared = await b.waitFor((f) => f.t === "sos.cleared", 3000, "sos.cleared");
  check("B receives sos.cleared", sosCleared.t === "sos.cleared");

  const beaconRef = ulid();
  a.send({ t: "beacon.share", clientId: beaconRef, text: cipher, wpm: 18 });
  const beaconAck = await a.waitFor((f) => f.t === "ack" && f.ref === beaconRef, 3000, "beacon ack");
  check("beacon.share acked", beaconAck.t === "ack");
  const beaconEvt = await b.waitFor((f) => f.t === "beacon.new", 3000, "beacon.new");
  check(
    "B receives beacon.new",
    beaconEvt.t === "beacon.new" && beaconEvt.beacon.wpm === 18,
  );

  // 12. P7 reactions: add, broadcast, remove
  const reactMsgClientId = ulid();
  a.send({ t: "msg.send", clientId: reactMsgClientId, channelId: general.id, kind: "text", body, attachments: [] });
  const reactMsgAck = await a.waitFor((f) => f.t === "ack" && f.ref === reactMsgClientId, 3000, "react msg ack");
  check("reaction target msg acked", reactMsgAck.t === "ack");

  const reactRef = ulid();
  a.send({ t: "msg.react", clientId: reactRef, id: reactMsgAck.t === "ack" ? reactMsgAck.id : "missing", emoji: "👍", on: true });
  const reactAck = await a.waitFor((f) => f.t === "ack" && f.ref === reactRef, 3000, "react ack");
  check("msg.react acked", reactAck.t === "ack");
  const reacted = await b.waitFor(
    (f) => f.t === "msg.new" && reactMsgAck.t === "ack" && f.msg.id === reactMsgAck.id && f.msg.reactions.length === 1,
    3000,
    "reaction to B",
  );
  check(
    "B receives reaction",
    reacted.t === "msg.new" && reacted.msg.reactions[0]?.emoji === "👍" && reacted.msg.reactions[0]?.deviceId === deviceA.id,
  );

  const unreactRef = ulid();
  a.send({ t: "msg.react", clientId: unreactRef, id: reactMsgAck.t === "ack" ? reactMsgAck.id : "missing", emoji: "👍", on: false });
  const unreactAck = await a.waitFor((f) => f.t === "ack" && f.ref === unreactRef, 3000, "unreact ack");
  check("reaction removal acked", unreactAck.t === "ack");
  const unreacted = await b.waitFor(
    (f) =>
      f.t === "msg.new" &&
      reactMsgAck.t === "ack" &&
      unreactAck.t === "ack" &&
      f.msg.id === reactMsgAck.id &&
      f.msg.reactions.length === 0 &&
      f.rev >= unreactAck.rev,
    3000,
    "removal to B",
  );
  check("B receives reaction removal", unreacted.t === "msg.new");

  // 13. P7 read cursors: broadcast + stale suppression + sync replay
  const readAt = Date.now();
  a.send({ t: "msg.read", channelId: general.id, at: readAt });
  const readEvt = await b.waitFor(
    (f) => f.t === "channel.read" && f.deviceId === deviceA.id,
    3000,
    "channel.read",
  );
  check(
    "B receives channel.read",
    readEvt.t === "channel.read" && readEvt.at === readAt && readEvt.channelId === general.id,
  );

  const bReadCount = b.frames.filter((f) => f.t === "channel.read").length;
  a.send({ t: "msg.read", channelId: general.id, at: readAt - 60_000 });
  await new Promise((r) => setTimeout(r, 300));
  check(
    "stale read cursor not rebroadcast",
    b.frames.filter((f) => f.t === "channel.read").length === bReadCount,
  );

  a.send({ t: "sync.pull", cursor: 0 });
  const readReplay = await a.waitFor(
    (f) => f.t === "sync.batch" && f.events.some((e) => e.t === "channel.read"),
    3000,
    "read replay",
  );
  check("read cursor replays via sync.pull", readReplay.t === "sync.batch");

  // 14. P7 hub export endpoint
  const exported = await api(`/api/rooms/${roomId}/export`, {
    headers: { authorization: `Bearer ${tokenA}` },
  });
  const dump = (await exported.json()) as {
    format?: string;
    messages?: Array<{ id: string; reactions: unknown[] }>;
    reads?: unknown[];
    files?: Array<{ id: string; enc?: string }>;
  };
  check("GET export → 200", exported.status === 200 && dump.format === "offgrid-hub-export");
  check(
    "export carries messages, reads, files",
    (dump.messages?.length ?? 0) > 0 && (dump.reads?.length ?? 0) >= 1 && (dump.files?.length ?? 0) >= 1,
    `messages=${dump.messages?.length} reads=${dump.reads?.length} files=${dump.files?.length}`,
  );
  const noAuthExport = await api(`/api/rooms/${roomId}/export`);
  check("export without token → 401", noAuthExport.status === 401, `status=${noAuthExport.status}`);

  // 15. P7 encrypted file bytes at rest: multipart upload, download, decrypt
  const encFileId = ulid();
  const plainBytes = new Uint8Array(FILE_CHUNK_BYTES + 1234);
  for (let i = 0; i < plainBytes.length; i++) plainBytes[i] = (i * 17 + 3) & 0xff;
  const encFrames: Uint8Array[] = [];
  for (let i = 0; i < frameCount(plainBytes.length); i++) {
    const start = i * FILE_CHUNK_BYTES;
    encFrames.push(
      await encryptFileChunkWith(
        key,
        encFileId,
        i,
        plainBytes.subarray(start, Math.min(start + FILE_CHUNK_BYTES, plainBytes.length)),
      ),
    );
  }
  const encCipher = Buffer.concat(encFrames.map((f) => Buffer.from(f)));
  check(
    "ciphertext size matches protocol math",
    encCipher.length === fileCipherSize(plainBytes.length),
    `cipher=${encCipher.length}`,
  );

  const encHeaders = {
    authorization: `Bearer ${tokenA}`,
    "content-type": "application/octet-stream",
    "x-file-id": encFileId,
    "x-file-name": encodeURIComponent("ZW5jLW5hbWUtY3Q="),
    "x-file-iv": encodeURIComponent("aXZpdg=="),
    "x-file-mime": "application/octet-stream",
    "x-enc": "gcm1",
    "x-plain-size": String(plainBytes.length),
  };
  const splitAt = encFrames[0]!.length;
  const part0 = await api(`/api/rooms/${roomId}/files`, {
    method: "POST",
    headers: { ...encHeaders, "x-part": "0", "x-more": "1" },
    body: encCipher.subarray(0, splitAt),
  });
  check("encrypted part 0 → 200", part0.status === 200, `status=${part0.status}`);

  const part1 = await api(`/api/rooms/${roomId}/files`, {
    method: "POST",
    headers: { ...encHeaders, "x-part": "1", "x-more": "0" },
    body: encCipher.subarray(splitAt),
  });
  check("encrypted part 1 → 201", part1.status === 201, `status=${part1.status}`);
  const encMeta = (await part1.json()) as { size: number; enc: string; sha256: string };
  check(
    "encrypted upload reports plaintext size + gcm1",
    encMeta.size === plainBytes.length && encMeta.enc === "gcm1",
    `size=${encMeta.size} enc=${encMeta.enc}`,
  );

  const encRetry = await api(`/api/rooms/${roomId}/files`, {
    method: "POST",
    headers: { ...encHeaders, "x-part": "0", "x-more": "1" },
    body: encCipher.subarray(0, splitAt),
  });
  const encRetryBody = (await encRetry.json()) as { existing?: boolean };
  check(
    "encrypted re-upload → 200 existing",
    encRetry.status === 200 && encRetryBody.existing === true,
    `status=${encRetry.status}`,
  );

  const encAnnounceRef = ulid();
  a.send({ t: "file.announce", clientId: encAnnounceRef, fileId: encFileId });
  await a.waitFor((f) => f.t === "ack" && f.ref === encAnnounceRef, 3000, "enc file ack");
  const encFileNew = await b.waitFor(
    (f) => f.t === "file.new" && f.file.id === encFileId,
    3000,
    "enc file.new",
  );
  check(
    "B receives file.new with enc=gcm1",
    encFileNew.t === "file.new" && encFileNew.file.enc === "gcm1" && encFileNew.file.size === plainBytes.length,
  );

  const encDownload = await api(`/api/rooms/${roomId}/files/${encFileId}`, {
    headers: { authorization: `Bearer ${tokenB}` },
  });
  const storedBytes = Buffer.from(await encDownload.arrayBuffer());
  check(
    "stored bytes are ciphertext (≠ plaintext)",
    storedBytes.length === encCipher.length && storedBytes.equals(encCipher) && !storedBytes.equals(Buffer.from(plainBytes)),
    `stored=${storedBytes.length}`,
  );

  const decrypted = new Uint8Array(plainBytes.length);
  let outAt = 0;
  for (let i = 0; i < frameCount(plainBytes.length); i++) {
    const chunk = await decryptFileFrameWith(key, encFileId, i, new Uint8Array(storedBytes.subarray(frameOffset(i), i + 1 < frameCount(plainBytes.length) ? frameOffset(i + 1) : storedBytes.length)));
    decrypted.set(chunk, outAt);
    outAt += chunk.length;
  }
  check("download decrypts to original plaintext", Buffer.from(decrypted).equals(Buffer.from(plainBytes)));

  const encRange = await api(`/api/rooms/${roomId}/files/${encFileId}`, {
    headers: { authorization: `Bearer ${tokenA}`, range: `bytes=${frameOffset(1)}-${frameOffset(1) + 9}` },
  });
  check("encrypted range → 206 frame-aligned slice", encRange.status === 206, `status=${encRange.status}`);

  // 16. invalid frame rejected without dropping the socket
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
