import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Cipher, ClientFrame, FileEnc, Reaction } from "@/lib/protocol";
import type { GeoPoint } from "@/lib/geo/geo";

export type MessageStatus = "pending" | "synced" | "failed";

/**
 * On-disk (IndexedDB) message record. Bodies stay sealed — plaintext only
 * exists in the in-memory chat store for the lifetime of the tab.
 */
export interface MessageRecord {
  uid: string; // clientId for own messages, serverId for remote ones
  roomId: string;
  clientId: string | null;
  serverId: string | null;
  channelId: string;
  deviceId: string;
  author: string;
  kind: "text" | "file" | "system";
  body: Cipher | null;
  replyTo: string | null;
  attachments: string[];
  reactions?: Reaction[];
  createdAt: number;
  deletedAt: number | null;
  rev: number;
  status: MessageStatus;
  attempts: number;
  deletePending: boolean;
}

/** File metadata mirrored locally; blob cached when size < 32 MB (TRD §6). */
export interface FileRecord {
  id: string;
  roomId: string;
  deviceId: string;
  name: Cipher;
  mime: string;
  size: number;
  sha256: string | null;
  enc?: FileEnc;
  createdAt: number;
  deletedAt: number | null;
  rev: number;
  blob: Blob | null;
}

export interface NoteRecord {
  id: string;
  roomId: string;
  title: Cipher;
  body: Cipher;
  updatedAt: number;
  updatedBy: string;
  deletedAt: number | null;
  rev: number;
}

export interface WaypointRecord {
  id: string;
  roomId: string;
  lat: number | null;
  lng: number | null;
  gx: number | null;
  gy: number | null;
  label: Cipher;
  color: string;
  updatedAt: number;
  updatedBy: string;
  deletedAt: number | null;
  rev: number;
}

export interface ProgressRecord {
  key: string; // `${roomId}:${itemId}`
  roomId: string;
  itemId: string;
  checked: boolean;
  updatedAt: number;
  updatedBy: string;
  rev: number;
}

export interface SosRecord {
  id: string;
  roomId: string;
  deviceId: string;
  note: Cipher | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  createdAt: number;
  clearedAt: number | null;
  rev: number;
}

export interface CalibrationPoint {
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface Calibration {
  p1: CalibrationPoint;
  p2: CalibrationPoint;
}

/** Device-local extras: shared map image + calibration, drawn route, manual battery. */
export interface MetaRecord {
  key: string; // "map" | "battery"
  image?: Blob | null;
  calibration?: Calibration | null;
  route?: GeoPoint[] | null;
  manualBattery?: number | null;
}

export interface OutboxEntry {
  clientId: string;
  frame: ClientFrame & { clientId: string };
  attempts: number;
  createdAt: number;
  failed?: boolean;
}

interface OffgridSchema extends DBSchema {
  messages: {
    key: string;
    value: MessageRecord;
    indexes: { "by-channel": string; "by-client": string; "by-server": string };
  };
  files: { key: string; value: FileRecord; indexes: { "by-room": string } };
  notes: { key: string; value: NoteRecord; indexes: { "by-room": string } };
  waypoints: { key: string; value: WaypointRecord; indexes: { "by-room": string } };
  progress: { key: string; value: ProgressRecord; indexes: { "by-room": string } };
  sos: { key: string; value: SosRecord; indexes: { "by-room": string } };
  meta: { key: string; value: MetaRecord };
  outbox: { key: string; value: OutboxEntry };
}

let dbPromise: Promise<IDBPDatabase<OffgridSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<OffgridSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OffgridSchema>("offgrid", 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("messages", { keyPath: "uid" });
          store.createIndex("by-channel", "channelId");
          store.createIndex("by-client", "clientId");
          store.createIndex("by-server", "serverId");
        }
        if (oldVersion < 2) {
          const files = db.createObjectStore("files", { keyPath: "id" });
          files.createIndex("by-room", "roomId");
        }
        if (oldVersion < 3) {
          const notes = db.createObjectStore("notes", { keyPath: "id" });
          notes.createIndex("by-room", "roomId");
          const wps = db.createObjectStore("waypoints", { keyPath: "id" });
          wps.createIndex("by-room", "roomId");
          const progress = db.createObjectStore("progress", { keyPath: "key" });
          progress.createIndex("by-room", "roomId");
          const sos = db.createObjectStore("sos", { keyPath: "id" });
          sos.createIndex("by-room", "roomId");
          db.createObjectStore("meta", { keyPath: "key" });
          db.createObjectStore("outbox", { keyPath: "clientId" });
        }
      },
    });
  }
  return dbPromise;
}

export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = null;
}

export type Db = IDBPDatabase<OffgridSchema>;
export type StoreName = keyof OffgridSchema;
