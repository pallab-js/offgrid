import { createHash, timingSafeEqual } from "node:crypto";
import { getDb, nextRev, currentRev } from "./index";
import { randomToken, ulid } from "../../src/lib/utils/id";
import type {
  Beacon,
  Channel,
  MeshEvent,
  Note,
  Peer,
  Sos,
  Waypoint,
} from "../../src/lib/protocol";
import {
  toBeacon,
  toChannel,
  toFileMeta,
  toMessage,
  toNote,
  toSos,
  toWaypoint,
  type BeaconRow,
  type ChannelRow,
  type DeviceRow,
  type FileRow,
  type MessageRow,
  type NoteRow,
  type ProgressRow,
  type RoomRow,
  type SosRow,
  type WaypointRow,
} from "./rows";

/** Typed domain error mapped to an HTTP/ws error code. */
export class RepoError extends Error {
  constructor(
    public code:
      | "ROOM_NOT_FOUND"
      | "BAD_PROOF"
      | "BAD_FRAME"
      | "BAD_TOKEN"
      | "NOT_IN_ROOM"
      | "INTERNAL",
    message: string,
  ) {
    super(message);
  }
}

/* --------------------------------------------------------------- rooms */

const DEFAULT_CHANNELS: Array<{ name: string; kind: Channel["kind"] }> = [
  { name: "general", kind: "normal" },
  { name: "logistics", kind: "normal" },
  { name: "sos", kind: "sos" },
];

export interface RoomMeta {
  id: string;
  name: string;
  salt: string;
  createdAt: number;
}

export function createRoom(input: {
  id: string;
  name: string;
  salt: string;
  proof: string;
}): { meta: RoomMeta; channels: Channel[] } {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM rooms WHERE id = ?")
      .get(input.id) as RoomRow | undefined;
    if (existing) throw new RepoError("BAD_FRAME", "room id already exists");

    db.prepare(
      "INSERT INTO rooms (id, name, salt, proof, created_at, settings) VALUES (?, ?, ?, ?, ?, '{}')",
    ).run(input.id, input.name, input.salt, input.proof, now);

    const channels = DEFAULT_CHANNELS.map((c) => {
      const rev = nextRev(db);
      const row: ChannelRow = {
        id: ulid(now),
        room_id: input.id,
        name: c.name,
        kind: c.kind,
        created_at: now,
        rev,
      };
      db.prepare(
        "INSERT INTO channels (id, room_id, name, kind, created_at, rev) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(row.id, row.room_id, row.name, row.kind, row.created_at, row.rev);
      return toChannel(row);
    });

    return {
      meta: { id: input.id, name: input.name, salt: input.salt, createdAt: now },
      channels,
    };
  });
  return tx();
}

export function getRoomMeta(roomId: string): RoomMeta | null {
  const row = getDb()
    .prepare("SELECT * FROM rooms WHERE id = ?")
    .get(roomId) as RoomRow | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, salt: row.salt, createdAt: row.created_at };
}

function getRoom(roomId: string): RoomRow | null {
  return (
    (getDb().prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as
      | RoomRow
      | undefined) ?? null
  );
}

