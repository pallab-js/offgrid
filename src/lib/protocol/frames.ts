import { z } from "zod";
import { ERROR_CODES } from "./constants";

/* ------------------------------------------------------------------ atoms */

export const cipherSchema = z.object({
  ct: z.string().max(1_048_576),
  iv: z.string().max(64),
});
export type Cipher = z.infer<typeof cipherSchema>;

const idSchema = z.string().min(1).max(64);
const epochMs = z.number().int().nonnegative();
const colorSchema = z.string().min(1).max(32);

export const deviceSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(40),
  color: colorSchema,
});
export type Device = z.infer<typeof deviceSchema>;

export const channelSchema = z.object({
  id: idSchema,
  roomId: idSchema,
  name: z.string().min(1).max(40),
  kind: z.enum(["normal", "sos", "system"]),
  createdAt: epochMs,
});
export type Channel = z.infer<typeof channelSchema>;

export const messageSchema = z.object({
  id: idSchema,
  clientId: idSchema.nullable(),
  channelId: idSchema,
  deviceId: idSchema,
  author: z.string().min(1).max(40),
  kind: z.enum(["text", "file", "system"]),
  body: cipherSchema.nullable(),
  replyTo: idSchema.nullable(),
  attachments: z.array(idSchema).max(16),
  createdAt: epochMs,
  deletedAt: epochMs.nullable(),
  rev: z.number().int().positive(),
});
export type Message = z.infer<typeof messageSchema>;

export const peerSchema = z.object({
  deviceId: idSchema,
  name: z.string().min(1).max(40),
  color: colorSchema,
  battery: z.number().min(0).max(100).nullable(),
  rttMs: z.number().int().nonnegative().nullable(),
  lastSeen: epochMs,
  online: z.boolean(),
});
export type Peer = z.infer<typeof peerSchema>;

export const noteSchema = z.object({
  id: idSchema,
  title: cipherSchema,
  body: cipherSchema,
  updatedAt: epochMs,
  updatedBy: idSchema,
  deletedAt: epochMs.nullable(),
  rev: z.number().int().positive(),
});
export type Note = z.infer<typeof noteSchema>;

export const waypointSchema = z.object({
  id: idSchema,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  gx: z.number().nullable(),
  gy: z.number().nullable(),
  label: cipherSchema,
  color: colorSchema,
  updatedAt: epochMs,
  updatedBy: idSchema,
  deletedAt: epochMs.nullable(),
  rev: z.number().int().positive(),
});
export type Waypoint = z.infer<typeof waypointSchema>;

export const sosSchema = z.object({
  id: idSchema,
  deviceId: idSchema,
  note: cipherSchema.nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  active: z.boolean(),
  createdAt: epochMs,
  clearedAt: epochMs.nullable(),
  rev: z.number().int().positive(),
});
export type Sos = z.infer<typeof sosSchema>;

export const beaconSchema = z.object({
  id: idSchema,
  deviceId: idSchema,
  text: cipherSchema,
  wpm: z.number().int().min(1).max(60),
  createdAt: epochMs,
  rev: z.number().int().positive(),
});
export type Beacon = z.infer<typeof beaconSchema>;

export const fileMetaSchema = z.object({
  id: idSchema,
  deviceId: idSchema,
  name: cipherSchema,
  mime: z.string().max(120),
  size: z.number().int().nonnegative(),
  sha256: z.string().max(128).nullable(),
  createdAt: epochMs,
  deletedAt: epochMs.nullable(),
  rev: z.number().int().positive(),
});
export type FileMeta = z.infer<typeof fileMetaSchema>;

/* ------------------------------------------------- server → client events */

/**
 * Broadcastable mutations. Also carried verbatim inside `sync.batch`
 * so replay and live delivery share one schema (SDA §5.2).
 */
export const eventSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("channel.new"), channel: channelSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("msg.new"), msg: messageSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("msg.deleted"), id: idSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("note.upsert"), note: noteSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("note.deleted"), id: idSchema, rev: z.number().int().positive() }),
  z.object({
    t: z.literal("check.update"),
    itemId: idSchema,
    checked: z.boolean(),
    updatedAt: epochMs,
    updatedBy: idSchema,
    rev: z.number().int().positive(),
  }),
  z.object({ t: z.literal("wp.upsert"), waypoint: waypointSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("wp.deleted"), id: idSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("sos.raised"), sos: sosSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("sos.cleared"), id: idSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("file.new"), file: fileMetaSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("file.deleted"), id: idSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("beacon.new"), beacon: beaconSchema, rev: z.number().int().positive() }),
]);
export type MeshEvent = z.infer<typeof eventSchema>;

export type EventType = MeshEvent["t"];

