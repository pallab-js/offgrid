/**
 * Live passphrase-rotation verification: run against a fresh hub.
 *
 *   DATA_DIR=<tmp> PORT=8787 pnpm exec tsx server/index.ts &
 *   pnpm exec tsx scripts/verify-rotate.ts
 *
 * Uses the real client crypto (derive/proof/seal/unwrapKeyHistory) end-to-end:
 * rotate a room, assert live members get room.rotated + close 4001, every old
 * token dies, the old proof stops working, the new join carries the wrapped
 * previous key, and that unwrapped key still decrypts pre-rotation content.
 */
import { strict as assert } from "node:assert";
import {
  computeProof,
  deriveRoomKey,
  exportRoomKey,
  importRoomKey,
  open,
  seal,
  unwrapKeyHistory,
} from "../src/lib/crypto/room";
import { randomB64 } from "../src/lib/crypto/base64";

const HUB = process.env.HUB ?? "http://localhost:3000";
const ROOM = `01VERIFYROT${Date.now().toString(36).toUpperCase().padStart(11, "0")}`;
const OLD_PASS = "old-field-passphrase";
const NEW_PASS = "new-field-passphrase";

let passed = 0;
function ok(label: string): void {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

interface ApiBody {
  token?: string;
  moderators?: string[];
  keyHistory?: Array<{ ct: string; iv: string }>;
  salt?: string;
  rev?: number;
  error?: { code: string; message?: string };
}

async function post(
  path: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; json: ApiBody }> {
  const res = await fetch(`${HUB}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as ApiBody;
  return { status: res.status, json };
}

interface WsProbe {
  ws: WebSocket;
  closed: Promise<{ code: number | undefined }>;
  rotated: Promise<string | undefined>;
  joined: Promise<void>;
}

function openWs(token: string, deviceId: string): Promise<WsProbe> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB.replace("http", "ws") + "/ws");
    let resolveRotated: (salt: string | undefined) => void;
    const rotated = new Promise<string | undefined>((r) => {
      resolveRotated = r;
    });
    let resolveJoined: () => void;
    const joined = new Promise<void>((r) => {
      resolveJoined = r;
    });
    const closed = new Promise<{ code: number | undefined }>((r) => {
      ws.onclose = (event) => r({ code: event.code });
    });
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          t: "join",
          token,
          device: { id: deviceId, name: deviceId, color: "#111111" },
        }),
      );
    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data)) as {
        t?: string;
        salt?: string;
        code?: string;
        message?: string;
      };
      if (frame.t === "joined") resolveJoined();
      if (frame.t === "room.rotated") resolveRotated(frame.salt);
      if (frame.t === "error") reject(new Error(`${frame.code}: ${frame.message}`));
    };
    ws.onerror = () => reject(new Error("ws error"));
    resolve({ ws, closed, rotated, joined });
  });
}

async function main(): Promise<void> {
  console.log(`verify-rotate → ${HUB} room=${ROOM}`);

  // 1. Real key material: proof = HMAC(K, roomId) — exactly what clients send.
  const oldSalt = randomB64(16);
  const oldKey = await deriveRoomKey(OLD_PASS, oldSalt);
  const oldProof = await computeProof(oldKey, ROOM);

  const created = await post("/api/rooms", {
    roomId: ROOM,
    name: "Rotate",
    salt: oldSalt,
    proof: oldProof,
  });
  assert.equal(created.status, 201, "room create");
  ok("room created with a real old passphrase proof");

  const alice = await post(`/api/rooms/${ROOM}/join`, {
    deviceId: "dev-alice",
    name: "Alice",
    color: "#111111",
    proof: oldProof,
  });
  assert.equal(alice.status, 200, "alice join");
  const aliceToken = alice.json.token!;
  assert.deepEqual(alice.json.keyHistory, [], "no rotations yet");
  ok("alice joins; key history empty before rotation");

  const probe = await openWs(aliceToken, "dev-alice");
  await probe.joined;
  ok("alice's live WS joined");

  const bob = await post(`/api/rooms/${ROOM}/join`, {
    deviceId: "dev-bob",
    name: "Bob",
    color: "#222222",
    proof: oldProof,
  });
  assert.equal(bob.status, 200, "bob join");
  const bobToken = bob.json.token!;
  ok("bob joins with the old passphrase");

  // 2. A valid token alone cannot rotate — the CURRENT passphrase proof is required.
  const noProof = await post(
    `/api/rooms/${ROOM}/rotate`,
    { oldProof: randomB64(32), salt: randomB64(16), proof: randomB64(32), prevKey: { ct: "x", iv: "y" } },
    aliceToken,
  );
  assert.equal(noProof.status, 403, "wrong oldProof rejected even with a valid token");
  ok("stolen token without the passphrase cannot rotate (403)");

  // 3. Rotate with the real old proof: wrap the old key under the new one.
  const newSalt = randomB64(16);
  const newKey = await deriveRoomKey(NEW_PASS, newSalt);
  const newProof = await computeProof(newKey, ROOM);
  const prevKey = await seal(newKey, await exportRoomKey(oldKey));

  const rotated = await post(`/api/rooms/${ROOM}/rotate`, {
    oldProof: oldProof,
    salt: newSalt,
    proof: newProof,
    prevKey,
  });
  assert.equal(rotated.status, 200, "rotate accepted");
  assert.equal(rotated.json.salt, newSalt, "new salt returned");
  ok("rotation accepted with the matching old proof");

  // 4. Live members learn the new salt, then get closed 4001.
  const liveSalt = await Promise.race([
    probe.rotated,
    new Promise<undefined>((r) => setTimeout(() => r(undefined), 3000)),
  ]);
  assert.equal(liveSalt, newSalt, "room.rotated carries the new salt");
  const close = await Promise.race([
    probe.closed,
    new Promise<{ code: number | undefined }>((r) => setTimeout(() => r({ code: undefined }), 3000)),
  ]);
  assert.equal(close.code, 4001, "live WS closed with 4001");
  ok("live member got room.rotated {newSalt} then close 4001");

  // 5. Old tokens and the old proof are dead; bob's token no longer works.
  assert.equal(
    (await post(`/api/rooms/${ROOM}/join`, { deviceId: "dev-alice", name: "Alice", color: "#111111", proof: oldProof })).status,
    403,
    "old proof no longer verifies",
  );
  // bob's old token was revoked with the rotation — presenting it to an
  // authenticated endpoint (targeted revoke probes auth first) fails 401.
  const bobTokenDead = await post(`/api/rooms/${ROOM}/revoke`, { deviceId: "dev-alice" }, bobToken);
  assert.equal(bobTokenDead.status, 401, "bob's pre-rotation token no longer authenticates");
  ok("old passphrase no longer joins (403); pre-rotation tokens are dead (401)");

  // 6. Fresh join with the new proof carries the wrapped previous key…
  const rejoin = await post(`/api/rooms/${ROOM}/join`, {
    deviceId: "dev-alice",
    name: "Alice",
    color: "#111111",
    proof: newProof,
  });
  assert.equal(rejoin.status, 200, "rejoin with new proof");
  const history = rejoin.json.keyHistory ?? [];
  assert.equal(history.length, 1, "one wrapped previous key");

  // …and that chain unwraps back to the old key with the real client code.
  const prevs = await unwrapKeyHistory(newKey, history);
  assert.equal(prevs.length, 1, "chain unwraps to one previous key");
  assert.equal(prevs[0], await exportRoomKey(oldKey), "unwrapped key IS the old room key");
  const oldMessage = await seal(oldKey, "cached at north ridge");
  assert.equal(await open(await importRoomKey(prevs[0]!), oldMessage), "cached at north ridge");
  ok("history unwraps to the old key and decrypts pre-rotation content");

  console.log(`\nverify-rotate: ${passed}/${passed} checks passed`);
  process.exit(0);
}

void main().catch((err) => {
  console.error(
    `\nverify-rotate FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