/** Constant-time proof comparison (server never learns the passphrase). */
export function verifyProof(roomId: string, proofB64: string): boolean {
  const room = getRoom(roomId);
  if (!room) throw new RepoError("ROOM_NOT_FOUND", "unknown room");
  const a = Buffer.from(proofB64, "base64");
  const b = Buffer.from(room.proof, "base64");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function issueToken(roomId: string, deviceId: string): string {
  const token = randomToken(32);
  const hash = createHash("sha256").update(token).digest("hex");
  getDb()
    .prepare(
      "INSERT INTO tokens (hash, room_id, device_id, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(hash, roomId, deviceId, Date.now());
  return token;
}

export function resolveToken(
  token: string,
  roomId?: string,
): { roomId: string; deviceId: string } | null {
  const hash = createHash("sha256").update(token).digest("hex");
  const row = getDb()
    .prepare("SELECT room_id, device_id FROM tokens WHERE hash = ?")
    .get(hash) as { room_id: string; device_id: string } | undefined;
  if (!row) return null;
  if (roomId && row.room_id !== roomId) return null;
  return { roomId: row.room_id, deviceId: row.device_id };
}

/* ------------------------------------------------------------ channels */

export function listChannels(roomId: string): Channel[] {
  const rows = getDb()
    .prepare("SELECT * FROM channels WHERE room_id = ? ORDER BY created_at ASC")
    .all(roomId) as ChannelRow[];
  return rows.map(toChannel);
}

export function insertChannel(
  roomId: string,
  rawName: string,
): { channel: Channel; rev: number } {
  const name = rawName
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!name) throw new RepoError("BAD_FRAME", "invalid channel name");

  const db = getDb();
  return db.transaction(() => {
    const clash = db
      .prepare("SELECT id FROM channels WHERE room_id = ? AND name = ?")
      .get(roomId, name);
    if (clash) throw new RepoError("BAD_FRAME", "channel name taken");

    const now = Date.now();
    const rev = nextRev(db);
    const row: ChannelRow = {
      id: ulid(now),
      room_id: roomId,
      name,
      kind: "normal",
      created_at: now,
      rev,
    };
    db.prepare(
      "INSERT INTO channels (id, room_id, name, kind, created_at, rev) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(row.id, row.room_id, row.name, row.kind, row.created_at, row.rev);
    return { channel: toChannel(row), rev };
  })();
}

/* ------------------------------------------------------------- devices */

export function upsertDevice(input: {
  id: string;
  roomId: string;
  name: string;
  color: string;
}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO devices (id, room_id, name, color, created_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         room_id = excluded.room_id,
         name = excluded.name,
         color = excluded.color,
         last_seen = excluded.last_seen`,
    )
    .run(input.id, input.roomId, input.name, input.color, now, now);
}

export function updateDevicePresence(
  roomId: string,
  deviceId: string,
  patch: { battery?: number | null; rttMs?: number | null },
): void {
  const now = Date.now();
  const db = getDb();
  if (patch.battery !== undefined) {
    db.prepare(
      "UPDATE devices SET last_seen = ?, battery = ? WHERE id = ? AND room_id = ?",
    ).run(now, patch.battery, deviceId, roomId);
  }
  if (patch.rttMs !== undefined) {
    db.prepare(
      "UPDATE devices SET last_seen = ?, rtt = ? WHERE id = ? AND room_id = ?",
    ).run(now, patch.rttMs, deviceId, roomId);
  }
  if (patch.battery === undefined && patch.rttMs === undefined) {
    db.prepare("UPDATE devices SET last_seen = ? WHERE id = ? AND room_id = ?").run(
      now,
      deviceId,
      roomId,
    );
  }
}

export function listDevices(roomId: string): DeviceRow[] {
  return getDb()
    .prepare("SELECT * FROM devices WHERE room_id = ? ORDER BY created_at ASC")
    .all(roomId) as DeviceRow[];
}

export function buildPeers(
  roomId: string,
  online: Map<string, { rttMs: number | null }>,
): Peer[] {
  return listDevices(roomId).map((row) => {
    const live = online.get(row.id);
    return {
      deviceId: row.id,
      name: row.name,
      color: row.color,
      battery: row.battery === null ? null : Math.round(row.battery),
      rttMs: live?.rttMs ?? (row.rtt === null ? null : Math.round(row.rtt)),
      lastSeen: row.last_seen ?? row.created_at,
      online: Boolean(live),
    };
  });
}

/* ------------------------------------------------------------ messages */

export function findMessageByClient(
  roomId: string,
  clientId: string,
): MessageRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM messages WHERE room_id = ? AND client_id = ?")
      .get(roomId, clientId) as MessageRow | undefined) ?? null
  );
}

export function insertMessage(input: {
  roomId: string;
  clientId: string;
  channelId: string;
  deviceId: string;
  author: string;
  kind: "text" | "file";
  body: { ct: string; iv: string } | null;
  replyTo?: string | null;
  attachments: string[];
}): { msg: ReturnType<typeof toMessage>; rev: number; deduped: boolean } {
  const db = getDb();
  return db.transaction(() => {
    const existing = findMessageByClient(input.roomId, input.clientId);
    if (existing) return { msg: toMessage(existing), rev: existing.rev, deduped: true };

    const now = Date.now();
    const rev = nextRev(db);
    const row: MessageRow = {
      id: ulid(now),
      client_id: input.clientId,
      room_id: input.roomId,
      channel_id: input.channelId,
      device_id: input.deviceId,
      author: input.author,
      kind: input.kind,
      body: input.body?.ct ?? null,
      iv: input.body?.iv ?? null,
      reply_to: input.replyTo ?? null,
      attachments: JSON.stringify(input.attachments),
      created_at: now,
      deleted_at: null,
      rev,
    };
    db.prepare(
      `INSERT INTO messages (id, client_id, room_id, channel_id, device_id, author, kind, body, iv, reply_to, attachments, created_at, deleted_at, rev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.client_id,
      row.room_id,
      row.channel_id,
      row.device_id,
      row.author,
      row.kind,
      row.body,
      row.iv,
      row.reply_to,
      row.attachments,
      row.created_at,
      row.deleted_at,
      row.rev,
    );
    return { msg: toMessage(row), rev, deduped: false };
  })();
}

export function softDeleteMessage(
  roomId: string,
  id: string,
): { msg: ReturnType<typeof toMessage>; rev: number; changed: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM messages WHERE id = ? AND room_id = ?")
      .get(id, roomId) as MessageRow | undefined;
    if (!row) return null;
    if (row.deleted_at !== null) return { msg: toMessage(row), rev: row.rev, changed: false };
    const rev = nextRev(db);
    db.prepare("UPDATE messages SET deleted_at = ?, rev = ? WHERE id = ?").run(
      Date.now(),
      rev,
      id,
    );
    row.deleted_at = Date.now();
    row.rev = rev;
    return { msg: toMessage(row), rev, changed: true };
  })();
}

