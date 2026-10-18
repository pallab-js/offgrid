import { vi, describe, it, expect, afterAll } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

vi.hoisted(() => {
  process.env.DATA_DIR = `/tmp/offgrid-rothttp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.LOG_LEVEL = "error";
});

import { handleApi } from "./index";
import * as repo from "../db/repo";
import { closeDb } from "../db/index";
import { addConn, enterRoom, removeConn, type Conn } from "../ws/registry";

afterAll(() => {
  closeDb();
});

const ROOM = "01ROTHHTTP000000000000001";
const OLD_PROOF = "b2xkLXByb29mLXZhbHVlMDAwMQ==";
const OLD_SALT = "b2xkLXNhbHQtdmFsdWUwMDE=";
const NEW_SALT = "bmV3LXNhbHQtdmFsdWUwMDE=";
const NEW_PROOF = "bmV3LXByb29mLXZhbHVlMDAwMQ==";

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

function fakeReq(body?: unknown): IncomingMessage {
  const payload = body === undefined ? "" : JSON.stringify(body);
  return {
    method: "POST",
    headers: payload ? { "content-type": "application/json" } : {},
    socket: { remoteAddress: "203.0.113.95" },
    async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
      if (payload) yield Buffer.from(payload);
    },
  } as unknown as IncomingMessage;
}

async function rotate(
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = fakeRes();
  await handleApi(
    fakeReq(body),
    res as unknown as ServerResponse,
    `/api/rooms/${encodeURIComponent(ROOM)}/rotate`,
  );
  return { status: res.status, body: JSON.parse(res.body === "" ? "{}" : res.body) };
}

async function join(
  deviceId: string,
  proof: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = fakeRes();
  await handleApi(
    fakeReq({ deviceId, name: deviceId, color: "#111111", proof }),
    res as unknown as ServerResponse,
    `/api/rooms/${encodeURIComponent(ROOM)}/join`,
  );
  return { status: res.status, body: JSON.parse(res.body === "" ? "{}" : res.body) };
}

function makeConn(deviceId: string): Conn & { sent: string[]; closed: Array<number | undefined> } {
  const sent: string[] = [];
  const closed: Array<number | undefined> = [];
  const conn = {
    id: `c-rot-${deviceId}-${Math.random().toString(36).slice(2)}`,
    ip: "203.0.113.96",
    sent,
    closed,
    ws: {
      readyState: 1,
      send: (payload: string) => sent.push(payload),
      close: (code?: number) => closed.push(code),
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
  } as unknown as Conn & { sent: string[]; closed: Array<number | undefined> };
  return conn;
}

describe("POST /api/rooms/:id/rotate", () => {
  repo.createRoom({ id: ROOM, name: "Rot", salt: OLD_SALT, proof: OLD_PROOF });

  it("validates the body", async () => {
    const { status } = await rotate({ oldProof: OLD_PROOF, salt: NEW_SALT });
    expect(status).toBe(400);
  });

  it("404s for an unknown room", async () => {
    const res = fakeRes();
    await handleApi(
      fakeReq({ oldProof: OLD_PROOF, salt: NEW_SALT, proof: NEW_PROOF, prevKey: { ct: "x", iv: "y" } }),
      res as unknown as ServerResponse,
      "/api/rooms/missing-room-000000000000/rotate",
    );
    expect(res.status).toBe(404);
  });

  it("rejects a wrong current-passphrase proof without touching the room", async () => {
    const { status, body } = await rotate({
      oldProof: "d3JvbmctcHJvb2YtdmFsdWUwMDE=",
      salt: NEW_SALT,
      proof: NEW_PROOF,
      prevKey: { ct: "eA==", iv: "eQ==" },
    });
    expect(status).toBe(403);
    expect((body.error as { code: string }).code).toBe("BAD_PROOF");
    const meta = repo.getRoomMeta(ROOM)!;
    expect(meta.salt).toBe(OLD_SALT); // untouched
    expect(repo.getRoomKeyHistory(ROOM)).toEqual([]);
  });

  it("rotates on a matching proof: swaps, appends wrap, kills tokens, notifies + closes live conns", async () => {
    const token = repo.issueToken(ROOM, "dev-victim");
    expect(repo.resolveToken(token, ROOM)).not.toBeNull();

    const conn = makeConn("dev-victim");
    addConn(conn);
    enterRoom(conn, ROOM);
    try {
      const { status, body } = await rotate({
        oldProof: OLD_PROOF,
        salt: NEW_SALT,
        proof: NEW_PROOF,
        prevKey: { ct: "d3JhcC1jdA==", iv: "d3JhcC1pdg==" },
      });

      expect(status).toBe(200);
      expect(body.salt).toBe(NEW_SALT);
      expect(body.keyHistory).toEqual([{ ct: "d3JhcC1jdA==", iv: "d3JhcC1pdg==" }]);

      // Live members learn the new salt, then get disconnected.
      const rotated = conn.sent
        .map((raw) => JSON.parse(raw) as { t?: string; salt?: string })
        .find((f) => f.t === "room.rotated");
      expect(rotated?.salt).toBe(NEW_SALT);
      expect(conn.closed).toEqual([4001]);

      // Old tokens are dead; the old proof no longer verifies.
      expect(repo.resolveToken(token, ROOM)).toBeNull();
      expect(repo.verifyProof(ROOM, OLD_PROOF)).toBe(false);
      expect(repo.verifyProof(ROOM, NEW_PROOF)).toBe(true);
    } finally {
      removeConn(conn);
    }
  });

  it("join with the new proof succeeds and carries the key history", async () => {
    const { status, body } = await join("dev-fresh", NEW_PROOF);
    expect(status).toBe(200);
    expect(body.keyHistory).toEqual([{ ct: "d3JhcC1jdA==", iv: "d3JhcC1pdg==" }]);
    expect(body.moderators).toBeDefined();
  });

  it("join with the old proof still fails", async () => {
    const { status } = await join("dev-stale", OLD_PROOF);
    expect(status).toBe(403);
  });
});
