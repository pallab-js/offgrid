import type {
  Beacon,
  Channel,
  Cipher,
  FileMeta,
  Message,
  Note,
  Sos,
  Waypoint,
} from "../../src/lib/protocol";

/* ----------------------------------------------------------- row shapes */

export interface RoomRow {
  id: string;
  name: string;
  salt: string;
  proof: string;
  created_at: number;
  settings: string;
}

export interface ChannelRow {
  id: string;
  room_id: string;
  name: string;
  kind: string;
  created_at: number;
  rev: number;
}

export interface MessageRow {
  id: string;
  client_id: string | null;
  room_id: string;
  channel_id: string;
  device_id: string;
  author: string;
  kind: string;
  body: string | null;
  iv: string | null;
  reply_to: string | null;
  attachments: string;
  reactions: string;
  created_at: number;
  deleted_at: number | null;
  rev: number;
}

export interface ReadRow {
  id: string;
  room_id: string;
  channel_id: string;
  device_id: string;
  at: number;
  rev: number;
}

export interface DeviceRow {
  id: string;
  room_id: string;
  name: string;
  color: string;
  created_at: number;
  last_seen: number | null;
  battery: number | null;
  rtt: number | null;
  meta: string;
}

export interface NoteRow {
  id: string;
  room_id: string;
  title_ct: string;
  title_iv: string;
  body_ct: string;
  body_iv: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
  rev: number;
}

export interface ProgressRow {
  room_id: string;
  item_id: string;
  checked: number;
  updated_at: number;
  updated_by: string;
  rev: number;
}

export interface WaypointRow {
  id: string;
  room_id: string;
  lat: number | null;
  lng: number | null;
  gx: number | null;
  gy: number | null;
  label_ct: string;
  label_iv: string;
  color: string;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
  rev: number;
}

export interface SosRow {
  id: string;
  room_id: string;
  device_id: string;
  note_ct: string | null;
  note_iv: string | null;
  lat: number | null;
  lng: number | null;
  active: number;
  created_at: number;
  cleared_at: number | null;
  cleared_by: string | null;
  rev: number;
}

export interface BeaconRow {
  id: string;
  room_id: string;
  device_id: string;
  text_ct: string;
  text_iv: string;
  wpm: number;
  created_at: number;
  rev: number;
}

export interface FileRow {
  id: string;
  room_id: string;
  device_id: string;
  name_ct: string;
  name_iv: string;
  mime: string;
  size: number;
  sha256: string | null;
  enc: string;
  path: string;
  created_at: number;
  deleted_at: number | null;
  rev: number;
}

/* ------------------------------------------------------------- mappers */

const cipher = (ct: string | null, iv: string | null): Cipher | null =>
  ct && iv ? { ct, iv } : null;

export const toChannel = (r: ChannelRow): Channel => ({
  id: r.id,
  roomId: r.room_id,
  name: r.name,
  kind: (r.kind as Channel["kind"]) ?? "normal",
  createdAt: r.created_at,
});

export const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  clientId: r.client_id,
  channelId: r.channel_id,
  deviceId: r.device_id,
  author: r.author,
  kind: (r.kind as Message["kind"]) ?? "text",
  body: cipher(r.body, r.iv),
  replyTo: r.reply_to,
  attachments: safeArray(r.attachments),
  reactions: safeReactions(r.reactions),
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
  rev: r.rev,
});

export const toNote = (r: NoteRow): Note => ({
  id: r.id,
  title: { ct: r.title_ct, iv: r.title_iv },
  body: { ct: r.body_ct, iv: r.body_iv },
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
  deletedAt: r.deleted_at,
  rev: r.rev,
});

export const toWaypoint = (r: WaypointRow): Waypoint => ({
  id: r.id,
  lat: r.lat,
  lng: r.lng,
  gx: r.gx,
  gy: r.gy,
  label: { ct: r.label_ct, iv: r.label_iv },
  color: r.color,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
  deletedAt: r.deleted_at,
  rev: r.rev,
});

export const toSos = (r: SosRow): Sos => ({
  id: r.id,
  deviceId: r.device_id,
  note: cipher(r.note_ct, r.note_iv),
  lat: r.lat,
  lng: r.lng,
  active: r.active === 1,
  createdAt: r.created_at,
  clearedAt: r.cleared_at,
  rev: r.rev,
});

export const toBeacon = (r: BeaconRow): Beacon => ({
  id: r.id,
  deviceId: r.device_id,
  text: { ct: r.text_ct, iv: r.text_iv },
  wpm: r.wpm,
  createdAt: r.created_at,
  rev: r.rev,
});

export const toFileMeta = (r: FileRow): FileMeta => ({
  id: r.id,
  deviceId: r.device_id,
  name: { ct: r.name_ct, iv: r.name_iv },
  mime: r.mime,
  size: r.size,
  sha256: r.sha256,
  enc: r.enc === "gcm1" ? "gcm1" : "none",
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
  rev: r.rev,
});

export const toRead = (r: ReadRow): { channelId: string; deviceId: string; at: number } => ({
  channelId: r.channel_id,
  deviceId: r.device_id,
  at: r.at,
});

function safeReactions(json: string | undefined): Message["reactions"] {
  try {
    const parsed = JSON.parse(json ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is Message["reactions"][number] =>
        x && typeof x.emoji === "string" && typeof x.deviceId === "string" && typeof x.at === "number",
    );
  } catch {
    return [];
  }
}

function safeArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