/* ----------------------------------------------------- LWW shared docs */

export function saveNote(input: {
  roomId: string;
  id?: string | undefined;
  title: { ct: string; iv: string };
  body: { ct: string; iv: string };
  updatedAt: number;
  updatedBy: string;
}): { note: Note; rev: number; changed: boolean } {
  const db = getDb();
  return db.transaction(() => {
    const existing = input.id
      ? ((db
          .prepare("SELECT * FROM notes WHERE id = ? AND room_id = ?")
          .get(input.id, input.roomId) as NoteRow | undefined) ?? null)
      : null;

    if (existing && !lwwWins(existing.updated_at, existing.updated_by, input.updatedAt, input.updatedBy)) {
      return { note: toNote(existing), rev: existing.rev, changed: false };
    }

    const rev = nextRev(db);
    if (existing) {
      db.prepare(
        "UPDATE notes SET title_ct = ?, title_iv = ?, body_ct = ?, body_iv = ?, updated_at = ?, updated_by = ?, deleted_at = NULL, rev = ? WHERE id = ?",
      ).run(
        input.title.ct,
        input.title.iv,
        input.body.ct,
        input.body.iv,
        input.updatedAt,
        input.updatedBy,
        rev,
        existing.id,
      );
      const row: NoteRow = {
        ...existing,
        title_ct: input.title.ct,
        title_iv: input.title.iv,
        body_ct: input.body.ct,
        body_iv: input.body.iv,
        updated_at: input.updatedAt,
        updated_by: input.updatedBy,
        deleted_at: null,
        rev,
      };
      return { note: toNote(row), rev, changed: true };
    }

    const id = input.id ?? ulid();
    const row: NoteRow = {
      id,
      room_id: input.roomId,
      title_ct: input.title.ct,
      title_iv: input.title.iv,
      body_ct: input.body.ct,
      body_iv: input.body.iv,
      updated_at: input.updatedAt,
      updated_by: input.updatedBy,
      deleted_at: null,
      rev,
    };
    db.prepare(
      "INSERT INTO notes (id, room_id, title_ct, title_iv, body_ct, body_iv, updated_at, updated_by, deleted_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.id,
      row.room_id,
      row.title_ct,
      row.title_iv,
      row.body_ct,
      row.body_iv,
      row.updated_at,
      row.updated_by,
      row.deleted_at,
      row.rev,
    );
    return { note: toNote(row), rev, changed: true };
  })();
}

