import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-del-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import * as repo from "../db/repo";
import { closeDb, getDb } from "../db/index";
import { handleMessage } from "./dispatch";
import type { Conn } from "./registry";

afterAll(() => {
  closeDb();
});

const ROOM = "01DELROOM00000000000000001";

function makeRoomAndDevices(): { channelId: string } {
  repo.createRoom({ id: ROOM, name: "Del", salt: "c2FsdA==", proof: "cHJvb2Y=" });
  repo.upsertDevice({ id: "dev-a", roomId: ROOM, name: "Maya", color: "#111111" });
  repo.upsertDevice({ id: "dev-b", roomId: ROOM, name: "Ivo", color: "#222222" });
  const channelId = repo.listChannels(ROOM).find((c) => c.name === "general")!.id;
  return { channelId };
}

function joinConn(deviceId: string): Conn & { sent: string[] } {
  const sent: string[] = [];
  const conn = {
    id: `c-${deviceId}`,
    ip: "203.0.113.10",
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
  handleMessage(
    conn,
    JSON.stringify({
      t: "join",
      token: repo.issueToken(ROOM, deviceId),
      device: { id: deviceId, name: deviceId, color: "#111111" },
    }),
  );
  expect(conn.roomId).toBe(ROOM);
  return conn;
}

function frames(conn: Conn & { sent: string[] }): Array<Record<string, unknown>> {
  return conn.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

function errorsOf(conn: Conn & { sent: string[] }): Array<{ code: string; message: string }> {
  return frames(conn)
    .filter((f) => f.t === "error")
    .map((f) => ({ code: String(f.code ?? ""), message: String(f.message ?? "") }));
}

function rowOf(id: string): { deleted_at: number | null; rev: number } {
  return getDb()
    .prepare("SELECT deleted_at, rev FROM messages WHERE id = ?")
    .get(id) as { deleted_at: number | null; rev: number };
}

describe("msg.del authorization (WS dispatch)", () => {
  const { channelId } = makeRoomAndDevices();

  function seedFromDevA(): { id: string; rev: number } {
    const { msg } = repo.insertMessage({
      roomId: ROOM,
      clientId: `seed-${Math.random().toString(36).slice(2)}`,
      channelId,
      deviceId: "dev-a",
      author: "Maya",
      kind: "text",
      body: { ct: "hi", iv: "iv" },
      attachments: [],
    });
    return { id: msg.id, rev: msg.rev };
  }

  it("rejects another device's delete without persisting the deletion", () => {
    const seed = seedFromDevA();
    const attacker = joinConn("dev-b");
    handleMessage(
      attacker,
      JSON.stringify({ t: "msg.del", clientId: "c-del-1", id: seed.id }),
    );

    const err = errorsOf(attacker).find((e) => e.message === "not your message");
    expect(err?.code).toBe("BAD_FRAME");

    // Regression: pre-fix the soft-delete committed before the ownership
    // check threw — the row changed anyway and reached every client on
    // their next sync pull.
    const row = rowOf(seed.id);
    expect(row.deleted_at).toBeNull();
    expect(row.rev).toBe(seed.rev);
  });

  it("rejects deleting a system join notice", () => {
    const sys = repo.insertSystemMessageIfQuiet(ROOM, "dev-a", "Maya");
    expect(sys).not.toBeNull();
    const conn = joinConn("dev-a");
    handleMessage(
      conn,
      JSON.stringify({ t: "msg.del", clientId: "c-del-sys", id: sys!.msg.id }),
    );

    const err = errorsOf(conn).find((e) =>
      e.message.includes("system messages cannot be deleted"),
    );
    expect(err?.code).toBe("BAD_FRAME");

    const row = rowOf(sys!.msg.id);
    expect(row.deleted_at).toBeNull();
    expect(row.rev).toBe(sys!.rev);
  });

  it("lets the author delete its own message and acks the tombstone", () => {
    const seed = seedFromDevA();
    const owner = joinConn("dev-a");
    handleMessage(
      owner,
      JSON.stringify({ t: "msg.del", clientId: "c-del-ok", id: seed.id }),
    );

    const ack = frames(owner).find((f) => f.t === "ack" && f.ref === "c-del-ok");
    expect(ack).toBeDefined();
    expect(Number(ack!.rev)).toBeGreaterThan(seed.rev);
    expect(rowOf(seed.id).deleted_at).not.toBeNull();
  });
});
