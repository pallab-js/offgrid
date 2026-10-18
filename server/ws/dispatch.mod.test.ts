import { vi, describe, it, expect, afterAll } from "vitest";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-modws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import * as repo from "../db/repo";
import { closeDb, getDb } from "../db/index";
import { handleMessage } from "./dispatch";
import type { Conn } from "./registry";

afterAll(() => {
  closeDb();
});

const ROOM = "01MODWS000000000000000001";

function makeRoomAndChannel(): string {
  repo.createRoom({ id: ROOM, name: "ModWs", salt: "c2FsdA==", proof: "cHJvb2Y=" });
  return repo.listChannels(ROOM).find((c) => c.name === "general")!.id;
}

function joinConn(deviceId: string): Conn & { sent: string[] } {
  const sent: string[] = [];
  const conn = {
    id: `c-${deviceId}-${Math.random().toString(36).slice(2)}`,
    ip: "203.0.113.20",
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

describe("moderation over the WS dispatch", () => {
  const channel = makeRoomAndChannel();

  it("the first join claims moderation and announces it live", () => {
    const conn = joinConn("dev-first");
    const joined = frames(conn).find((f) => f.t === "joined") as {
      moderators?: string[];
    } | undefined;
    expect(joined?.moderators).toEqual(["dev-first"]);
    // The claim also reaches anyone already in the room.
    const settings = frames(conn).find((f) => f.t === "room.settings") as
      | { moderators?: string[] }
      | undefined;
    expect(settings?.moderators).toEqual(["dev-first"]);
  });

  it("joined frames carry the current moderator list for late joiners", () => {
    const conn = joinConn("dev-second");
    const joined = frames(conn).find((f) => f.t === "joined") as {
      moderators?: string[];
    } | undefined;
    expect(joined?.moderators).toEqual(["dev-first"]);
    // No claim happened for this device — no room.settings broadcast either.
    expect(frames(conn).some((f) => f.t === "room.settings")).toBe(false);
  });

  it("a moderator deletes another device's message; the row is tombstoned", () => {
    const { msg } = repo.insertMessage({
      roomId: ROOM,
      clientId: "seed-mod-del",
      channelId: channel,
      deviceId: "dev-second",
      author: "Second",
      kind: "text",
      body: { ct: "hi", iv: "iv" },
      attachments: [],
    });
    const mod = joinConn("dev-first");
    handleMessage(mod, JSON.stringify({ t: "msg.del", clientId: "c-mod-del", id: msg.id }));

    const ack = frames(mod).find((f) => f.t === "ack" && f.ref === "c-mod-del");
    expect(ack).toBeDefined();
    const row = getDb()
      .prepare("SELECT deleted_at FROM messages WHERE id = ?")
      .get(msg.id) as { deleted_at: number | null };
    expect(row.deleted_at).not.toBeNull();
  });

  it("a plain member still cannot delete someone else's message", () => {
    const { msg } = repo.insertMessage({
      roomId: ROOM,
      clientId: "seed-nomod",
      channelId: channel,
      deviceId: "dev-first",
      author: "First",
      kind: "text",
      body: { ct: "hi", iv: "iv" },
      attachments: [],
    });
    const member = joinConn("dev-third");
    handleMessage(member, JSON.stringify({ t: "msg.del", clientId: "c-nomod", id: msg.id }));

    const err = frames(member).find(
      (f) => f.t === "error" && f.message === "not your message",
    ) as { code?: string } | undefined;
    expect(err?.code).toBe("BAD_FRAME");
    const row = getDb()
      .prepare("SELECT deleted_at FROM messages WHERE id = ?")
      .get(msg.id) as { deleted_at: number | null };
    expect(row.deleted_at).toBeNull();
  });

  it("system messages stay undeletable even for the moderator", () => {
    // dev-third already received a join notice when it connected, and the
    // per-device throttle suppresses a second one — use a fresh actor id.
    const sys = repo.insertSystemMessageIfQuiet(ROOM, "dev-sysactor", "Sol");
    expect(sys).not.toBeNull();
    const mod = joinConn("dev-first");
    handleMessage(mod, JSON.stringify({ t: "msg.del", clientId: "c-sys-del", id: sys!.msg.id }));

    const err = frames(mod).find((f) =>
      String(f.message ?? "").includes("system messages cannot be deleted"),
    ) as { code?: string } | undefined;
    expect(err?.code).toBe("BAD_FRAME");
    const row = getDb()
      .prepare("SELECT deleted_at FROM messages WHERE id = ?")
      .get(sys!.msg.id) as { deleted_at: number | null };
    expect(row.deleted_at).toBeNull();
  });
});