export function deleteNote(input: {
  roomId: string;
  id: string;
  updatedAt: number;
  updatedBy: string;
}): { note: Note; rev: number; changed: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM notes WHERE id = ? AND room_id = ?")
      .get(input.id, input.roomId) as NoteRow | undefined;
    if (!existing) return null;
    if (!lwwWins(existing.updated_at, existing.updated_by, input.updatedAt, input.updatedBy)) {
      return { note: toNote(existing), rev: existing.rev, changed: false };
    }
    const rev = nextRev(db);
    db.prepare(
      "UPDATE notes SET updated_at = ?, updated_by = ?, deleted_at = ?, rev = ? WHERE id = ?",
    ).run(input.updatedAt, input.updatedBy, input.updatedAt, rev, input.id);
    const row: NoteRow = {
      ...existing,
      updated_at: input.updatedAt,
      updated_by: input.updatedBy,
      deleted_at: input.updatedAt,
      rev,
    };
    return { note: toNote(row), rev, changed: true };
  })();
}

export function setProgress(input: {
  roomId: string;
  itemId: string;
  checked: boolean;
  updatedAt: number;
  updatedBy: string;
}): { row: ProgressRow; rev: number; changed: boolean } {
  const db = getDb();
  return db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM progress WHERE room_id = ? AND item_id = ?")
      .get(input.roomId, input.itemId) as ProgressRow | undefined;
    if (
      existing &&
      !lwwWins(existing.updated_at, existing.updated_by, input.updatedAt, input.updatedBy)
    ) {
      return { row: existing, rev: existing.rev, changed: false };
    }
    const rev = nextRev(db);
    db.prepare(
      `INSERT INTO progress (room_id, item_id, checked, updated_at, updated_by, rev)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(room_id, item_id) DO UPDATE SET
         checked = excluded.checked,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by,
         rev = excluded.rev`,
    ).run(
      input.roomId,
      input.itemId,
      input.checked ? 1 : 0,
      input.updatedAt,
      input.updatedBy,
      rev,
    );
    const row: ProgressRow = {
      room_id: input.roomId,
      item_id: input.itemId,
      checked: input.checked ? 1 : 0,
      updated_at: input.updatedAt,
      updated_by: input.updatedBy,
      rev,
    };
    return { row, rev, changed: true };
  })();
}

export function saveWaypoint(input: {
  roomId: string;
  id?: string | undefined;
  lat: number | null;
  lng: number | null;
  gx: number | null;
  gy: number | null;
  label: { ct: string; iv: string };
  color: string;
  updatedAt: number;
  updatedBy: string;
}): { waypoint: Waypoint; rev: number; changed: boolean } {
  const db = getDb();
  return db.transaction(() => {
    const existing = input.id
      ? ((db
          .prepare("SELECT * FROM waypoints WHERE id = ? AND room_id = ?")
          .get(input.id, input.roomId) as WaypointRow | undefined) ?? null)
      : null;

    if (
      existing &&
      !lwwWins(existing.updated_at, existing.updated_by, input.updatedAt, input.updatedBy)
    ) {
      return { waypoint: toWaypoint(existing), rev: existing.rev, changed: false };
    }

    const rev = nextRev(db);
    if (existing) {
      db.prepare(
        "UPDATE waypoints SET lat = ?, lng = ?, gx = ?, gy = ?, label_ct = ?, label_iv = ?, color = ?, updated_at = ?, updated_by = ?, deleted_at = NULL, rev = ? WHERE id = ?",
      ).run(
        input.lat,
        input.lng,
        input.gx,
        input.gy,
        input.label.ct,
        input.label.iv,
        input.color,
        input.updatedAt,
        input.updatedBy,
        rev,
        existing.id,
      );
      const row: WaypointRow = {
        ...existing,
        lat: input.lat,
        lng: input.lng,
        gx: input.gx,
        gy: input.gy,
        label_ct: input.label.ct,
        label_iv: input.label.iv,
        color: input.color,
        updated_at: input.updatedAt,
        updated_by: input.updatedBy,
        deleted_at: null,
        rev,
      };
      return { waypoint: toWaypoint(row), rev, changed: true };
    }

    const id = input.id ?? ulid();
    const row: WaypointRow = {
      id,
      room_id: input.roomId,
      lat: input.lat,
      lng: input.lng,
      gx: input.gx,
      gy: input.gy,
      label_ct: input.label.ct,
      label_iv: input.label.iv,
      color: input.color,
      updated_at: input.updatedAt,
      updated_by: input.updatedBy,
      deleted_at: null,
      rev,
    };
    db.prepare(
      "INSERT INTO waypoints (id, room_id, lat, lng, gx, gy, label_ct, label_iv, color, updated_at, updated_by, deleted_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.id,
      row.room_id,
      row.lat,
      row.lng,
      row.gx,
      row.gy,
      row.label_ct,
      row.label_iv,
      row.color,
      row.updated_at,
      row.updated_by,
      row.deleted_at,
      row.rev,
    );
    return { waypoint: toWaypoint(row), rev, changed: true };
  })();
}

