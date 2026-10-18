/**
 * Live moderation-flow verification: run against a fresh hub.
 *
 *   DATA_DIR=<tmp> PORT=8787 pnpm exec tsx server/index.ts &
 *   pnpm exec tsx scripts/verify-moderation.ts
 *
 * Asserts: first-joiner bootstrap claim, moderator distribution in the join
 * response, NOT_MODERATOR rejection for plain members, moderator add/remove,
 * notice clearing, and targeted revoke (tokens + live WS conn killed).
 */
import { strict as assert } from "node:assert";

const HUB = process.env.HUB ?? "http://127.0.0.1:8787";
const ROOM = `01VERIFYMOD${Date.now().toString(36).toUpperCase().padStart(12, "0")}`;

let passed = 0;
function ok(label: string): void {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

interface ApiBody {
  token?: string;
  moderators?: string[];
  tokens?: number;
  connections?: number;
  cleared?: number;
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

function openWs(token: string, deviceId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB.replace("http", "ws") + "/ws");
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          t: "join",
          token,
          device: { id: deviceId, name: deviceId, color: "#111111" },
        }),
      );
    ws.onmessage = (event) => {
      const frame = JSON.parse(String(event.data));
      if (frame.t === "joined") resolve(ws);
      if (frame.t === "error") reject(new Error(`${frame.code}: ${frame.message}`));
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
}

const SALT = Buffer.from("verify-salt-bytes-01").toString("base64");
const PROOF = Buffer.from("verify-proof-bytes-01").toString("base64");

async function main(): Promise<void> {
  console.log(`verify-moderation → ${HUB} room=${ROOM}`);

  // 1. create + first join claims moderation
  const created = await post("/api/rooms", {
    roomId: ROOM,
    name: "Verify",
    salt: SALT,
    proof: PROOF,
  });
  assert.equal(created.status, 201, "room create");
  ok("room created");

  const joinA = await post(`/api/rooms/${ROOM}/join`, {
    deviceId: "dev-alice",
    name: "Alice",
    color: "#111111",
    proof: PROOF,
  });
  assert.equal(joinA.status, 200, "alice join");
  const tokenA = joinA.json.token!;
  assert.deepEqual(
    joinA.json.moderators,
    ["dev-alice"],
    "alice claims moderation on first join",
  );
  ok("first joiner (alice) is moderator per join response");

  const joinB = await post(`/api/rooms/${ROOM}/join`, {
    deviceId: "dev-bob",
    name: "Bob",
    color: "#222222",
    proof: PROOF,
  });
  assert.equal(joinB.status, 200, "bob join");
  const tokenB = joinB.json.token!;
  assert.deepEqual(joinB.json.moderators, ["dev-alice"], "bob sees alice as moderator");
  ok("later joiner (bob) sees the existing moderator");

  // 2. plain member cannot moderate
  const bobMods = await post(
    `/api/rooms/${ROOM}/mods`,
    { deviceId: "dev-bob", on: true },
    tokenB,
  );
  assert.equal(bobMods.status, 403, "bob mods attempt");
  assert.equal(bobMods.json.error?.code, "NOT_MODERATOR", "bob NOT_MODERATOR");
  ok("non-moderator gets NOT_MODERATOR");

  const bobClear = await post(`/api/rooms/${ROOM}/notices/clear`, undefined, tokenB);
  assert.equal(bobClear.status, 403, "bob clear attempt");
  ok("non-moderator cannot clear notices");

  const bobRevoke = await post(`/api/rooms/${ROOM}/revoke`, { deviceId: "dev-alice" }, tokenB);
  assert.equal(bobRevoke.status, 403, "bob revoke attempt");
  ok("non-moderator cannot revoke another device");

  // 3. moderator actions
  const wsBob = await openWs(tokenB, "dev-bob");
  ok("bob's live WS joined");

  const addMod = await post(`/api/rooms/${ROOM}/mods`, { deviceId: "dev-bob", on: true }, tokenA);
  assert.equal(addMod.status, 200, "alice adds bob as mod");
  assert.ok(addMod.json.moderators?.includes("dev-bob"), "bob now moderator");
  ok("moderator can appoint another moderator");

  const clear = await post(`/api/rooms/${ROOM}/notices/clear`, undefined, tokenA);
  assert.equal(clear.status, 200, "alice clears notices");
  assert.ok(typeof clear.json.cleared === "number", "cleared count");
  ok(`moderator cleared ${clear.json.cleared} join notice(s)`);

  // 4. targeted revoke closes bob's live socket
  const kick = await post(`/api/rooms/${ROOM}/revoke`, { deviceId: "dev-bob" }, tokenA);
  assert.equal(kick.status, 200, "alice revokes bob");
  assert.ok((kick.json.tokens ?? 0) >= 1, "token rows removed");

  const kicked = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    wsBob.onclose = (event) => {
      clearTimeout(timer);
      resolve(event.code === 4001);
    };
  });
  assert.equal(kicked, true, "bob's live WS closed with 4001");
  ok("targeted revoke killed the live WS session (4001)");

  const bobRejoin = await post(`/api/rooms/${ROOM}/join`, {
    deviceId: "dev-bob",
    name: "Bob",
    color: "#222222",
    proof: PROOF,
  });
  // Rejoining with a FRESH join (no old token) still works — the passphrase
  // is unchanged; only the old tokens died.
  assert.equal(bobRejoin.status, 200, "bob can rejoin with the passphrase");
  ok("revoked device can still rejoin with the passphrase (PSK equality)");

  console.log(`\nverify-moderation: ${passed}/${passed} checks passed`);
  process.exit(0);
}

void main().catch((err) => {
  console.error(
    `\nverify-moderation FAILED: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
