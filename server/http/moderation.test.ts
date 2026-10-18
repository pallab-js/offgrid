import { vi, describe, it, expect, afterAll } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-modhttp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import { handleApi } from "./index";
import * as repo from "../db/repo";
import { closeDb } from "../db/index";
import { addConn, enterRoom, removeConn, type Conn } from "../ws/registry";

afterAll(() => {
  closeDb();
});

const ROOM = "01MODHTTP0000000000000001";

interface FakeRes {
  status: number;
  body: string;
}

function fakeRes(): FakeRes & { writeHead: (status: number) => void; end: (chunk?: string) => void } {
  const res = {
    status: 0,
    body: "",
    writeHead(status: number) {
      res.status = status;
    },
    end(chunk?: string) {
      res.body = chunk ?? "";
    },
  };
  return res;
}

function fakeReq(token?: string, body?: unknown): IncomingMessage {
  const payload = body === undefined ? "" : JSON.stringify(body);
  return {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(payload ? { "content-type": "application/json" } : {}),
    },
    socket: { remoteAddress: "203.0.113.90" },
    async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
      if (payload) yield Buffer.from(payload);
    },
  } as unknown as IncomingMessage;
}

async function post(
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = fakeRes();
  await handleApi(
    fakeReq(token, body),
    res as unknown as ServerResponse,
    `/api/rooms/${encodeURIComponent(ROOM)}${path}`,
  );
  return { status: res.status, body: JSON.parse(res.body === "" ? "{}" : res.body) };
}

function makeJoinConn(deviceId: string): Conn & { sent: string[]; closed: number[] } {
  const sent: string[] = [];
  const closed: number[] = [];
  const conn = {
    id: `c-${deviceId}-${Math.random().toString(36).slice(2)}`,
    ip: "203.0.113.91",
    sent,
    closed,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      close: (code?: number) => closed.push(code ?? 0),
      terminate: () => undefined,
    },
    roomId: null,
    device: null,
    tokenHash: null,
    lastFrameAt: 0,
    windowStart: 0,
    windowCount: 0,
    rateLimitedAt: 0,
    rttMs: null,
    battery: null,
  } as unknown as Conn & { sent: string[]; closed: number[] };
  return conn;
}

