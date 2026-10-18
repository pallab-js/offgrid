import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-auth-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import * as repo from "../db/repo";
import { closeDb, getDb } from "../db/index";
import { handleMessage } from "./dispatch";
import type { Conn } from "./registry";

afterAll(() => {
  closeDb();
});

const ROOM = "01AUTHROOM0000000000000001";

function makeRoom(): void {
  repo.createRoom({ id: ROOM, name: "Auth", salt: "c2FsdA==", proof: "cHJvb2Y=" });
  repo.upsertDevice({ id: "dev-honest", roomId: ROOM, name: "Honest", color: "#111111" });
}

function fakeConn(): Conn & { sent: string[] } {
  const sent: string[] = [];
  return {
    id: "c1",
    ip: "198.51.100.1",
    sent,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      terminate: () => undefined,
    },
    roomId: null,
    device: null,
    lastFrameAt: 0,
    windowStart: 0,
    windowCount: 0,
    rateLimitedAt: 0,
    rttMs: null,
    battery: null,
  } as unknown as Conn & { sent: string[] };
}

describe("token-bound device identity (WS join)", () => {
  it("ignores a frame-supplied device.id that differs from the token's device", () => {
    makeRoom();
    const token = repo.issueToken(ROOM, "dev-honest");
    const conn = fakeConn();

    handleMessage(
      conn,
      JSON.stringify({
        t: "join",
        token,
        device: { id: "dev-victim", name: "Attacker", color: "#ff0000" },
      }),
    );

    // Identity comes from the token row — the frame only set display fields.
    expect(conn.device).not.toBeNull();
    expect(conn.device!.id).toBe("dev-honest");
    expect(conn.device!.name).toBe("Attacker");

    const joined = conn.sent
      .map((raw) => JSON.parse(raw) as { t: string; device?: { id: string; name: string } })
      .find((f) => f.t === "joined");
    expect(joined?.device?.id).toBe("dev-honest");
  });

  it("rejects a garbage token before any device identity is assigned", () => {
    const conn = fakeConn();
    handleMessage(
      conn,
      JSON.stringify({
        t: "join",
        token: "not-a-real-token",
        device: { id: "dev-x", name: "X", color: "#000000" },
      }),
    );
    expect(conn.device).toBeNull();
    expect(conn.roomId).toBeNull();
    const err = conn.sent
      .map((raw) => JSON.parse(raw) as { t: string; code?: string })
      .find((f) => f.t === "error");
    expect(err?.code).toBe("BAD_TOKEN");
  });
});

describe("token expiry + revocation (WS join)", () => {
  beforeAll(() => {
    try {
      makeRoom(); // idempotent across the file's earlier test
    } catch {
      /* already created */
    }
  });

  function joinWith(token: string): Conn & { sent: string[] } {
    const conn = fakeConn();
    handleMessage(
      conn,
      JSON.stringify({
        t: "join",
        token,
        device: { id: "dev-honest", name: "Honest", color: "#111111" },
      }),
    );
    return conn;
  }

  function firstError(conn: Conn & { sent: string[] }): { code?: string } | undefined {
    return conn.sent
      .map((raw) => JSON.parse(raw) as { t: string; code?: string })
      .find((f) => f.t === "error");
  }

  it("rejects an expired token", () => {
    const token = repo.issueToken(ROOM, "dev-honest");
    getDb()
      .prepare("UPDATE tokens SET expires_at = ? WHERE hash = ?")
      .run(Date.now() - 1, repo.hashToken(token));

    const conn = joinWith(token);

    expect(firstError(conn)?.code).toBe("BAD_TOKEN");
    expect(conn.roomId).toBeNull();
    expect(conn.device).toBeNull();
  });

  it("rejects a revoked token", () => {
    const token = repo.issueToken(ROOM, "dev-honest");
    expect(repo.revokeToken(token, ROOM)).toBe(true);

    const conn = joinWith(token);

    expect(firstError(conn)?.code).toBe("BAD_TOKEN");
    expect(conn.roomId).toBeNull();
  });

  it("binds conn.tokenHash and slides expiry on a successful join", () => {
    const token = repo.issueToken(ROOM, "dev-honest");
    const soon = Date.now() + 60_000;
    getDb()
      .prepare("UPDATE tokens SET expires_at = ? WHERE hash = ?")
      .run(soon, repo.hashToken(token));

    const conn = joinWith(token);

    expect(conn.roomId).toBe(ROOM);
    expect(conn.tokenHash).toBe(repo.hashToken(token));
    const row = getDb()
      .prepare("SELECT expires_at FROM tokens WHERE hash = ?")
      .get(repo.hashToken(token)) as { expires_at: number };
    expect(row.expires_at).toBeGreaterThan(soon); // slid forward by the join
  });
});