export function deleteWaypoint(input: {
  roomId: string;
  id: string;
  updatedAt: number;
  updatedBy: string;
}): { waypoint: Waypoint; rev: number; changed: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM waypoints WHERE id = ? AND room_id = ?")
      .get(input.id, input.roomId) as WaypointRow | undefined;
    if (!existing) return null;
    if (
      !lwwWins(existing.updated_at, existing.updated_by, input.updatedAt, input.updatedBy)
    ) {
      return { waypoint: toWaypoint(existing), rev: existing.rev, changed: false };
    }
    const rev = nextRev(db);
    db.prepare(
      "UPDATE waypoints SET updated_at = ?, updated_by = ?, deleted_at = ?, rev = ? WHERE id = ?",
    ).run(input.updatedAt, input.updatedBy, input.updatedAt, rev, input.id);
    const row: WaypointRow = {
      ...existing,
      updated_at: input.updatedAt,
      updated_by: input.updatedBy,
      deleted_at: input.updatedAt,
      rev,
    };
    return { waypoint: toWaypoint(row), rev, changed: true };
  })();
}

export function raiseSos(input: {
  roomId: string;
  deviceId: string;
  note: { ct: string; iv: string } | null;
  lat: number | null;
  lng: number | null;
}): { sos: Sos; rev: number; changed: boolean } {
  const db = getDb();
  return db.transaction(() => {
    const active = db
      .prepare(
        "SELECT * FROM sos_events WHERE room_id = ? AND device_id = ? AND active = 1",
      )
      .get(input.roomId, input.deviceId) as SosRow | undefined;
    const now = Date.now();

    if (active) {
      const rev = nextRev(db);
      db.prepare(
        "UPDATE sos_events SET note_ct = ?, note_iv = ?, lat = ?, lng = ?, rev = ? WHERE id = ?",
      ).run(
        input.note?.ct ?? null,
        input.note?.iv ?? null,
        input.lat,
        input.lng,
        rev,
        active.id,
      );
      const row: SosRow = {
        ...active,
        note_ct: input.note?.ct ?? null,
        note_iv: input.note?.iv ?? null,
        lat: input.lat,
        lng: input.lng,
        rev,
      };
      return { sos: toSos(row), rev, changed: true };
    }

    const rev = nextRev(db);
    const row: SosRow = {
      id: ulid(now),
      room_id: input.roomId,
      device_id: input.deviceId,
      note_ct: input.note?.ct ?? null,
      note_iv: input.note?.iv ?? null,
      lat: input.lat,
      lng: input.lng,
      active: 1,
      created_at: now,
      cleared_at: null,
      cleared_by: null,
      rev,
    };
    db.prepare(
      "INSERT INTO sos_events (id, room_id, device_id, note_ct, note_iv, lat, lng, active, created_at, cleared_at, cleared_by, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.id,
      row.room_id,
      row.device_id,
      row.note_ct,
      row.note_iv,
      row.lat,
      row.lng,
      row.active,
      row.created_at,
      row.cleared_at,
      row.cleared_by,
      row.rev,
    );
    return { sos: toSos(row), rev, changed: true };
  })();
}

