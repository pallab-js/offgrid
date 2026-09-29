import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Cipher } from "@/lib/protocol";

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
  createdAt: number;
  deletedAt: number | null;
  rev: number;
  blob: Blob | null;
}

interface OffgridSchema extends DBSchema {
  messages: {
    key: string;
    value: MessageRecord;
    indexes: {
      "by-channel": string;
      "by-client": string;
      "by-server": string;
    };
  };
  files: {
    key: string;
    value: FileRecord;
    indexes: { "by-room": string };
  };
}

let dbPromise: Promise<IDBPDatabase<OffgridSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<OffgridSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OffgridSchema>("offgrid", 2, {
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
      },
    });
  }
  return dbPromise;
}
