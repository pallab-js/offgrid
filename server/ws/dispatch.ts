import {
  RATE_LIMIT_PER_SEC,
  SYNC_BATCH_LIMIT,
  c2sSchema,
  type ClientFrame,
  type ErrorCode,
  type MeshEvent,
} from "../../src/lib/protocol";
import { currentRev } from "../db/index";
import * as repo from "../db/repo";
import { toFileMeta } from "../db/rows";
import { log } from "../log";
import { broadcast, enterRoom, exitRoom, onlinePeers, send, type Conn } from "./registry";

export function handleMessage(conn: Conn, raw: string): void {
  conn.lastFrameAt = Date.now();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return sendError(conn, "BAD_FRAME", "invalid json");
  }

  const parsed = c2sSchema.safeParse(json);
  if (!parsed.success) {
    return sendError(conn, "BAD_FRAME", "invalid frame");
  }
  const frame = parsed.data;

  if (frame.t !== "ping" && !allow(conn)) {
    return sendError(conn, "RATE_LIMITED", "too many frames");
  }

  try {
    dispatch(conn, frame);
  } catch (error) {
    if (error instanceof repo.RepoError) {
      return sendError(conn, error.code, error.message);
    }
    log("error", "frame.unhandled", { code: frame.t, error: String(error) });
    sendError(conn, "INTERNAL", "server error");
  }
}

