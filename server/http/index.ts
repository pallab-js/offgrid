import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { config, filesDir } from "../config";
import { currentRev } from "../db/index";
import * as repo from "../db/repo";
import { broadcast, connectionCount } from "../ws/registry";
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

    const fileCollection = /^\/api\/rooms\/([^/]+)\/files$/.exec(path);
    if (method === "POST" && fileCollection) {
      const roomId = decodeURIComponent(fileCollection[1]!);
      return await handleUpload(req, res, roomId);
    }

    const fileItem = /^\/api\/rooms\/([^/]+)\/files\/([^/]+)$/.exec(path);
    if (fileItem) {
      const roomId = decodeURIComponent(fileItem[1]!);
      const fileId = decodeURIComponent(fileItem[2]!);
      if (method === "GET" || method === "HEAD") {
        return await handleDownload(req, res, roomId, fileId, method);
      }
      if (method === "DELETE") {
        return await handleFileDelete(req, res, roomId, fileId);
      }
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

/* ------------------------------------------------------------ file routes */

async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse,
  roomId: string,
): Promise<void> {
  if (!idPart.safeParse(roomId).success) {
    throw new HttpError(400, "BAD_FRAME", "bad room id");
  }
  const authed = requireToken(req, roomId);

  const fileId = headerString(req, "x-file-id");
  if (!idPart.safeParse(fileId).success) {
    throw new HttpError(400, "BAD_FRAME", "bad X-File-Id");
  }
  const mime = headerString(req, "x-file-mime", 120) || "application/octet-stream";
  const nameCt = decodeURIComponent(headerString(req, "x-file-name", 4096));
  const nameIv = decodeURIComponent(headerString(req, "x-file-iv", 256));
  if (!nameCt || !nameIv) {
    throw new HttpError(400, "BAD_FRAME", "missing encrypted filename");
  }

  const existing = repo.getFile(roomId, fileId);
  if (existing && existing.deleted_at === null) {
    req.resume(); // drain the (already uploaded) body; idempotent retry
    return sendJson(res, 200, {
      fileId,
      rev: existing.rev,
      sha256: existing.sha256,
      size: existing.size,
      existing: true,
    });
  }

  const roomDir = path.join(filesDir(), roomId);
  await fs.promises.mkdir(roomDir, { recursive: true });
  const finalPath = path.join(roomDir, fileId);
  const partPath = `${finalPath}.part`;
  const hash = createHash("sha256");
  let bytes = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(partPath, { flags: "w" });
      let settled = false;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        out.destroy();
        req.destroy();
        void fs.promises.rm(partPath, { force: true });
        reject(error);
      };

      req.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > config.maxFileBytes) {
          fail(new HttpError(413, "PAYLOAD_TOO_LARGE", "file exceeds size cap"));
          return;
        }
        hash.update(chunk);
        if (!out.write(chunk)) {
          req.pause();
          out.once("drain", () => req.resume());
        }
      });
      req.on("end", () => {
        if (settled) return;
        out.end(() => {
          if (settled) return;
          settled = true;
          resolve();
        });
      });
      req.on("error", fail);
      req.on("aborted", () => fail(new HttpError(400, "BAD_FRAME", "upload aborted")));
      out.on("error", fail);
    });
  } catch (error) {
    await fs.promises.rm(partPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const sha256 = hash.digest("hex");
  await fs.promises.rename(partPath, finalPath);

  const { file, rev, deduped } = repo.insertFile({
    id: fileId,
    roomId,
    deviceId: authed.deviceId,
    name: { ct: nameCt, iv: nameIv },
    mime,
    size: bytes,
    sha256,
    path: finalPath,
  });
  log("info", "file.upload", { room: roomId, device: authed.deviceId, file: fileId, size: bytes });
  return sendJson(res, deduped ? 200 : 201, { fileId: file.id, rev, sha256, size: bytes });
}

async function handleDownload(
  req: IncomingMessage,
  res: ServerResponse,
  roomId: string,
  fileId: string,
  method: "GET" | "HEAD",
): Promise<void> {
  if (!idPart.safeParse(roomId).success || !idPart.safeParse(fileId).success) {
    throw new HttpError(400, "BAD_FRAME", "bad id");
  }
  requireToken(req, roomId);
  const row = repo.getFile(roomId, fileId);
  if (!row || row.deleted_at !== null) {
    throw new HttpError(404, "ROOM_NOT_FOUND", "unknown file");
  }

  const resolved = path.resolve(row.path);
  const root = filesDir();
  if (!resolved.startsWith(root + path.sep)) {
    throw new HttpError(404, "ROOM_NOT_FOUND", "unknown file");
  }

  let size: number;
  try {
    size = (await fs.promises.stat(resolved)).size;
  } catch {
    throw new HttpError(410, "ROOM_NOT_FOUND", "file bytes are gone");
  }

  const baseHeaders: Record<string, string> = {
    "content-type": row.mime,
    "accept-ranges": "bytes",
    "content-disposition": `attachment; filename="${fileId}"`,
    "cache-control": "no-store",
    "x-file-size": String(size),
    "x-file-mime": row.mime,
    "x-file-rev": String(row.rev),
    "x-file-created": String(row.created_at),
    "x-file-sha256": row.sha256 ?? "",
  };

  if (method === "HEAD") {
    res.writeHead(200, { ...baseHeaders, "content-length": String(size) });
    res.end();
    return;
  }

  const range = typeof req.headers.range === "string" ? req.headers.range : null;
  if (range) {
    const parsed = parseRange(range, size);
    if (!parsed) {
      res.writeHead(416, { "content-range": `bytes */${size}` });
      res.end();
      return;
    }
    const { start, end } = parsed;
    res.writeHead(206, {
      ...baseHeaders,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(end - start + 1),
    });
    fs.createReadStream(resolved, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { ...baseHeaders, "content-length": String(size) });
  fs.createReadStream(resolved).pipe(res);
}

async function handleFileDelete(
  req: IncomingMessage,
  res: ServerResponse,
  roomId: string,
  fileId: string,
): Promise<void> {
  if (!idPart.safeParse(roomId).success || !idPart.safeParse(fileId).success) {
    throw new HttpError(400, "BAD_FRAME", "bad id");
  }
  const authed = requireToken(req, roomId);
  const row = repo.getFile(roomId, fileId);
  if (!row) throw new HttpError(404, "ROOM_NOT_FOUND", "unknown file");
  if (row.device_id !== authed.deviceId) {
    throw new HttpError(403, "BAD_TOKEN", "not your file");
  }

  const result = repo.softDeleteFile(roomId, fileId);
  if (!result) throw new HttpError(404, "ROOM_NOT_FOUND", "unknown file");
  await fs.promises.rm(path.resolve(row.path), { force: true }).catch(() => undefined);
  await fs.promises.rm(`${path.resolve(row.path)}.part`, { force: true }).catch(() => undefined);
  if (result.changed) {
    broadcast(roomId, { t: "file.deleted", id: fileId, rev: result.rev });
    log("info", "file.delete", { room: roomId, device: authed.deviceId, file: fileId });
  }
  return sendJson(res, 200, { rev: result.rev });
}

/* --------------------------------------------------------------- helpers */

/** Single-range parser: `bytes=start-end`, `bytes=start-`, `bytes=-suffix`. */
export function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return null;

  let start: number;
  let end: number;
  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function requireToken(req: IncomingMessage, roomId: string): { deviceId: string } {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "BAD_TOKEN", "missing bearer token");
  }
  const resolved = repo.resolveToken(header.slice(7), roomId);
  if (!resolved) throw new HttpError(401, "BAD_TOKEN", "invalid token");
  return resolved;
}

function headerString(req: IncomingMessage, name: string, cap = 256): string {
  const raw = req.headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  return value.slice(0, cap);
}