/** Clearing an SOS always wins (safety over LWW). */
export function clearSos(input: {
  roomId: string;
  id: string;
  deviceId: string;
}): { sos: Sos; rev: number; changed: boolean } | null {
  const db = getDb();
  return db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM sos_events WHERE id = ? AND room_id = ?")
      .get(input.id, input.roomId) as SosRow | undefined;
    if (!row) return null;
    if (row.active === 0) return { sos: toSos(row), rev: row.rev, changed: false };
    const rev = nextRev(db);
    db.prepare(
      "UPDATE sos_events SET active = 0, cleared_at = ?, cleared_by = ?, rev = ? WHERE id = ?",
    ).run(Date.now(), input.deviceId, rev, input.id);
    const updated: SosRow = {
      ...row,
      active: 0,
      cleared_at: Date.now(),
      cleared_by: input.deviceId,
      rev,
    };
    return { sos: toSos(updated), rev, changed: true };
  })();
}

export function insertBeacon(input: {
  roomId: string;
  deviceId: string;
  text: { ct: string; iv: string };
  wpm: number;
}): { beacon: Beacon; rev: number } {
  const db = getDb();
  return db.transaction(() => {
    const now = Date.now();
    const rev = nextRev(db);
    const row: BeaconRow = {
      id: ulid(now),
      room_id: input.roomId,
      device_id: input.deviceId,
      text_ct: input.text.ct,
      text_iv: input.text.iv,
      wpm: input.wpm,
      created_at: now,
      rev,
    };
    db.prepare(
      "INSERT INTO beacons (id, room_id, device_id, text_ct, text_iv, wpm, created_at, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      row.id,
      row.room_id,
      row.device_id,
      row.text_ct,
      row.text_iv,
      row.wpm,
      row.created_at,
      row.rev,
    );
    return { beacon: toBeacon(row), rev };
  })();
}

/* --------------------------------------------------------------- sync */

interface SyncRow {
  kind: string;
  id: string;
  rev: number;
}

export function syncEvents(
  roomId: string,
  cursor: number,
  limit: number,
): { events: MeshEvent[]; cursor: number; done: boolean } {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT 'message' AS kind, id, rev FROM messages WHERE room_id = ? AND rev > ?
       UNION ALL SELECT 'note', id, rev FROM notes WHERE room_id = ? AND rev > ?
       UNION ALL SELECT 'progress', item_id, rev FROM progress WHERE room_id = ? AND rev > ?
       UNION ALL SELECT 'waypoint', id, rev FROM waypoints WHERE room_id = ? AND rev > ?
       UNION ALL SELECT 'sos', id, rev FROM sos_events WHERE room_id = ? AND rev > ?
       UNION ALL SELECT 'file', id, rev FROM files WHERE room_id = ? AND rev > ?
       UNION ALL SELECT 'beacon', id, rev FROM beacons WHERE room_id = ? AND rev > ?
       UNION ALL SELECT 'channel', id, rev FROM channels WHERE room_id = ? AND rev > ?
       ORDER BY rev ASC
       LIMIT ?`,
    )
    .all(
      roomId, cursor,
      roomId, cursor,
      roomId, cursor,
      roomId, cursor,
      roomId, cursor,
      roomId, cursor,
      roomId, cursor,
      roomId, cursor,
      limit,
    ) as SyncRow[];

  const byKind = new Map<string, string[]>();
  for (const row of rows) {
    const list = byKind.get(row.kind) ?? [];
    list.push(row.id);
    byKind.set(row.kind, list);
  }

  const hydrate = <R extends { rev: number }, T>(
    kind: string,
    table: string,
    map: (row: R) => T,
    toEvent: (item: T, rev: number) => MeshEvent,
  ): void => {
    const ids = byKind.get(kind);
    if (!ids?.length) return;
    const placeholders = ids.map(() => "?").join(",");
    const found = db
      .prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`)
      .all(...ids) as R[];
    for (const row of found) {
      events.push(toEvent(map(row), row.rev));
    }
  };

  const events: MeshEvent[] = [];
  hydrate("message", "messages", toMessage, (msg, rev) => ({
    t: "msg.new",
    msg,
    rev,
  }));
  hydrate("note", "notes", toNote, (note, rev) => ({
    t: "note.upsert",
    note,
    rev,
  }));
  hydrate("waypoint", "waypoints", toWaypoint, (waypoint, rev) => ({
    t: "wp.upsert",
    waypoint,
    rev,
  }));
  hydrate("sos", "sos_events", toSos, (sos, rev) => ({
    t: "sos.raised",
    sos,
    rev,
  }));
  hydrate("beacon", "beacons", toBeacon, (beacon, rev) => ({
    t: "beacon.new",
    beacon,
    rev,
  }));
  hydrate("channel", "channels", toChannel, (channel, rev) => ({
    t: "channel.new",
    channel,
    rev,
  }));

  const progressIds = byKind.get("progress");
  if (progressIds?.length) {
    const placeholders = progressIds.map(() => "?").join(",");
    const found = db
      .prepare(`SELECT * FROM progress WHERE item_id IN (${placeholders}) AND room_id = ?`)
      .all(...progressIds, roomId) as ProgressRow[];
    for (const row of found) {
      events.push({
        t: "check.update",
        itemId: row.item_id,
        checked: row.checked === 1,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
        rev: row.rev,
      });
    }
  }

  // Files hydrate through the dedicated meta mapper.
  const fileIds = byKind.get("file");
  if (fileIds?.length) {
    const placeholders = fileIds.map(() => "?").join(",");
    const found = db
      .prepare(`SELECT * FROM files WHERE id IN (${placeholders})`)
      .all(...fileIds) as FileRow[];
    for (const row of found) {
      events.push({ t: "file.new", file: toFileMeta(row), rev: row.rev });
    }
  }

  events.sort((a, b) => a.rev - b.rev);
  const last = events.length ? events[events.length - 1]!.rev : cursor;
  return {
    events,
    cursor: Math.max(cursor, last),
    done: rows.length < limit,
  };
}