function dispatch(conn: Conn, frame: ClientFrame): void {
  switch (frame.t) {
    case "ping": {
      send(conn, { t: "pong", ts: frame.ts, serverTs: Date.now() });
      return;
    }

    case "join": {
      const resolved = repo.resolveToken(frame.token);
      if (!resolved) throw new repo.RepoError("BAD_TOKEN", "invalid token");
      const meta = repo.getRoomMeta(resolved.roomId);
      if (!meta) throw new repo.RepoError("ROOM_NOT_FOUND", "room gone");

      if (conn.roomId && conn.roomId !== resolved.roomId) {
        const previous = conn.roomId;
        exitRoom(conn);
        emitPresence(previous);
      }

      repo.upsertDevice({
        id: frame.device.id,
        roomId: resolved.roomId,
        name: frame.device.name,
        color: frame.device.color,
      });
      conn.device = frame.device;
      enterRoom(conn, resolved.roomId);

      send(conn, {
        t: "joined",
        room: { id: meta.id, name: meta.name },
        channels: repo.listChannels(meta.id),
        device: frame.device,
        cursor: currentRev(),
        serverTime: Date.now(),
      });
      emitPresence(resolved.roomId);
      const system = repo.insertSystemMessageIfQuiet(
        resolved.roomId,
        frame.device.id,
        frame.device.name,
      );
      if (system) {
        emit(resolved.roomId, { t: "msg.new", msg: system.msg, rev: system.rev });
      }
      log("info", "ws.join", { room: meta.id, device: frame.device.id });
      return;
    }

    case "leave": {
      const previous = conn.roomId;
      exitRoom(conn);
      if (previous) emitPresence(previous);
      return;
    }

    case "presence.update": {
      const room = requireRoom(conn);
      if (frame.battery !== undefined) conn.battery = frame.battery;
      if (frame.rttMs !== undefined) conn.rttMs = frame.rttMs;
      repo.updateDevicePresence(room, conn.device!.id, {
        battery: frame.battery ?? undefined,
        rttMs: frame.rttMs ?? undefined,
      });
      emitPresence(room);
      return;
    }

    case "sync.pull": {
      const room = requireRoom(conn);
      const batch = repo.syncEvents(room, frame.cursor, SYNC_BATCH_LIMIT);
      send(conn, { t: "sync.batch", ...batch });
      return;
    }

    case "msg.send": {
      const room = requireRoom(conn);
      if (!repo.findChannel(room, frame.channelId)) {
        throw new repo.RepoError("BAD_FRAME", "unknown channel");
      }
      const { msg, rev, deduped } = repo.insertMessage({
        roomId: room,
        clientId: frame.clientId,
        channelId: frame.channelId,
        deviceId: conn.device!.id,
        author: conn.device!.name,
        kind: frame.kind,
        body: frame.body,
        replyTo: frame.replyTo ?? null,
        attachments: frame.attachments,
      });
      ack(conn, frame.clientId, msg.id, rev);
      if (!deduped) emit(room, { t: "msg.new", msg, rev });
      return;
    }

    case "msg.del": {
      const room = requireRoom(conn);
      const result = repo.softDeleteMessage(room, frame.id);
      if (!result) throw new repo.RepoError("BAD_FRAME", "message not found");
      if (result.msg.deviceId !== conn.device!.id && result.msg.kind !== "system") {
        throw new repo.RepoError("BAD_FRAME", "not your message");
      }
      ack(conn, frame.clientId, result.msg.id, result.rev);
      if (result.changed) emit(room, { t: "msg.new", msg: result.msg, rev: result.rev });
      return;
    }

    case "msg.react": {
      const room = requireRoom(conn);
      const result = repo.setReaction(room, frame.id, frame.emoji, conn.device!.id, frame.on);
      if (!result) throw new repo.RepoError("BAD_FRAME", "message not found");
      ack(conn, frame.clientId, result.msg.id, result.rev);
      if (result.changed) emit(room, { t: "msg.new", msg: result.msg, rev: result.rev });
      return;
    }

    case "msg.read": {
      const room = requireRoom(conn);
      const result = repo.setRead(room, frame.channelId, conn.device!.id, frame.at);
      if (result.changed) {
        emit(room, {
          t: "channel.read",
          channelId: frame.channelId,
          deviceId: conn.device!.id,
          at: frame.at,
          rev: result.rev,
        });
      }
      return;
    }

    case "file.announce": {
      const room = requireRoom(conn);
      const row = repo.getFile(room, frame.fileId);
      if (!row) throw new repo.RepoError("BAD_FRAME", "unknown file");
      ack(conn, frame.clientId, row.id, row.rev);
      if (row.deleted_at === null) {
        emit(room, { t: "file.new", file: toFileMeta(row), rev: row.rev });
      }
      return;
    }

    case "file.del": {
      const room = requireRoom(conn);
      const row = repo.getFile(room, frame.fileId);
      if (!row) throw new repo.RepoError("BAD_FRAME", "unknown file");
      if (row.device_id !== conn.device!.id) {
        throw new repo.RepoError("BAD_FRAME", "not your file");
      }
      const result = repo.softDeleteFile(room, frame.fileId);
      if (!result) throw new repo.RepoError("BAD_FRAME", "unknown file");
      ack(conn, frame.clientId, result.file.id, result.rev);
      if (result.changed) {
        void unlinkFile(result.file.id, room);
        emit(room, { t: "file.deleted", id: result.file.id, rev: result.rev });
      }
      return;
    }

    case "note.save": {
      const room = requireRoom(conn);
      const { note, rev, changed } = repo.saveNote({
        roomId: room,
        id: frame.id,
        title: frame.title,
        body: frame.body,
        updatedAt: frame.updatedAt,
        updatedBy: conn.device!.id,
      });
      ack(conn, frame.clientId, note.id, rev);
      if (changed) emit(room, { t: "note.upsert", note, rev });
      return;
    }

    case "note.del": {
      const room = requireRoom(conn);
      const result = repo.deleteNote({
        roomId: room,
        id: frame.id,
        updatedAt: frame.updatedAt,
        updatedBy: conn.device!.id,
      });
      if (!result) throw new repo.RepoError("BAD_FRAME", "note not found");
      ack(conn, frame.clientId, result.note.id, result.rev);
      if (result.changed) emit(room, { t: "note.deleted", id: frame.id, rev: result.rev });
      return;
    }

    case "check.set": {
      const room = requireRoom(conn);
      const { row, rev, changed } = repo.setProgress({
        roomId: room,
        itemId: frame.itemId,
        checked: frame.checked,
        updatedAt: frame.updatedAt,
        updatedBy: conn.device!.id,
      });
      ack(conn, frame.clientId, row.item_id, rev);
      if (changed) {
        emit(room, {
          t: "check.update",
          itemId: row.item_id,
          checked: row.checked === 1,
          updatedAt: row.updated_at,
          updatedBy: row.updated_by,
          rev,
        });
      }
      return;
    }

    case "wp.save": {
      const room = requireRoom(conn);
      const { waypoint, rev, changed } = repo.saveWaypoint({
        roomId: room,
        id: frame.id,
        lat: frame.lat ?? null,
        lng: frame.lng ?? null,
        gx: frame.gx ?? null,
        gy: frame.gy ?? null,
        label: frame.label,
        color: frame.color,
        updatedAt: frame.updatedAt,
        updatedBy: conn.device!.id,
      });
      ack(conn, frame.clientId, waypoint.id, rev);
      if (changed) emit(room, { t: "wp.upsert", waypoint, rev });
      return;
    }

    case "wp.del": {
      const room = requireRoom(conn);
      const result = repo.deleteWaypoint({
        roomId: room,
        id: frame.id,
        updatedAt: frame.updatedAt,
        updatedBy: conn.device!.id,
      });
      if (!result) throw new repo.RepoError("BAD_FRAME", "waypoint not found");
      ack(conn, frame.clientId, result.waypoint.id, result.rev);
      if (result.changed) emit(room, { t: "wp.deleted", id: frame.id, rev: result.rev });
      return;
    }

    case "sos.raise": {
      const room = requireRoom(conn);
      const { sos, rev } = repo.raiseSos({
        roomId: room,
        deviceId: conn.device!.id,
        note: frame.note ?? null,
        lat: frame.lat ?? null,
        lng: frame.lng ?? null,
      });
      ack(conn, frame.clientId, sos.id, rev);
      emit(room, { t: "sos.raised", sos, rev });
      log("warn", "sos.raise", { room, device: conn.device!.id });
      return;
    }

    case "sos.clear": {
      const room = requireRoom(conn);
      const result = repo.clearSos({ roomId: room, id: frame.id, deviceId: conn.device!.id });
      if (!result) throw new repo.RepoError("BAD_FRAME", "sos not found");
      ack(conn, frame.clientId, result.sos.id, result.rev);
      if (result.changed) emit(room, { t: "sos.cleared", id: frame.id, rev: result.rev });
      return;
    }

    case "beacon.share": {
      const room = requireRoom(conn);
      const { beacon, rev } = repo.insertBeacon({
        roomId: room,
        deviceId: conn.device!.id,
        text: frame.text,
        wpm: frame.wpm,
      });
      ack(conn, frame.clientId, beacon.id, rev);
      emit(room, { t: "beacon.new", beacon, rev });
      return;
    }

    case "channel.create": {
      const room = requireRoom(conn);
      const { channel, rev } = repo.insertChannel(room, frame.name);
      ack(conn, frame.clientId, channel.id, rev);
      emit(room, { t: "channel.new", channel, rev });
      return;
    }

    case "typing": {
      const room = requireRoom(conn);
      broadcast(room, {
        t: "typing",
        channelId: frame.channelId,
        deviceId: conn.device!.id,
        on: frame.on,
      });
      return;
    }

    default: {
      // zod guarantees exhaustiveness; runtime never lands here.
      const unreachable: never = frame;
      void unreachable;
    }
  }
}

