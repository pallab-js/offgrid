import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { config, filesDir } from "../config";
import { fileCipherSize } from "../../src/lib/protocol/constants";
import { currentRev } from "../db/index";
import * as repo from "../db/repo";
import { broadcast, connectionCount, roomConns, send } from "../ws/registry";
import { clientIp, httpLimiter, joinLimiter, roomCreateLimiter } from "../ratelimit";
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
  const ip = clientIp(req);

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

    // Everything below (except health) draws from one per-IP minute budget.
    if (!httpLimiter.allow(ip)) {
      throw new HttpError(429, "RATE_LIMITED", "too many requests from this address");
    }

    if (method === "POST" && path === "/api/rooms") {
      if (!roomCreateLimiter.allow(ip)) {
        throw new HttpError(429, "RATE_LIMITED", "room creation rate exceeded, try again in a minute");
      }
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
      // The proof is the only thing standing between a caller and a token, so
      // guesses get a strict per-IP+room budget — charged before the body is
      // even read (SDA threat model: online passphrase guessing).
      if (!joinLimiter.allow(`${ip}|${roomId}`)) {
        log("warn", "room.join.throttled", { room: roomId, ip });
        throw new HttpError(429, "RATE_LIMITED", "too many join attempts, try again in a minute");
      }
      const body = await readJson(req);
      const input = joinSchema.parse(body);
      if (!repo.verifyProof(roomId, input.proof)) {
        throw new HttpError(403, "BAD_PROOF", "wrong passphrase for this room");
      }
      repo.upsertDevice({ id: input.deviceId, roomId, name: input.name, color: input.color });
      // First device into an untouched room claims moderation (also attempted
      // at WS join — whichever lands first wins; the claim is transactional).
      const claimed = repo.claimModeratorIfUnset(roomId, input.deviceId);
      if (claimed) broadcast(roomId, { t: "room.settings", moderators: claimed });
      const token = repo.issueToken(roomId, input.deviceId);
      log("info", "room.join", { room: roomId, device: input.deviceId });
      return sendJson(res, 200, {
        token,
        serverTime: Date.now(),
        moderators: repo.getModerators(roomId),
      });
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

    const roomExport = /^\/api\/rooms\/([^/]+)\/export$/.exec(path);
    if (method === "GET" && roomExport) {
      const roomId = decodeURIComponent(roomExport[1]!);
      requireToken(req, roomId);
      const data = repo.exportRoom(roomId);
      if (!data) throw new HttpError(404, "ROOM_NOT_FOUND", "unknown room");
      const body = JSON.stringify(
        { format: "offgrid-hub-export", version: 1, exportedAt: Date.now(), ...data },
        null,
        2,
      );
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="offgrid-${roomId}-export.json"`,
        "content-length": Buffer.byteLength(body),
      });
      res.end(body);
      log("info", "room.export", { room: roomId });
      return;
    }

    const roomRevoke = /^\/api\/rooms\/([^/]+)\/revoke$/.exec(path);
    if (method === "POST" && roomRevoke) {
      const roomId = decodeURIComponent(roomRevoke[1]!);
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        throw new HttpError(401, "BAD_TOKEN", "missing bearer token");
      }
      const token = header.slice(7);
      const body = (await readJsonOptional(req)) as { deviceId?: unknown } | null;
      const target = typeof body?.deviceId === "string" ? body.deviceId : null;

      if (target) {
        // Targeted revocation: a valid caller token is required; a moderator
        // may revoke any device (lost/stolen member device), anyone may
        // revoke their own — which covers every token row this device holds,
        // not just the presented one.
        const caller = requireToken(req, roomId);
        if (target !== caller.deviceId && !repo.isModerator(roomId, caller.deviceId)) {
          throw new HttpError(403, "NOT_MODERATOR", "only moderators can revoke other devices");
        }
        const tokens = repo.revokeDeviceTokens(roomId, target);
        let closed = 0;
        for (const conn of roomConns(roomId)) {
          if (conn.device?.id !== target) continue;
          send(conn, { t: "error", code: "BAD_TOKEN", message: "access revoked" });
          try {
            conn.ws.close(4001, "access revoked");
            closed += 1;
          } catch {
            /* socket is already dying */
          }
        }
        log("info", "room.revoke_device", {
          room: roomId,
          device: target,
          tokens,
          connections: closed,
          by: caller.deviceId,
        });
        return sendJson(res, 200, { revoked: true, tokens, connections: closed });
      }

      // Self path without a body — idempotent and oracle-free: an unknown,
      // already-expired or foreign-room token deletes nothing but gets the
      // same 200 — the response never reveals whether a presented token was
      // live. The presented row goes; if it was resolvable, every other
      // token row this device accumulated (one per past join) goes too.
      const resolved = repo.resolveToken(token, roomId);
      if (repo.revokeToken(token, roomId)) {
        if (resolved) repo.revokeDeviceTokens(roomId, resolved.deviceId);
        // Kill live connections riding the revoked token — otherwise an
        // established WS keeps full room access until it happens to
        // reconnect (and re-auth with the now-dead token).
        const hash = repo.hashToken(token);
        for (const conn of roomConns(roomId)) {
          if (conn.tokenHash !== hash) continue;
          send(conn, { t: "error", code: "BAD_TOKEN", message: "token revoked" });
          try {
            conn.ws.close(4001, "token revoked");
          } catch {
            /* socket is already dying */
          }
        }
        log("info", "room.revoke", { room: roomId });
      }
      return sendJson(res, 200, { revoked: true });
    }

    const roomMods = /^\/api\/rooms\/([^/]+)\/mods$/.exec(path);
    if (method === "POST" && roomMods) {
      const roomId = decodeURIComponent(roomMods[1]!);
      const caller = requireToken(req, roomId);
      if (!repo.isModerator(roomId, caller.deviceId)) {
        throw new HttpError(403, "NOT_MODERATOR", "only moderators can change the moderator list");
      }
      const input = modsSchema.parse(await readJson(req));
      const current = repo.getModerators(roomId);
      const next = input.on
        ? [...current, input.deviceId]
        : current.filter((id) => id !== input.deviceId);
      const moderators = repo.setModerators(roomId, next) ?? next;
      broadcast(roomId, { t: "room.settings", moderators });
      log("info", "room.moderators", {
        room: roomId,
        device: input.deviceId,
        on: input.on,
        by: caller.deviceId,
      });
      return sendJson(res, 200, { moderators });
    }

    const roomNotices = /^\/api\/rooms\/([^/]+)\/notices\/clear$/.exec(path);
    if (method === "POST" && roomNotices) {
      const roomId = decodeURIComponent(roomNotices[1]!);
      const caller = requireToken(req, roomId);
      if (!repo.isModerator(roomId, caller.deviceId)) {
        throw new HttpError(403, "NOT_MODERATOR", "only moderators can clear join notices");
      }
      // One deliberate moderator action, one transaction, tombstones out —
      // clients prune exactly like ordinary message deletions. This is the
      // only path that removes system messages: msg.del rejects them for
      // every actor, moderators included.
      const cleared = repo.clearSystemMessages(roomId);
      for (const tomb of cleared) {
        broadcast(roomId, { t: "msg.new", msg: tomb.msg, rev: tomb.rev });
      }
      log("info", "room.notices_cleared", {
        room: roomId,
        count: cleared.length,
        by: caller.deviceId,
      });
      return sendJson(res, 200, { cleared: cleared.length });
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

const modsSchema = z.object({
  deviceId: idPart,
  on: z.boolean(),
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

async function readBody(req: IncomingMessage): Promise<Buffer | null> {
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
  if (size === 0) return null;
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const body = await readBody(req);
  if (body === null) throw new ApiBodyError(400, "BAD_FRAME", "empty body");
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new ApiBodyError(400, "BAD_FRAME", "invalid json");
  }
}

/** Like readJson, but an absent body yields null instead of a 400. */
async function readJsonOptional(req: IncomingMessage): Promise<unknown | null> {
  const body = await readBody(req);
  if (body === null) return null;
  try {
    return JSON.parse(body.toString("utf8"));
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

  const hasPart = headerString(req, "x-part") !== "";
  const partRaw = Number(headerString(req, "x-part"));
  const part = hasPart ? Math.max(0, Math.floor(partRaw)) : 0;
  const more = headerString(req, "x-more") === "1";
  const encHeader = headerString(req, "x-enc") || "none";
  if (encHeader !== "none" && encHeader !== "gcm1") {
    throw new HttpError(400, "BAD_FRAME", "unknown X-Enc");
  }
  const enc: "none" | "gcm1" = encHeader;
  const plainSize = Number(headerString(req, "x-plain-size") || "0");
  if (enc === "gcm1" && (!Number.isInteger(plainSize) || plainSize < 0)) {
    throw new HttpError(400, "BAD_FRAME", "bad X-Plain-Size");
  }

  const existing = repo.getFile(roomId, fileId);
  if (existing && existing.deleted_at === null) {
    req.resume(); // drain the (already uploaded) body; idempotent retry
    return sendJson(res, 200, {
      fileId,
      rev: existing.rev,
      sha256: existing.sha256,
      size: existing.size,
      enc: existing.enc,
      existing: true,
    });
  }

  const roomDir = path.join(filesDir(), roomId);
  await fs.promises.mkdir(roomDir, { recursive: true });
  const finalPath = path.join(roomDir, fileId);
  const partPath = `${finalPath}.part`;

  if (hasPart && part > 0) {
    try {
      await fs.promises.access(partPath);
    } catch {
      throw new HttpError(400, "BAD_FRAME", "stale upload part");
    }
  }

  const truncate = !hasPart || part === 0;
  const startedBytes = truncate
    ? 0
    : (await fs.promises.stat(partPath).then((st) => st.size).catch(() => 0));

  try {
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(partPath, { flags: truncate ? "w" : "a" });
      let settled = false;
      let requestBytes = 0;
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        out.destroy();
        req.destroy();
        reject(error);
      };

      req.on("data", (chunk: Buffer) => {
        requestBytes += chunk.length;
        if (startedBytes + requestBytes > config.maxFileBytes) {
          fail(new HttpError(413, "PAYLOAD_TOO_LARGE", "file exceeds size cap"));
          return;
        }
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

  const stored = (await fs.promises.stat(partPath)).size;
  if (more) {
    return sendJson(res, 200, { fileId, part, stored });
  }

  if (enc === "gcm1") {
    const expected = fileCipherSize(plainSize);
    if (plainSize > config.maxFileBytes || stored !== expected) {
      await fs.promises.rm(partPath, { force: true }).catch(() => undefined);
      throw new HttpError(400, "BAD_FRAME", "ciphertext size mismatch");
    }
  }

  const sha256 = await hashFile(partPath);
  await fs.promises.rename(partPath, finalPath);
  const size = enc === "gcm1" ? plainSize : stored;

  const { file, rev, deduped } = repo.insertFile({
    id: fileId,
    roomId,
    deviceId: authed.deviceId,
    name: { ct: nameCt, iv: nameIv },
    mime,
    size,
    sha256,
    enc,
    path: finalPath,
  });
  log("info", "file.upload", { room: roomId, device: authed.deviceId, file: fileId, size, enc });
  return sendJson(res, deduped ? 200 : 201, {
    fileId: file.id,
    rev,
    sha256,
    size: file.size,
    enc: file.enc,
  });
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
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