/** LWW: incoming wins when strictly newer; equal timestamps tie-break on
 * deviceId so every peer converges deterministically (SDA §5.5). */
function lwwWins(
  existingAt: number,
  existingBy: string,
  incomingAt: number,
  incomingBy: string,
): boolean {
  if (incomingAt !== existingAt) return incomingAt > existingAt;
  return incomingBy > existingBy;
}

export { currentRev };

/* ------------------------------------------------ chat (P2) helpers */

export function findChannel(roomId: string, channelId: string): ChannelRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM channels WHERE id = ? AND room_id = ?")
      .get(channelId, roomId) as ChannelRow | undefined) ?? null
  );
}

/**
 * Join notice — at most one per device per 30 minutes so reconnects and
 * reloads don't spam the channel.
 */
export function insertSystemMessageIfQuiet(
  roomId: string,
  deviceId: string,
  author: string,
): { msg: ReturnType<typeof toMessage>; rev: number } | null {
  const db = getDb();
  return db.transaction(() => {
    const channel = db
      .prepare("SELECT id FROM channels WHERE room_id = ? AND name = 'general'")
      .get(roomId) as { id: string } | undefined;
    if (!channel) return null;

    const since = Date.now() - 30 * 60 * 1000;
    const recent = db
      .prepare(
        "SELECT id FROM messages WHERE room_id = ? AND device_id = ? AND kind = 'system' AND created_at > ?",
      )
      .get(roomId, deviceId, since);
    if (recent) return null;

    const now = Date.now();
    const rev = nextRev(db);
    const row: MessageRow = {
      id: ulid(now),
      client_id: null,
      room_id: roomId,
      channel_id: channel.id,
      device_id: deviceId,
      author,
      kind: "system",
      body: null,
      iv: null,
      reply_to: null,
      attachments: "[]",
      created_at: now,
      deleted_at: null,
      rev,
    };
    db.prepare(
      `INSERT INTO messages (id, client_id, room_id, channel_id, device_id, author, kind, body, iv, reply_to, attachments, created_at, deleted_at, rev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id, row.client_id, row.room_id, row.channel_id, row.device_id,
      row.author, row.kind, row.body, row.iv, row.reply_to, row.attachments,
      row.created_at, row.deleted_at, row.rev,
    );
    return { msg: toMessage(row), rev };
  })();
}