const EVENT_TYPES: ReadonlySet<string> = new Set<EventType>([
  "channel.new",
  "msg.new",
  "msg.deleted",
  "note.upsert",
  "note.deleted",
  "check.update",
  "wp.upsert",
  "wp.deleted",
  "sos.raised",
  "sos.cleared",
  "file.new",
  "file.deleted",
  "beacon.new",
]);

export function isMeshEvent(frame: { t: string }): frame is MeshEvent {
  return EVENT_TYPES.has(frame.t);
}

/* ---------------------------------------------- server → client (control) */

const errorCode = z.enum(ERROR_CODES);

export const s2cSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("joined"),
    room: z.object({ id: idSchema, name: z.string().max(80) }),
    channels: z.array(channelSchema),
    device: deviceSchema,
    cursor: z.number().int().nonnegative(),
    serverTime: epochMs,
  }),
  z.object({ t: z.literal("ack"), ref: idSchema, id: idSchema, rev: z.number().int().positive() }),
  z.object({ t: z.literal("error"), ref: idSchema.optional(), code: errorCode, message: z.string().max(400) }),
  z.object({ t: z.literal("pong"), ts: z.number(), serverTs: epochMs }),
  z.object({ t: z.literal("presence"), peers: z.array(peerSchema) }),
  z.object({
    t: z.literal("typing"),
    channelId: idSchema,
    deviceId: idSchema,
    on: z.boolean(),
  }),
  z.object({
    t: z.literal("sync.batch"),
    events: z.array(eventSchema),
    cursor: z.number().int().nonnegative(),
    done: z.boolean(),
  }),
  eventSchema,
]);
export type ServerFrame = z.infer<typeof s2cSchema>;

/* ---------------------------------------------- client → server (control) */

export const c2sSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("join"), token: z.string().min(16).max(128), device: deviceSchema }),
  z.object({ t: z.literal("leave") }),
  z.object({ t: z.literal("ping"), ts: z.number() }),

  z.object({
    t: z.literal("msg.send"),
    clientId: idSchema,
    channelId: idSchema,
    kind: z.enum(["text", "file"]),
    body: cipherSchema.nullable(),
    attachments: z.array(idSchema).max(16).default([]),
    replyTo: idSchema.optional().nullable(),
  }),
  z.object({ t: z.literal("msg.del"), clientId: idSchema, id: idSchema }),
  z.object({ t: z.literal("typing"), channelId: idSchema, on: z.boolean() }),
  z.object({ t: z.literal("sync.pull"), cursor: z.number().int().nonnegative() }),

  z.object({
    t: z.literal("presence.update"),
    battery: z.number().min(0).max(100).nullable().optional(),
    rttMs: z.number().int().nonnegative().nullable().optional(),
  }),

  z.object({ t: z.literal("channel.create"), clientId: idSchema, name: z.string().min(1).max(40) }),

  z.object({ t: z.literal("note.save"), clientId: idSchema, id: idSchema.optional(), title: cipherSchema, body: cipherSchema, updatedAt: epochMs }),
  z.object({ t: z.literal("note.del"), clientId: idSchema, id: idSchema, updatedAt: epochMs }),

  z.object({ t: z.literal("check.set"), clientId: idSchema, itemId: idSchema, checked: z.boolean(), updatedAt: epochMs }),

  z.object({
    t: z.literal("wp.save"),
    clientId: idSchema,
    id: idSchema.optional(),
    lat: z.number().nullable().optional(),
    lng: z.number().nullable().optional(),
    gx: z.number().nullable().optional(),
    gy: z.number().nullable().optional(),
    label: cipherSchema,
    color: colorSchema,
    updatedAt: epochMs,
  }),
  z.object({ t: z.literal("wp.del"), clientId: idSchema, id: idSchema, updatedAt: epochMs }),

  z.object({ t: z.literal("sos.raise"), clientId: idSchema, lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), note: cipherSchema.nullable().optional(), updatedAt: epochMs }),
  z.object({ t: z.literal("sos.clear"), clientId: idSchema, id: idSchema, updatedAt: epochMs }),

  z.object({ t: z.literal("beacon.share"), clientId: idSchema, text: cipherSchema, wpm: z.number().int().min(1).max(60) }),

  z.object({ t: z.literal("file.announce"), clientId: idSchema, fileId: idSchema }),
  z.object({ t: z.literal("file.del"), clientId: idSchema, fileId: idSchema, updatedAt: epochMs }),
]);
export type ClientFrame = z.infer<typeof c2sSchema>;

/** Subset of frames the hub acknowledges with `ack { ref: clientId }`. */
export const ACK_FRAMES = new Set<ClientFrame["t"]>([
  "msg.send",
  "msg.del",
  "channel.create",
  "note.save",
  "note.del",
  "check.set",
  "wp.save",
  "wp.del",
  "sos.raise",
  "sos.clear",
  "beacon.share",
  "file.announce",
  "file.del",
]);
