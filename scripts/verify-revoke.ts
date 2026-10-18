/* Live verification of token expiry/revocation — run against a fresh hub:
 *   NODE_ENV=production DATA_DIR=<tmp> pnpm exec tsx server/index.ts &
 *   pnpm exec tsx scripts/verify-revoke.ts
 */
import WebSocket from "ws";
import Database from "better-sqlite3";
import fs from "node:fs";

const BASE = process.env.HUB ?? "http://localhost:3000";
const ROOM = "01VERIFYREVOKE0000000001";
const PROOF_B64 = Buffer.from("verify-proof-1").toString("base64");
const SALT_B64 = Buffer.from("verify-salt-1").toString("base64");

const results: Array<[string, boolean, string?]> = [];
function check(name: string, ok: boolean, detail = ""): void {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function wsJoin(token: string): Promise<{ ws: WebSocket; joined: boolean }> {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://localhost:3000/ws");
    let done = false;
    const finish = (joined: boolean) => {
      if (!done) {
        done = true;
        resolve({ ws, joined });
      }
    };
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          t: "join",
          token,
          device: { id: "dev-vfy", name: "V", color: "#111111" },
        }),
      ),
    );
    ws.on("message", (d) => {
      const f = JSON.parse(String(d)) as { t: string; code?: string };
      if (f.t === "joined") finish(true);
      if (f.t === "error") finish(false);
    });
    ws.on("error", () => finish(false));
    setTimeout(() => finish(false), 3000);
  });
}

async function main(): Promise<void> {
  // 1. Room + token
  const create = await fetch(`${BASE}/api/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roomId: ROOM, name: "Verify", salt: SALT_B64, proof: PROOF_B64 }),
  });
  check("room created", create.ok, `status=${create.status}`);

  const join = await fetch(`${BASE}/api/rooms/${ROOM}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "dev-vfy", name: "V", color: "#111111", proof: PROOF_B64 }),
  });
  const { token } = (await join.json()) as { token: string };
  check("join issued token", join.ok && typeof token === "string" && token.length > 20);

  // 2. Live WS session
  const { ws, joined } = await wsJoin(token);
  check("ws join accepted", joined);

  const closeInfo = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on("close", (code, reason) => resolve({ code, reason: String(reason) }));
    setTimeout(() => resolve({ code: -1, reason: "timeout" }), 3000);
  });

  // 3. Revoke over HTTP
  const revoke = await fetch(`${BASE}/api/rooms/${ROOM}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await revoke.json()) as { revoked?: boolean };
  check("revoke returns 200 {revoked:true}", revoke.status === 200 && body.revoked === true);

  const closed = await closeInfo;
  check(
    "live ws closed with 4001 token revoked",
    closed.code === 4001 && closed.reason === "token revoked",
    `code=${closed.code} reason=${closed.reason}`,
  );

  // 4. Rejoin with the revoked token → rejected
  const rejoin = await wsJoin(token);
  check("rejoin with revoked token rejected", !rejoin.joined);
  rejoin.ws.close();

  // 5. Idempotent + oracle-free
  const again = await fetch(`${BASE}/api/rooms/${ROOM}/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  check("second revoke still 200", again.status === 200);

  // 6. Expiry: mint a fresh token, force it past due in SQLite, then check
  //    a token-authenticated HTTP endpoint AND ws join both reject it.
  const join2 = await fetch(`${BASE}/api/rooms/${ROOM}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: "dev-wfy", name: "W", color: "#222222", proof: PROOF_B64 }),
  });
  const { token: token2 } = (await join2.json()) as { token: string };
  const dataDir = process.env.DATA_DIR;
  if (token2 && dataDir && fs.existsSync(`${dataDir}/mesh.db`)) {
    const db = new Database(`${dataDir}/mesh.db`);
    db.prepare("UPDATE tokens SET expires_at = ? WHERE expires_at IS NOT NULL").run(Date.now() - 1);
    db.close();
    const expGet = await fetch(`${BASE}/api/rooms/${ROOM}/export`, {
      headers: { authorization: `Bearer ${token2}` },
    });
    check("expired token fails HTTP auth", expGet.status === 401, `status=${expGet.status}`);
    const ws3 = await wsJoin(token2);
    check("expired token rejected at ws join", !ws3.joined);
    ws3.ws.close();
  } else {
    check("expired token fails HTTP auth", false, `no token2=${String(token2)} DATA_DIR=${String(dataDir)}`);
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
