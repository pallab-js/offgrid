import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { config } from "../config";
import { currentRev } from "../db/index";
import * as repo from "../db/repo";
import { connectionCount } from "../ws/registry";
import { log } from "../log";

const STARTED_AT = Date.now();

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  rawUrl: string,
): Promise<void> {
  const url = new URL(rawUrl, "http://hub.local");
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    if (method === "GET" && path === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - STARTED_AT,
        clients: connectionCount(),
        rev: currentRev(),
        version: config.version,
      });
    }

    if (method === "POST" && path === "/api/rooms") {
      const body = await readJson(req);
      const input = createRoomSchema.parse(body);
      const { meta, channels } = repo.createRoom({
        id: input.roomId,
        name: input.name,
        salt: input.salt,
        proof: input.proof,
      });
      log("info", "room.create", { room: meta.id });
      return sendJson(res, 201, { roomId: meta.id, channels });
    }

    const roomJoin = /^\/api\/rooms\/([^/]+)\/join$/.exec(path);
    if (method === "POST" && roomJoin) {
      const roomId = decodeURIComponent(roomJoin[1]!);
      const body = await readJson(req);
      const input = joinSchema.parse(body);
      if (!repo.verifyProof(roomId, input.proof)) {
        throw new HttpError(403, "BAD_PROOF", "wrong passphrase for this room");
      }
      repo.upsertDevice({ id: input.deviceId, roomId, name: input.name, color: input.color });
      const token = repo.issueToken(roomId, input.deviceId);
      log("info", "room.join", { room: roomId, device: input.deviceId });
      return sendJson(res, 200, { token, serverTime: Date.now() });
    }

    const roomMeta = /^\/api\/rooms\/([^/]+)\/meta$/.exec(path);
    if (method === "GET" && roomMeta) {
      const roomId = decodeURIComponent(roomMeta[1]!);
      const meta = repo.getRoomMeta(roomId);
      if (!meta) throw new HttpError(404, "ROOM_NOT_FOUND", "unknown room");
      return sendJson(res, 200, {
        id: meta.id,
        name: meta.name,
        salt: meta.salt,
        createdAt: meta.createdAt,
      });
    }

    throw new HttpError(404, "NOT_FOUND", "unknown api route");
  } catch (error) {
    if (error instanceof HttpError) {
      return sendError(res, error.status, error.code, error.message);
    }
    if (error instanceof repo.RepoError) {
      const status =
        error.code === "ROOM_NOT_FOUND" ? 404 :
        error.code === "BAD_PROOF" ? 403 : 400;
      return sendError(res, status, error.code, error.message);
    }
    if (error instanceof z.ZodError) {
      return sendError(res, 400, "BAD_FRAME", issue(error));
    }
    if (error instanceof ApiBodyError) {
      return sendError(res, error.status, error.code, error.message);
    }
    log("error", "api.unhandled", { path, error: String(error) });
    return sendError(res, 500, "INTERNAL", "server error");
  }
}

class ApiBodyError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/* -------------------------------------------------------------- schemas */

const b64 = z.string().min(8).max(512);
const idPart = z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/, "bad id");

const createRoomSchema = z.object({
  roomId: idPart,
  name: z.string().min(1).max(80),
  salt: b64,
  proof: b64,
});

const joinSchema = z.object({
  deviceId: idPart,
  name: z.string().min(1).max(40),
  color: z.string().min(1).max(32),
  proof: b64,
});

/* --------------------------------------------------------------- helpers */

function issue(error: z.ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join(".") || "body"}: ${first.message}` : "invalid body";
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > config.maxJsonBody) {
      throw new ApiBodyError(413, "PAYLOAD_TOO_LARGE", "body too large");
    }
    chunks.push(buf);
  }
  if (size === 0) throw new ApiBodyError(400, "BAD_FRAME", "empty body");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiBodyError(400, "BAD_FRAME", "invalid json");
  }
}
