import { vi, describe, it, expect, afterAll } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-revoke-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import { handleApi } from "./index";
import * as repo from "../db/repo";
import { closeDb } from "../db/index";
import { addConn, enterRoom, removeConn, type Conn } from "../ws/registry";

afterAll(() => {
  closeDb();
});

const ROOM = "01REVOKEROOM00000000000001";

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
    socket: { remoteAddress: "203.0.113.77" },
    // handleApi drains the request (readJsonOptional) — a body-less request
    // simply yields nothing.
    async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
      if (payload) yield Buffer.from(payload);
    },
  } as unknown as IncomingMessage;
}

async function revoke(token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = fakeRes();
  await handleApi(
    fakeReq(token),
    res as unknown as ServerResponse,
    `/api/rooms/${encodeURIComponent(ROOM)}/revoke`,
  );
  return { status: res.status, body: JSON.parse(res.body === "" ? "{}" : res.body) };
}

describe("POST /api/rooms/:id/revoke", () => {
  repo.createRoom({ id: ROOM, name: "Rev", salt: "c2FsdA==", proof: "cHJvb2Y=" });

  it("requires a bearer token", async () => {
    const { status, body } = await revoke();
    expect(status).toBe(401);
    expect((body.error as { code: string }).code).toBe("BAD_TOKEN");
  });

  it("revokes a live token so it no longer resolves", async () => {
    const token = repo.issueToken(ROOM, "dev-a");
    expect(repo.resolveToken(token, ROOM)).not.toBeNull();

    const { status, body } = await revoke(token);

    expect(status).toBe(200);
    expect(body).toEqual({ revoked: true });
    expect(repo.resolveToken(token, ROOM)).toBeNull();
  });

  it("returns the same 200 for an unknown token (no validity oracle)", async () => {
    const { status, body } = await revoke("never-issued-token-value-0123456789");
    expect(status).toBe(200);
    expect(body).toEqual({ revoked: true });
  });

  it("removes every token row the presenting device holds", () => {
    // A device accumulates one token row per HTTP join; leaving via one of
    // them must not leave the older rows alive.
    const oldToken = repo.issueToken(ROOM, "dev-sib");
    const presented = repo.issueToken(ROOM, "dev-sib");
    expect(repo.resolveToken(oldToken, ROOM)).not.toBeNull();

    return revoke(presented).then(({ status }) => {
      expect(status).toBe(200);
      expect(repo.resolveToken(presented, ROOM)).toBeNull();
      expect(repo.resolveToken(oldToken, ROOM)).toBeNull();
    });
  });

  it("closes live connections riding the revoked token", async () => {
    const token = repo.issueToken(ROOM, "dev-live");
    const closed: Array<{ code?: number; reason?: string }> = [];
    const sent: string[] = [];
    const conn = {
      id: "c-rev",
      ip: "203.0.113.78",
      roomId: null,
      device: null,
      tokenHash: repo.hashToken(token),
      lastFrameAt: 0,
      windowStart: 0,
      windowCount: 0,
      rateLimitedAt: 0,
      rttMs: null,
      battery: null,
      ws: {
        readyState: 1,
        send: (payload: string) => sent.push(payload),
        close: (code?: number, reason?: string) => {
          closed.push({ code, reason });
        },
      },
    } as unknown as Conn;
    addConn(conn);
    enterRoom(conn, ROOM);
    try {
      const { status } = await revoke(token);

      expect(status).toBe(200);
      expect(closed).toEqual([{ code: 4001, reason: "token revoked" }]);
      expect(
        sent.some((raw) => (JSON.parse(raw) as { code?: string }).code === "BAD_TOKEN"),
      ).toBe(true);
      expect(repo.resolveToken(token, ROOM)).toBeNull();
    } finally {
      removeConn(conn);
    }
  });

  it("leaves connections of other devices untouched", async () => {
    const token = repo.issueToken(ROOM, "dev-a"); // revoked token
    const otherToken = repo.issueToken(ROOM, "dev-b");
    const closed: number[] = [];
    const bystander = {
      id: "c-bystander",
      ip: "203.0.113.79",
      roomId: null,
      device: null,
      tokenHash: repo.hashToken(otherToken),
      lastFrameAt: 0,
      windowStart: 0,
      windowCount: 0,
      rateLimitedAt: 0,
      rttMs: null,
      battery: null,
      ws: {
        readyState: 1,
        send: () => undefined,
        close: (code?: number) => {
          closed.push(code ?? 0);
        },
      },
    } as unknown as Conn;
    addConn(bystander);
    enterRoom(bystander, ROOM);
    try {
      await revoke(token);
      expect(closed).toEqual([]);
      expect(repo.resolveToken(otherToken, ROOM)).not.toBeNull();
    } finally {
      removeConn(bystander);
    }
  });
});