/* ------------------------------------------------------------ helpers */

function requireRoom(conn: Conn): string {
  if (!conn.roomId || !conn.device) {
    throw new repo.RepoError("NOT_IN_ROOM", "join a room first");
  }
  return conn.roomId;
}

function ack(conn: Conn, ref: string, id: string, rev: number): void {
  send(conn, { t: "ack", ref, id, rev });
}

function emit(roomId: string, event: MeshEvent): void {
  broadcast(roomId, event);
}

export function emitPresence(roomId: string): void {
  broadcast(roomId, {
    t: "presence",
    peers: repo.buildPeers(roomId, onlinePeers(roomId)),
  });
}

function sendError(conn: Conn, code: ErrorCode, message: string, ref?: string): void {
  send(conn, { t: "error", code, message, ...(ref ? { ref } : {}) });
}

async function unlinkFile(fileId: string, roomId: string): Promise<void> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { filesDir } = await import("../config");
    const base = path.join(filesDir(), roomId, fileId);
    await fs.rm(base, { force: true });
    await fs.rm(`${base}.part`, { force: true });
  } catch (error) {
    log("warn", "file.unlink.failed", { room: roomId, file: fileId, error: String(error) });
  }
}

function allow(conn: Conn): boolean {
  const now = Date.now();
  if (now - conn.windowStart >= 1000) {
    conn.windowStart = now;
    conn.windowCount = 0;
  }
  conn.windowCount += 1;
  return conn.windowCount <= RATE_LIMIT_PER_SEC;
}