describe("POST /api/rooms/:id/join exposes moderation state", () => {
  const JOIN_ROOM = "01MODHTTP0000000000000002";
  repo.createRoom({ id: JOIN_ROOM, name: "Join", salt: "c2FsdA==", proof: "cHJvb2Y=" });

  it("the first joiner claims moderation and the response says so", async () => {
    const res = fakeRes();
    await handleApi(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        socket: { remoteAddress: "203.0.113.92" },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(
            JSON.stringify({
              deviceId: "dev-creator",
              name: "Creator",
              color: "#111111",
              proof: "cHJvb2Y=",
            }),
          );
        },
      } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/rooms/${encodeURIComponent(JOIN_ROOM)}/join`,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { token: string; moderators: string[] };
    expect(body.moderators).toEqual(["dev-creator"]);
    expect(repo.resolveToken(body.token, JOIN_ROOM)).not.toBeNull();
  });

  it("later joiners see the existing moderator, not themselves", async () => {
    const res = fakeRes();
    await handleApi(
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        socket: { remoteAddress: "203.0.113.93" },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(
            JSON.stringify({
              deviceId: "dev-later",
              name: "Later",
              color: "#222222",
              proof: "cHJvb2Y=",
            }),
          );
        },
      } as unknown as IncomingMessage,
      res as unknown as ServerResponse,
      `/api/rooms/${encodeURIComponent(JOIN_ROOM)}/join`,
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { moderators: string[] };
    expect(body.moderators).toEqual(["dev-creator"]);
  });
});

describe("POST /api/rooms/:id/mods", () => {
  repo.createRoom({ id: ROOM, name: "Mod", salt: "c2FsdA==", proof: "cHJvb2Y=" });
  const modToken = repo.issueToken(ROOM, "dev-mod");
  const memberToken = repo.issueToken(ROOM, "dev-member");
  repo.setModerators(ROOM, ["dev-mod"]);

  it("rejects callers without a token", async () => {
    const { status, body } = await post("/mods", undefined, { deviceId: "dev-member", on: true });
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe("BAD_TOKEN");
  });

  it("rejects non-moderators with NOT_MODERATOR", async () => {
    const { status, body } = await post("/mods", memberToken, {
      deviceId: "dev-member",
      on: true,
    });
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("NOT_MODERATOR");
    expect(repo.isModerator(ROOM, "dev-member")).toBe(false);
  });

  it("lets a moderator add a device and broadcasts room.settings", async () => {
    const observer = makeJoinConn("dev-observer");
    const observerToken = repo.issueToken(ROOM, "dev-observer");
    observer.tokenHash = repo.hashToken(observerToken);
    addConn(observer);
    enterRoom(observer, ROOM);
    try {
      const { status, body } = await post("/mods", modToken, {
        deviceId: "dev-member",
        on: true,
      });
      expect(status).toBe(200);
      expect(body.moderators as string[]).toContain("dev-member");
      expect(repo.isModerator(ROOM, "dev-member")).toBe(true);

      const settings = observer.sent
        .map((raw) => JSON.parse(raw) as { t?: string; moderators?: string[] })
        .find((f) => f.t === "room.settings");
      expect(settings?.moderators).toContain("dev-member");
    } finally {
      removeConn(observer);
    }
  });

  it("lets a moderator demote a device", async () => {
    const { status, body } = await post("/mods", modToken, {
      deviceId: "dev-member",
      on: false,
    });
    expect(status).toBe(200);
    expect(body.moderators as string[]).not.toContain("dev-member");
    expect(repo.isModerator(ROOM, "dev-member")).toBe(false);
  });

  it("validates the body", async () => {
    const { status } = await post("/mods", modToken, { deviceId: "x", on: "yes" });
    expect(status).toBe(400);
  });
});

describe("POST /api/rooms/:id/notices/clear", () => {
  it("rejects non-moderators", async () => {
    const { status, body } = await post("/notices/clear", repo.issueToken(ROOM, "dev-member"));
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("NOT_MODERATOR");
  });

  it("clears join notices for a moderator and broadcasts tombstones", () => {
    repo.insertSystemMessageIfQuiet(ROOM, "dev-a", "Maya");
    repo.insertSystemMessageIfQuiet(ROOM, "dev-b", "Ivo");

    const observer = makeJoinConn("dev-obs2");
    const observerToken = repo.issueToken(ROOM, "dev-obs2");
    observer.tokenHash = repo.hashToken(observerToken);
    addConn(observer);
    enterRoom(observer, ROOM);
    return post("/notices/clear", repo.issueToken(ROOM, "dev-mod"))
      .then(({ status, body }) => {
        expect(status).toBe(200);
        expect(body.cleared).toBe(2);
        const tombstones = observer.sent
          .map((raw) => JSON.parse(raw) as { t?: string; msg?: { kind?: string; deletedAt?: number | null } })
          .filter((f) => f.t === "msg.new" && f.msg?.kind === "system");
        expect(tombstones.length).toBe(2);
        for (const t of tombstones) expect(t.msg?.deletedAt).not.toBeNull();
      })
      .finally(() => removeConn(observer));
  });
});

describe("targeted revoke (POST /revoke with {deviceId})", () => {
  it("rejects a non-moderator revoking someone else", async () => {
    const targetToken = repo.issueToken(ROOM, "dev-victim");
    const { status, body } = await post("/revoke", repo.issueToken(ROOM, "dev-member"), {
      deviceId: "dev-victim",
    });
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("NOT_MODERATOR");
    expect(repo.resolveToken(targetToken, ROOM)).not.toBeNull();
  });

  it("rejects an invalid presented token in targeted mode", async () => {
    const { status } = await post("/revoke", "garbage-token-value-01234567890123", {
      deviceId: "dev-victim",
    });
    expect(status).toBe(401);
  });

  it("lets a moderator revoke a device's tokens and closes its live conns", () => {
    repo.setModerators(ROOM, ["dev-mod"]);
    const victimToken1 = repo.issueToken(ROOM, "dev-victim2");
    const victimToken2 = repo.issueToken(ROOM, "dev-victim2");
    const conn = makeJoinConn("dev-victim2");
    conn.tokenHash = repo.hashToken(victimToken1);
    // The hub binds conn.device on the WS join frame; targeted revoke
    // matches live connections by that identity.
    (conn as unknown as { device: unknown }).device = {
      id: "dev-victim2",
      name: "Victim",
      color: "#333333",
    };
    addConn(conn);
    enterRoom(conn, ROOM);
    return post("/revoke", repo.issueToken(ROOM, "dev-mod"), { deviceId: "dev-victim2" })
      .then(({ status, body }) => {
        expect(status).toBe(200);
        expect(body.tokens).toBe(2);
        expect(repo.resolveToken(victimToken1, ROOM)).toBeNull();
        expect(repo.resolveToken(victimToken2, ROOM)).toBeNull();
        expect(conn.closed).toEqual([4001]);
      })
      .finally(() => removeConn(conn));
  });

  it("lets a device revoke itself via body without mod powers", () => {
    const ownToken = repo.issueToken(ROOM, "dev-selfie");
    return post("/revoke", ownToken, { deviceId: "dev-selfie" }).then(({ status, body }) => {
      expect(status).toBe(200);
      expect(body.revoked).toBe(true);
      expect(repo.resolveToken(ownToken, ROOM)).toBeNull();
    });
  });
});
